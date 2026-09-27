"""
Disagreement Trainer
====================

Training loop per LegalDisagreementNet con curriculum learning.

Features:
- Multi-task training con loss weighting
- Curriculum learning (Phase 1: binary → Phase 2: +type/level → Phase 3: full)
- Early stopping su validation loss
- Gradient accumulation per batch grandi
- Mixed precision training (FP16)
- Checkpoint saving/loading
- Logging con structlog + TensorBoard

Esempio:
    >>> from merlt.disagreement.trainer import DisagreementTrainer
    >>>
    >>> trainer = DisagreementTrainer(
    ...     model=model,
    ...     loss_fn=loss_fn,
    ...     config=TrainerConfig(learning_rate=2e-5)
    ... )
    >>> metrics = await trainer.train(train_loader, val_loader, epochs=50)
"""

import time
import structlog
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime

log = structlog.get_logger()

# Lazy imports
_torch = None
_nn = None


def _get_torch():
    """Lazy import di torch."""
    global _torch, _nn
    if _torch is None:
        import torch
        import torch.nn as nn
        _torch = torch
        _nn = nn
    return _torch, _nn


# =============================================================================
# CONFIGURATION
# =============================================================================

@dataclass
class TrainerConfig:
    """
    Configurazione per DisagreementTrainer.

    Attributes:
        learning_rate: Learning rate iniziale
        weight_decay: L2 regularization
        batch_size: Batch size (per DataLoader esterno)
        epochs: Numero massimo di epoche
        gradient_accumulation_steps: Passi di accumulo gradiente
        max_grad_norm: Clip gradiente
        warmup_steps: Passi di warmup per scheduler
        early_stopping_patience: Epoche senza miglioramento prima di stop
        early_stopping_min_delta: Miglioramento minimo per considerare progresso
        checkpoint_dir: Directory per checkpoint
        checkpoint_every_n_epochs: Frequenza checkpoint
        use_mixed_precision: Abilita FP16
        log_every_n_steps: Frequenza logging
        curriculum_phase1_epochs: Epoche fase 1 (solo binary)
        curriculum_phase2_epochs: Epoche fase 2 (+type/level)
    """
    learning_rate: float = 2e-5
    weight_decay: float = 0.01
    batch_size: int = 16
    epochs: int = 50
    gradient_accumulation_steps: int = 1
    max_grad_norm: float = 1.0
    warmup_steps: int = 100
    early_stopping_patience: int = 5
    early_stopping_min_delta: float = 0.001
    checkpoint_dir: str = "checkpoints/disagreement"
    checkpoint_every_n_epochs: int = 5
    use_mixed_precision: bool = False
    log_every_n_steps: int = 10
    curriculum_phase1_epochs: int = 10
    curriculum_phase2_epochs: int = 20


@dataclass
class EpochMetrics:
    """Metriche per una singola epoca."""
    epoch: int
    phase: int
    train_loss: float
    train_metrics: Dict[str, float]
    val_loss: Optional[float] = None
    val_metrics: Optional[Dict[str, float]] = None
    learning_rate: float = 0.0
    epoch_time_seconds: float = 0.0


@dataclass
class TrainingState:
    """Stato corrente del training."""
    current_epoch: int = 0
    global_step: int = 0
    best_val_loss: float = float("inf")
    best_epoch: int = 0
    epochs_without_improvement: int = 0
    history: List[EpochMetrics] = field(default_factory=list)


# =============================================================================
# CURRICULUM SCHEDULER
# =============================================================================

class CurriculumScheduler:
    """
    Scheduler per curriculum learning.

    Gestisce la progressione delle fasi di training:
    - Phase 1: Solo task binario
    - Phase 2: Binary + type + level (classification)
    - Phase 3: Full multi-task (+ regression + pairwise)
    """

    def __init__(
        self,
        phase1_epochs: int = 10,
        phase2_epochs: int = 20,
    ):
        """
        Args:
            phase1_epochs: Durata fase 1
            phase2_epochs: Durata fase 2
        """
        self.phase1_epochs = phase1_epochs
        self.phase2_epochs = phase2_epochs
        self._current_phase = 1

    def get_phase(self, epoch: int) -> int:
        """
        Restituisce fase per l'epoca data.

        Args:
            epoch: Numero epoca (0-indexed)

        Returns:
            Numero fase (1, 2, o 3)
        """
        if epoch < self.phase1_epochs:
            return 1
        elif epoch < self.phase1_epochs + self.phase2_epochs:
            return 2
        return 3

    def get_task_mask(self, epoch: int) -> Dict[str, bool]:
        """
        Restituisce quali task sono attivi per l'epoca.

        Args:
            epoch: Numero epoca

        Returns:
            Dict con task -> bool (attivo)
        """
        phase = self.get_phase(epoch)

        if phase == 1:
            return {
                "binary": True,
                "type": False,
                "level": False,
                "intensity": False,
                "resolvability": False,
                "pairwise": False,
            }
        elif phase == 2:
            return {
                "binary": True,
                "type": True,
                "level": True,
                "intensity": False,
                "resolvability": False,
                "pairwise": False,
            }
        else:
            return {
                "binary": True,
                "type": True,
                "level": True,
                "intensity": True,
                "resolvability": True,
                "pairwise": True,
            }

    def get_task_weights(self, epoch: int) -> Dict[str, float]:
        """
        Pesi task per l'epoca (ramping up graduale).

        Args:
            epoch: Numero epoca

        Returns:
            Dict con task -> weight
        """
        phase = self.get_phase(epoch)

        if phase == 1:
            return {"binary": 1.0}
        elif phase == 2:
            # Ramp up type e level
            phase2_progress = (epoch - self.phase1_epochs) / self.phase2_epochs
            return {
                "binary": 1.0,
                "type": 0.5 + 0.3 * phase2_progress,
                "level": 0.4 + 0.2 * phase2_progress,
            }
        else:
            # Full weights
            phase3_epoch = epoch - self.phase1_epochs - self.phase2_epochs
            progress = min(phase3_epoch / 10, 1.0)  # Ramp up in 10 epoche
            return {
                "binary": 1.0,
                "type": 0.8,
                "level": 0.6,
                "intensity": 0.4 * progress,
                "resolvability": 0.4 * progress,
                "pairwise": 0.3 * progress,
            }


# =============================================================================
# TRAINER CLASS
# =============================================================================

class DisagreementTrainer:
    """
    Trainer per LegalDisagreementNet.

    Gestisce training loop, validation, checkpointing e curriculum learning.
    """

    def __init__(
        self,
        model: Any,
        loss_fn: Any,
        config: Optional[TrainerConfig] = None,
        optimizer: Optional[Any] = None,
        scheduler: Optional[Any] = None,
        curriculum: Optional[CurriculumScheduler] = None,
    ):
        """
        Inizializza trainer.

        Args:
            model: Modello da trainare (LegalDisagreementNet o simile)
            loss_fn: Loss function (DisagreementLoss)
            config: Configurazione training
            optimizer: Optimizer (default: AdamW)
            scheduler: LR scheduler (default: warmup + cosine)
            curriculum: Curriculum scheduler (default: nuovo)
        """
        torch, nn = _get_torch()

        self.model = model
        self.loss_fn = loss_fn
        self.config = config or TrainerConfig()

        # Device
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)

        # Optimizer
        if optimizer is None:
            self.optimizer = torch.optim.AdamW(
                model.parameters(),
                lr=self.config.learning_rate,
                weight_decay=self.config.weight_decay,
            )
        else:
            self.optimizer = optimizer

        # Scheduler
        self.scheduler = scheduler

        # Curriculum
        self.curriculum = curriculum or CurriculumScheduler(
            phase1_epochs=self.config.curriculum_phase1_epochs,
            phase2_epochs=self.config.curriculum_phase2_epochs,
        )

        # Mixed precision
        self.scaler = None
        if self.config.use_mixed_precision and torch.cuda.is_available():
            self.scaler = torch.cuda.amp.GradScaler()

        # State
        self.state = TrainingState()

        # Checkpoint dir
        Path(self.config.checkpoint_dir).mkdir(parents=True, exist_ok=True)

        log.info(
            "DisagreementTrainer initialized",
            device=str(self.device),
            learning_rate=self.config.learning_rate,
            epochs=self.config.epochs,
            mixed_precision=self.config.use_mixed_precision,
        )

    async def train(
        self,
        train_loader: Any,
        val_loader: Optional[Any] = None,
        epochs: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Esegue training loop completo.

        Args:
            train_loader: DataLoader per training
            val_loader: DataLoader per validation (opzionale)
            epochs: Override numero epoche

        Returns:
            Dict con metriche finali e storia training
        """
        torch, _ = _get_torch()

        epochs = epochs or self.config.epochs

        log.info(f"Starting training for {epochs} epochs")

        for epoch in range(self.state.current_epoch, epochs):
            start_time = time.time()

            # Get curriculum phase
            phase = self.curriculum.get_phase(epoch)
            task_mask = self.curriculum.get_task_mask(epoch)

            # Train epoch
            train_loss, train_metrics = await self._train_epoch(
                train_loader,
                epoch,
                task_mask,
            )

            # Validate
            val_loss = None
            val_metrics = None
            if val_loader is not None:
                val_loss, val_metrics = await self._validate(
                    val_loader,
                    epoch,
                    task_mask,
                )

            # Get current LR
            current_lr = self.optimizer.param_groups[0]["lr"]

            # Record metrics
            epoch_metrics = EpochMetrics(
                epoch=epoch,
                phase=phase,
                train_loss=train_loss,
                train_metrics=train_metrics,
                val_loss=val_loss,
                val_metrics=val_metrics,
                learning_rate=current_lr,
                epoch_time_seconds=time.time() - start_time,
            )
            self.state.history.append(epoch_metrics)
            self.state.current_epoch = epoch + 1

            # Logging
            log.info(
                f"Epoch {epoch + 1}/{epochs}",
                phase=phase,
                train_loss=f"{train_loss:.4f}",
                val_loss=f"{val_loss:.4f}" if val_loss else "N/A",
                lr=f"{current_lr:.2e}",
                time=f"{epoch_metrics.epoch_time_seconds:.1f}s",
            )

            # Early stopping check
            if val_loss is not None:
                if val_loss < self.state.best_val_loss - self.config.early_stopping_min_delta:
                    self.state.best_val_loss = val_loss
                    self.state.best_epoch = epoch
                    self.state.epochs_without_improvement = 0

                    # Save best model
                    self.save_checkpoint("best_model.pt")
                else:
                    self.state.epochs_without_improvement += 1

                if self.state.epochs_without_improvement >= self.config.early_stopping_patience:
                    log.info(
                        f"Early stopping at epoch {epoch + 1}",
                        best_epoch=self.state.best_epoch,
                        best_val_loss=self.state.best_val_loss,
                    )
                    break

            # Periodic checkpoint
            if (epoch + 1) % self.config.checkpoint_every_n_epochs == 0:
                self.save_checkpoint(f"checkpoint_epoch_{epoch + 1}.pt")

            # Update scheduler
            if self.scheduler is not None:
                self.scheduler.step()

        # Final checkpoint
        self.save_checkpoint("final_model.pt")

        return {
            "best_val_loss": self.state.best_val_loss,
            "best_epoch": self.state.best_epoch,
            "total_epochs": self.state.current_epoch,
            "history": [m.__dict__ for m in self.state.history],
        }

    async def _train_epoch(
        self,
        train_loader: Any,
        epoch: int,
        task_mask: Dict[str, bool],
    ) -> tuple:
        """
        Esegue una singola epoca di training.

        Returns:
            Tuple (avg_loss, metrics_dict)
        """
        torch, _ = _get_torch()

        self.model.train()

        total_loss = 0.0
        num_batches = 0
        accumulated_metrics: Dict[str, float] = {}

        for batch_idx, batch in enumerate(train_loader):
            # Move to device
            batch = self._batch_to_device(batch)

            # Forward pass
            with torch.cuda.amp.autocast(enabled=self.scaler is not None):
                # Assume model takes expert_embeddings
                if "expert_embeddings" in batch:
                    outputs = self.model(batch["expert_embeddings"])
                else:
                    # Se servono input_ids, il modello deve avere encoder
                    outputs = self.model(
                        batch.get("expert_input_ids"),
                        batch.get("expert_attention_mask"),
                    )

                # Prepare targets
                targets = self._prepare_targets(batch, task_mask)

                # Loss
                losses = self.loss_fn(outputs, targets)
                loss = losses["total"] / self.config.gradient_accumulation_steps

            # Backward
            if self.scaler is not None:
                self.scaler.scale(loss).backward()
            else:
                loss.backward()

            # Gradient accumulation
            if (batch_idx + 1) % self.config.gradient_accumulation_steps == 0:
                if self.scaler is not None:
                    self.scaler.unscale_(self.optimizer)
                    torch.nn.utils.clip_grad_norm_(
                        self.model.parameters(),
                        self.config.max_grad_norm
                    )
                    self.scaler.step(self.optimizer)
                    self.scaler.update()
                else:
                    torch.nn.utils.clip_grad_norm_(
                        self.model.parameters(),
                        self.config.max_grad_norm
                    )
                    self.optimizer.step()

                self.optimizer.zero_grad()
                self.state.global_step += 1

            total_loss += losses["total"].item()
            num_batches += 1

            # Accumulate metrics
            if "metrics" in losses:
                for key, value in losses["metrics"].items():
                    accumulated_metrics[key] = accumulated_metrics.get(key, 0.0) + value

            # Logging
            if (batch_idx + 1) % self.config.log_every_n_steps == 0:
                log.debug(
                    f"Train step {batch_idx + 1}",
                    loss=f"{losses['total'].item():.4f}",
                    step=self.state.global_step,
                )

        avg_loss = total_loss / max(num_batches, 1)
        avg_metrics = {
            k: v / max(num_batches, 1)
            for k, v in accumulated_metrics.items()
        }

        return avg_loss, avg_metrics

    async def _validate(
        self,
        val_loader: Any,
        epoch: int,
        task_mask: Dict[str, bool],
    ) -> tuple:
        """
        Esegue validation.

        Returns:
            Tuple (avg_loss, metrics_dict)
        """
        torch, _ = _get_torch()

        self.model.eval()

        total_loss = 0.0
        num_batches = 0
        accumulated_metrics: Dict[str, float] = {}

        with torch.no_grad():
            for batch in val_loader:
                batch = self._batch_to_device(batch)

                if "expert_embeddings" in batch:
                    outputs = self.model(batch["expert_embeddings"])
                else:
                    outputs = self.model(
                        batch.get("expert_input_ids"),
                        batch.get("expert_attention_mask"),
                    )

                targets = self._prepare_targets(batch, task_mask)
                losses = self.loss_fn(outputs, targets)

                total_loss += losses["total"].item()
                num_batches += 1

                if "metrics" in losses:
                    for key, value in losses["metrics"].items():
                        accumulated_metrics[key] = accumulated_metrics.get(key, 0.0) + value

        avg_loss = total_loss / max(num_batches, 1)
        avg_metrics = {
            k: v / max(num_batches, 1)
            for k, v in accumulated_metrics.items()
        }

        return avg_loss, avg_metrics

    def _batch_to_device(self, batch: Dict[str, Any]) -> Dict[str, Any]:
        """Sposta batch su device."""
        torch, _ = _get_torch()

        result = {}
        for key, value in batch.items():
            if isinstance(value, torch.Tensor):
                result[key] = value.to(self.device)
            else:
                result[key] = value
        return result

    def _prepare_targets(
        self,
        batch: Dict[str, Any],
        task_mask: Dict[str, bool],
    ) -> Dict[str, Any]:
        """
        Prepara targets per loss, applicando mask curriculum.

        Args:
            batch: Batch dal DataLoader
            task_mask: Quali task sono attivi

        Returns:
            Dict con targets (None per task disabilitati)
        """
        targets = {
            "binary": batch.get("binary_target"),
        }

        # Type e level solo se attivi E se abbiamo samples con disagreement
        if task_mask.get("type", False):
            targets["type"] = batch.get("type_target")
        else:
            targets["type"] = None

        if task_mask.get("level", False):
            targets["level"] = batch.get("level_target")
        else:
            targets["level"] = None

        if task_mask.get("intensity", False):
            targets["intensity"] = batch.get("intensity_target")
        else:
            targets["intensity"] = None

        if task_mask.get("resolvability", False):
            targets["resolvability"] = batch.get("resolvability_target")
        else:
            targets["resolvability"] = None

        if task_mask.get("pairwise", False):
            targets["conflicting_pairs"] = batch.get("conflicting_pairs")
        else:
            targets["conflicting_pairs"] = None

        return targets

    def save_checkpoint(self, filename: str) -> str:
        """
        Salva checkpoint.

        Args:
            filename: Nome file

        Returns:
            Path completo del checkpoint
        """
        torch, _ = _get_torch()

        path = Path(self.config.checkpoint_dir) / filename

        checkpoint = {
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "scheduler_state_dict": self.scheduler.state_dict() if self.scheduler else None,
            "scaler_state_dict": self.scaler.state_dict() if self.scaler else None,
            "training_state": {
                "current_epoch": self.state.current_epoch,
                "global_step": self.state.global_step,
                "best_val_loss": self.state.best_val_loss,
                "best_epoch": self.state.best_epoch,
                "epochs_without_improvement": self.state.epochs_without_improvement,
            },
            "config": self.config.__dict__,
            "timestamp": datetime.now().isoformat(),
        }

        torch.save(checkpoint, path)
        log.info(f"Checkpoint saved: {path}")

        return str(path)

    def load_checkpoint(self, path: str) -> None:
        """
        Carica checkpoint.

        Args:
            path: Path al checkpoint
        """
        torch, _ = _get_torch()

        # weights_only=False: checkpoint contains optimizer state (non-tensor)
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)

        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])

        if self.scheduler and checkpoint.get("scheduler_state_dict"):
            self.scheduler.load_state_dict(checkpoint["scheduler_state_dict"])

        if self.scaler and checkpoint.get("scaler_state_dict"):
            self.scaler.load_state_dict(checkpoint["scaler_state_dict"])

        # Restore state
        state_dict = checkpoint.get("training_state", {})
        self.state.current_epoch = state_dict.get("current_epoch", 0)
        self.state.global_step = state_dict.get("global_step", 0)
        self.state.best_val_loss = state_dict.get("best_val_loss", float("inf"))
        self.state.best_epoch = state_dict.get("best_epoch", 0)
        self.state.epochs_without_improvement = state_dict.get("epochs_without_improvement", 0)

        log.info(f"Checkpoint loaded: {path}", epoch=self.state.current_epoch)

    def get_training_summary(self) -> Dict[str, Any]:
        """
        Restituisce summary del training.

        Returns:
            Dict con statistiche training
        """
        return {
            "current_epoch": self.state.current_epoch,
            "global_step": self.state.global_step,
            "best_val_loss": self.state.best_val_loss,
            "best_epoch": self.state.best_epoch,
            "total_epochs_trained": len(self.state.history),
            "current_phase": self.curriculum.get_phase(self.state.current_epoch),
            "device": str(self.device),
        }
