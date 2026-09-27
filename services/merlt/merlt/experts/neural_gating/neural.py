"""
Neural Gating Network
=====================

PHASE 3: MLP per routing dinamico query → expert weights.

Architettura:
    Input: query_embedding (1024-dim da E5-large)
    Hidden Layer 1: 1024 → 512 (ReLU + Dropout)
    Hidden Layer 2: 512 → 256 (ReLU + Dropout)
    Output Layer: 256 → 4 (Softmax)
    Expert Bias: 4 parametri apprendibili (prior giuridico)

Training:
    Loss: KL Divergence (soft labels)
    Optimizer: Adam (lr=0.001)
    Authority-weighted: feedback pesato per authority utente

Formula: g_i = softmax(MLP(query_emb) + expert_bias)
"""

import structlog
from typing import Dict, Any, Optional, Tuple, List
from dataclasses import dataclass, field
from pathlib import Path
from datetime import datetime
import json

import numpy as np

# PyTorch imports (già in requirements.txt)
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

log = structlog.get_logger()


# Expert names in ordine fisso per mapping index → nome
EXPERT_NAMES = ["literal", "systemic", "principles", "precedent"]

# Default prior giuridico (da experts.yaml)
DEFAULT_EXPERT_PRIORS = {
    "literal": 0.35,
    "systemic": 0.25,
    "principles": 0.20,
    "precedent": 0.20,
}


@dataclass
class GatingConfig:
    """
    Configurazione per Neural Gating.

    Attributes:
        input_dim: Dimensione embedding (1024 per E5-large)
        hidden_dim1: Prima hidden layer (512)
        hidden_dim2: Seconda hidden layer (256)
        num_experts: Numero expert (4)
        dropout: Dropout rate (0.1)
        learning_rate: Learning rate Adam (0.001)
        weight_decay: L2 regularization (1e-5)
        confidence_threshold: Soglia per hybrid mode (0.7)
        max_authority_weight: Cap su authority weight (2.0)
    """
    input_dim: int = 1024
    hidden_dim1: int = 512
    hidden_dim2: int = 256
    num_experts: int = 4
    dropout: float = 0.1
    learning_rate: float = 0.001
    weight_decay: float = 1e-5
    confidence_threshold: float = 0.7
    max_authority_weight: float = 2.0
    expert_priors: Dict[str, float] = field(default_factory=lambda: DEFAULT_EXPERT_PRIORS.copy())


class ExpertGatingMLP(nn.Module):
    """
    Neural network per routing query → expert weights.

    Architettura MLP con warm-start da prior giuridico.

    Esempio:
        >>> mlp = ExpertGatingMLP()
        >>> embedding = np.random.randn(1024)
        >>> result = mlp.predict_single(embedding)
        >>> print(result["weights"])
        {"literal": 0.4, "systemic": 0.3, "principles": 0.2, "precedent": 0.1}
    """

    def __init__(self, config: Optional[GatingConfig] = None):
        """
        Inizializza ExpertGatingMLP.

        Args:
            config: Configurazione (usa default se None)
        """
        if not TORCH_AVAILABLE:
            raise ImportError("PyTorch non disponibile. Installa con: pip install torch")

        super().__init__()
        self.config = config or GatingConfig()

        # Encoder: input_dim → hidden1 → hidden2
        self.encoder = nn.Sequential(
            nn.Linear(self.config.input_dim, self.config.hidden_dim1),
            nn.ReLU(),
            nn.Dropout(self.config.dropout),
            nn.LayerNorm(self.config.hidden_dim1),
        )

        # Gating layer: hidden1 → hidden2 → num_experts
        self.gate = nn.Sequential(
            nn.Linear(self.config.hidden_dim1, self.config.hidden_dim2),
            nn.ReLU(),
            nn.Dropout(self.config.dropout),
            nn.LayerNorm(self.config.hidden_dim2),
            nn.Linear(self.config.hidden_dim2, self.config.num_experts),
        )

        # Expert bias (warm-start con prior giuridico)
        bias_values = torch.tensor([
            self.config.expert_priors.get(name, 0.25)
            for name in EXPERT_NAMES
        ], dtype=torch.float32)

        # Converti in logits (inverse softmax approx)
        bias_logits = torch.log(bias_values + 1e-8)
        self.expert_bias = nn.Parameter(bias_logits)

        # Temperature per calibration
        self.temperature = nn.Parameter(torch.tensor(1.0))

        log.info(
            "ExpertGatingMLP initialized",
            input_dim=self.config.input_dim,
            hidden_dims=(self.config.hidden_dim1, self.config.hidden_dim2),
            num_experts=self.config.num_experts
        )

    @property
    def device(self) -> "torch.device":
        """Device del modello (dal primo parametro)."""
        return next(self.parameters(), torch.empty(0)).device

    def forward(
        self,
        query_embedding: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass.

        Args:
            query_embedding: (batch_size, input_dim)

        Returns:
            weights: (batch_size, num_experts) - Softmax su expert
            log_probs: (batch_size, num_experts) - Log softmax per REINFORCE
        """
        # Encode query
        encoded = self.encoder(query_embedding)

        # Compute logits
        logits = self.gate(encoded) + self.expert_bias

        # Temperature scaling
        scaled_logits = logits / self.temperature

        # Softmax → weights
        weights = F.softmax(scaled_logits, dim=-1)

        # Log softmax per REINFORCE training
        log_probs = F.log_softmax(scaled_logits, dim=-1)

        return weights, log_probs

    def predict_single(
        self,
        query_embedding: np.ndarray
    ) -> Dict[str, Any]:
        """
        Predizione per singola query (inference).

        Args:
            query_embedding: numpy array (input_dim,)

        Returns:
            {
                "weights": {"literal": 0.4, "systemic": 0.3, ...},
                "confidence": 0.85,
                "top_expert": "literal"
            }
        """
        was_training = self.training
        self.eval()
        try:
            with torch.no_grad():
                emb = torch.tensor(query_embedding, dtype=torch.float32).unsqueeze(0)
                weights, log_probs = self(emb)

                weights_np = weights.squeeze(0).cpu().numpy()
                log_probs_np = log_probs.squeeze(0).cpu().numpy()
                conf_np = float(weights_np.max())

                weight_dict = {
                    name: float(w) for name, w in zip(EXPERT_NAMES, weights_np)
                }
                log_prob_dict = {
                    name: float(lp) for name, lp in zip(EXPERT_NAMES, log_probs_np)
                }

                top_expert = EXPERT_NAMES[weights_np.argmax()]

                return {
                    "weights": weight_dict,
                    "confidence": conf_np,
                    "top_expert": top_expert,
                    "log_probs": log_prob_dict,
                }
        finally:
            if was_training:
                self.train()

    def get_expert_priors(self) -> Dict[str, float]:
        """Ottiene prior correnti (dopo training)."""
        with torch.no_grad():
            priors = F.softmax(self.expert_bias, dim=0).cpu().numpy()
            return {
                name: float(p) for name, p in zip(EXPERT_NAMES, priors)
            }


class NeuralGatingTrainer:
    """
    Training loop per θ_gating con feedback RLCF.

    Flow:
    1. Query → Neural Gating → Expert Weights
    2. Experts eseguono → Aggregated Response
    3. User Feedback → Quale expert aveva ragione
    4. Backprop → Update θ_gating

    Esempio:
        >>> trainer = NeuralGatingTrainer(model, embedding_service)
        >>> metrics = await trainer.train_from_feedback(
        ...     query="Cos'è la legittima difesa?",
        ...     expert_correctness={"literal": 0.8, "precedent": 0.6, ...},
        ...     authority_weight=0.9
        ... )
    """

    def __init__(
        self,
        model: ExpertGatingMLP,
        embedding_service: Any = None,
        config: Optional[GatingConfig] = None,
        device: str = "cpu"
    ):
        """
        Inizializza trainer.

        Args:
            model: ExpertGatingMLP da trainare
            embedding_service: Servizio per encoding query
            config: Configurazione
            device: Device PyTorch (cpu/cuda)
        """
        if not TORCH_AVAILABLE:
            raise ImportError("PyTorch non disponibile")

        self.model = model.to(device)
        self.embedding_service = embedding_service
        self.config = config or model.config
        self.device = device

        # Optimizer
        self.optimizer = torch.optim.Adam(
            self.model.parameters(),
            lr=self.config.learning_rate,
            weight_decay=self.config.weight_decay
        )

        # Training history
        self.training_history: List[Dict[str, Any]] = []
        self.step_count = 0

        log.info(
            "NeuralGatingTrainer initialized",
            learning_rate=self.config.learning_rate,
            device=device
        )

    async def train_from_feedback(
        self,
        query: str,
        expert_correctness: Dict[str, float],
        authority_weight: float = 1.0
    ) -> Dict[str, Any]:
        """
        Training step da feedback RLCF.

        Args:
            query: Query originale
            expert_correctness: {"literal": 0.8, "systemic": 0.2, ...}
            authority_weight: Peso utente (da Authority Module)

        Returns:
            Training metrics
        """
        self.model.train()
        self.step_count += 1

        # 1. Encode query
        if self.embedding_service:
            query_embedding = await self.embedding_service.encode_query_async(query)
        else:
            # Fallback: random embedding per testing
            query_embedding = np.random.randn(self.config.input_dim)

        emb_tensor = torch.tensor(
            query_embedding,
            dtype=torch.float32,
            device=self.device
        ).unsqueeze(0)

        # 2. Forward pass
        weights, log_probs = self.model(emb_tensor)
        confidence = weights.max(dim=-1).values

        # 3. Ground truth: expert correctness scores
        correctness_values = [
            expert_correctness.get(name, 0.0) for name in EXPERT_NAMES
        ]

        target_tensor = torch.tensor(
            correctness_values,
            dtype=torch.float32,
            device=self.device
        ).unsqueeze(0)

        # Normalize to soft labels
        target_tensor = F.softmax(target_tensor * 2, dim=-1)  # Scale up for sharper targets

        # 4. Loss: KL divergence (log_probs already available from forward)
        loss = F.kl_div(
            log_probs,
            target_tensor,
            reduction='batchmean',
            log_target=False,
        ).clamp(min=0.0)

        # Cap authority weight
        capped_authority = min(authority_weight, self.config.max_authority_weight)
        weighted_loss = loss * capped_authority

        # 5. Backprop
        self.optimizer.zero_grad()
        weighted_loss.backward()

        # Gradient clipping
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)

        self.optimizer.step()

        # 6. Metrics
        predicted_weights = {
            name: float(w)
            for name, w in zip(EXPERT_NAMES, weights.squeeze(0).detach().cpu().numpy())
        }

        metrics = {
            "step": self.step_count,
            "loss": loss.item(),
            "weighted_loss": weighted_loss.item(),
            "confidence": confidence.item(),
            "predicted_weights": predicted_weights,
            "target_correctness": expert_correctness,
            "authority_weight": capped_authority,
            "timestamp": datetime.now().isoformat()
        }

        self.training_history.append(metrics)

        log.debug(
            "Neural gating training step",
            step=self.step_count,
            loss=loss.item(),
            confidence=confidence.item()
        )

        return metrics

    def train_from_feedback_sync(
        self,
        query_embedding: np.ndarray,
        expert_correctness: Dict[str, float],
        authority_weight: float = 1.0
    ) -> Dict[str, Any]:
        """
        Versione sincrona per testing (usa embedding diretto).
        """
        self.model.train()
        self.step_count += 1

        emb_tensor = torch.tensor(
            query_embedding,
            dtype=torch.float32,
            device=self.device
        ).unsqueeze(0)

        weights, log_probs = self.model(emb_tensor)
        confidence = weights.max(dim=-1).values

        correctness_values = [
            expert_correctness.get(name, 0.0) for name in EXPERT_NAMES
        ]

        target_tensor = torch.tensor(
            correctness_values,
            dtype=torch.float32,
            device=self.device
        ).unsqueeze(0)

        target_tensor = F.softmax(target_tensor * 2, dim=-1)

        loss = F.kl_div(
            log_probs,
            target_tensor,
            reduction='batchmean',
            log_target=False,
        ).clamp(min=0.0)

        capped_authority = min(authority_weight, self.config.max_authority_weight)
        weighted_loss = loss * capped_authority

        self.optimizer.zero_grad()
        weighted_loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
        self.optimizer.step()

        predicted_weights = {
            name: float(w)
            for name, w in zip(EXPERT_NAMES, weights.squeeze(0).detach().cpu().numpy())
        }

        metrics = {
            "step": self.step_count,
            "loss": loss.item(),
            "confidence": confidence.item(),
            "predicted_weights": predicted_weights,
            "authority_weight": capped_authority
        }

        # Append to training history
        self.training_history.append(metrics)

        return metrics

    def get_training_stats(self) -> Dict[str, Any]:
        """Ottiene statistiche di training."""
        if not self.training_history:
            return {"status": "no_training", "steps": 0}

        losses = [h["loss"] for h in self.training_history]
        confidences = [h["confidence"] for h in self.training_history]

        return {
            "total_steps": self.step_count,
            "avg_loss": sum(losses) / len(losses),
            "min_loss": min(losses),
            "max_loss": max(losses),
            "avg_confidence": sum(confidences) / len(confidences),
            "recent_loss": losses[-10:] if len(losses) >= 10 else losses,
            "current_priors": self.model.get_expert_priors()
        }

    def save_checkpoint(self, path: Path) -> None:
        """Salva checkpoint modello."""
        path.parent.mkdir(parents=True, exist_ok=True)

        checkpoint = {
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'training_history': self.training_history[-1000:],  # Keep last 1000
            'step_count': self.step_count,
            'config': {
                'input_dim': self.config.input_dim,
                'hidden_dim1': self.config.hidden_dim1,
                'hidden_dim2': self.config.hidden_dim2,
                'learning_rate': self.config.learning_rate,
                'confidence_threshold': self.config.confidence_threshold
            },
            'metadata': {
                'version': '1.0',
                'saved_at': datetime.now().isoformat()
            }
        }

        torch.save(checkpoint, path)
        log.info(f"Checkpoint saved to {path}", steps=self.step_count)

    def load_checkpoint(self, path: Path) -> None:
        """Carica checkpoint modello."""
        if not path.exists():
            log.warning(f"Checkpoint not found: {path}")
            return

        # weights_only=False: checkpoint contains optimizer state (non-tensor)
        checkpoint = torch.load(path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.training_history = checkpoint.get('training_history', [])
        self.step_count = checkpoint.get('step_count', 0)

        log.info(f"Checkpoint loaded from {path}", steps=self.step_count)


class AutosaveCallback:
    """
    Callback per auto-save checkpoint dopo N feedback.

    Esempio:
        >>> callback = AutosaveCallback(trainer, Path("checkpoints"), save_every_n=50)
        >>> # Dopo ogni training step:
        >>> await callback.on_feedback(metrics)
    """

    def __init__(
        self,
        trainer: NeuralGatingTrainer,
        checkpoint_dir: Path,
        save_every_n: int = 50,
        keep_last_n: int = 3
    ):
        """
        Inizializza callback.

        Args:
            trainer: NeuralGatingTrainer
            checkpoint_dir: Directory per checkpoint
            save_every_n: Salva ogni N step
            keep_last_n: Mantieni solo ultimi N checkpoint
        """
        self.trainer = trainer
        self.checkpoint_dir = checkpoint_dir
        self.save_every_n = save_every_n
        self.keep_last_n = keep_last_n

        checkpoint_dir.mkdir(parents=True, exist_ok=True)

    async def on_feedback(self, metrics: Dict[str, Any]) -> Optional[Path]:
        """
        Hook dopo ogni training step.

        Returns:
            Path del checkpoint se salvato, None altrimenti
        """
        step = metrics.get("step", self.trainer.step_count)

        if step % self.save_every_n == 0 and step > 0:
            checkpoint_path = self.checkpoint_dir / f"gating_model_step_{step}.pt"
            self.trainer.save_checkpoint(checkpoint_path)

            # Cleanup old checkpoints
            self._cleanup_old_checkpoints()

            return checkpoint_path

        return None

    def _cleanup_old_checkpoints(self) -> None:
        """Rimuove checkpoint vecchi."""
        checkpoints = sorted(self.checkpoint_dir.glob("gating_model_step_*.pt"))

        while len(checkpoints) > self.keep_last_n:
            old_ckpt = checkpoints.pop(0)
            old_ckpt.unlink()
            log.debug(f"Removed old checkpoint: {old_ckpt}")

    def get_latest_checkpoint(self) -> Optional[Path]:
        """Ottiene ultimo checkpoint disponibile."""
        checkpoints = sorted(self.checkpoint_dir.glob("gating_model_step_*.pt"))
        return checkpoints[-1] if checkpoints else None
