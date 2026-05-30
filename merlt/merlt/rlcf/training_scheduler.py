"""
Training Scheduler
==================

Scheduler automatico per training RLCF.

Monitora il buffer di esperienze e avvia training quando:
1. Buffer raggiunge soglia minima (es. 100 esperienze)
2. Intervallo di tempo minimo passato (es. 1 ora)
3. Trigger manuale via API

Flusso:
    Feedback → ExperienceReplayBuffer → TrainingScheduler monitors →
    Threshold reached → PolicyGradientTrainer.train() → PolicyCheckpoint saved

Esempio:
    >>> from merlt.rlcf.training_scheduler import TrainingScheduler, get_scheduler
    >>>
    >>> # Singleton access
    >>> scheduler = get_scheduler()
    >>>
    >>> # Aggiungi esperienza al buffer
    >>> scheduler.add_experience(trace, feedback, reward=0.8)
    >>>
    >>> # Check se training ready
    >>> if scheduler.should_train():
    ...     await scheduler.run_training_epoch()
    >>>
    >>> # Avvia training automatico in background
    >>> await scheduler.start_auto_training()
    >>>
    >>> # Status
    >>> status = scheduler.get_status()
    >>> print(f"Buffer: {status.buffer_size}, Training: {status.is_training}")
"""

import asyncio
import time
import structlog
from dataclasses import dataclass, field
from datetime import datetime, timedelta, UTC
from typing import Dict, Any, Optional, List, Callable, Tuple
from enum import Enum
from pathlib import Path
import threading

from .replay_buffer import ExperienceReplayBuffer, PrioritizedReplayBuffer, BufferStats
from .persistence import RLCFPersistence, TrainingSession, PolicyCheckpoint

log = structlog.get_logger()


# =============================================================================
# ENUMS AND DATACLASSES
# =============================================================================

class TrainingStatus(str, Enum):
    """Stato del training."""
    IDLE = "idle"
    TRAINING = "training"
    PAUSED = "paused"
    ERROR = "error"


class TrainingTrigger(str, Enum):
    """Trigger che ha avviato il training."""
    BUFFER_THRESHOLD = "buffer_threshold"
    TIME_INTERVAL = "time_interval"
    MANUAL = "manual"
    API = "api"


@dataclass
class SchedulerConfig:
    """
    Configurazione dello scheduler.

    Attributes:
        buffer_threshold: Numero minimo esperienze per training
        min_interval_seconds: Intervallo minimo tra training
        max_buffer_size: Capacità massima buffer
        batch_size: Dimensione batch per training
        epochs_per_run: Numero di epoch per run
        prioritized_replay: Usare prioritized experience replay
        alpha: Esponente priorità PER
        auto_save_checkpoint: Salvare checkpoint automaticamente
    """
    buffer_threshold: int = 100
    min_interval_seconds: int = 3600  # 1 ora
    max_buffer_size: int = 10000
    batch_size: int = 32
    epochs_per_run: int = 5
    prioritized_replay: bool = True
    alpha: float = 0.6
    auto_save_checkpoint: bool = True
    checkpoint_dir: str = "checkpoints"
    experiment_id: str = "rlcf_training"
    idle_timeout_days: int = 7
    error_cooldown_seconds: int = 300  # 5 min cooldown after ERROR before retry
    buffer_persistence_path: Optional[str] = "data/rlcf/replay_buffer.json"
    on_training_start: Optional[List[Callable]] = None
    on_training_complete_callbacks: Optional[List[Callable]] = None
    on_training_error_callbacks: Optional[List[Callable]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "buffer_threshold": self.buffer_threshold,
            "min_interval_seconds": self.min_interval_seconds,
            "max_buffer_size": self.max_buffer_size,
            "batch_size": self.batch_size,
            "epochs_per_run": self.epochs_per_run,
            "prioritized_replay": self.prioritized_replay,
            "alpha": self.alpha,
            "auto_save_checkpoint": self.auto_save_checkpoint,
            "checkpoint_dir": self.checkpoint_dir,
            "experiment_id": self.experiment_id,
            "idle_timeout_days": self.idle_timeout_days,
            "error_cooldown_seconds": self.error_cooldown_seconds,
            "buffer_persistence_path": self.buffer_persistence_path,
        }


@dataclass
class SchedulerStatus:
    """
    Stato corrente dello scheduler.

    Attributes:
        status: Stato training (idle, training, etc.)
        buffer_size: Numero esperienze nel buffer
        buffer_capacity: Capacità massima buffer
        last_training_at: Timestamp ultimo training
        next_training_at: Timestamp prossimo training stimato
        is_training: True se training in corso
        current_epoch: Epoch corrente (se training)
        total_epochs: Epoch totali (se training)
        training_sessions_today: Sessioni training oggi
        avg_reward: Reward medio nel buffer
    """
    status: TrainingStatus = TrainingStatus.IDLE
    buffer_size: int = 0
    buffer_capacity: int = 0
    last_training_at: Optional[str] = None
    next_training_at: Optional[str] = None
    is_training: bool = False
    current_epoch: int = 0
    total_epochs: int = 0
    training_sessions_today: int = 0
    avg_reward: float = 0.0
    error_cooldown_remaining_seconds: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status.value,
            "buffer_size": self.buffer_size,
            "buffer_capacity": self.buffer_capacity,
            "last_training_at": self.last_training_at,
            "next_training_at": self.next_training_at,
            "is_training": self.is_training,
            "current_epoch": self.current_epoch,
            "total_epochs": self.total_epochs,
            "training_sessions_today": self.training_sessions_today,
            "avg_reward": round(self.avg_reward, 4),
            "error_cooldown_remaining_seconds": round(self.error_cooldown_remaining_seconds, 1) if self.error_cooldown_remaining_seconds is not None else None,
        }


@dataclass
class TrainingResult:
    """
    Risultato di un run di training.

    Attributes:
        success: True se training completato
        session_id: ID sessione training
        epochs_completed: Numero epoch completati
        total_loss: Loss totale
        avg_reward: Reward medio batch
        checkpoint_version: Version del checkpoint salvato
        duration_seconds: Durata in secondi
        error: Messaggio errore se fallito
    """
    success: bool = True
    session_id: Optional[str] = None
    epochs_completed: int = 0
    total_loss: float = 0.0
    avg_reward: float = 0.0
    checkpoint_version: Optional[str] = None
    loaded_from_checkpoint: bool = False
    duration_seconds: float = 0.0
    error: Optional[str] = None
    traversal_trained: bool = False
    traversal_samples: int = 0
    weight_version_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "session_id": self.session_id,
            "epochs_completed": self.epochs_completed,
            "total_loss": round(self.total_loss, 6),
            "avg_reward": round(self.avg_reward, 4),
            "checkpoint_version": self.checkpoint_version,
            "loaded_from_checkpoint": self.loaded_from_checkpoint,
            "duration_seconds": round(self.duration_seconds, 2),
            "error": self.error,
            "traversal_trained": self.traversal_trained,
            "traversal_samples": self.traversal_samples,
            "weight_version_id": self.weight_version_id,
        }


# =============================================================================
# TRAINING SCHEDULER
# =============================================================================

class TrainingScheduler:
    """
    Scheduler per training automatico RLCF.

    Monitora il buffer di esperienze e avvia training quando
    le condizioni sono soddisfatte.

    Thread-safe per uso concorrente.
    """

    def __init__(self, config: Optional[SchedulerConfig] = None):
        """
        Inizializza TrainingScheduler.

        Args:
            config: Configurazione scheduler (default values se None)
        """
        self.config = config or SchedulerConfig()

        # Buffer
        if self.config.prioritized_replay:
            self.buffer = PrioritizedReplayBuffer(
                capacity=self.config.max_buffer_size,
                alpha=self.config.alpha
            )
        else:
            self.buffer = ExperienceReplayBuffer(
                capacity=self.config.max_buffer_size
            )

        # State
        self._status = TrainingStatus.IDLE
        self._error_timestamp: Optional[float] = None
        self._last_training_at: Optional[datetime] = None
        self._current_epoch = 0
        self._total_epochs = 0
        self._training_sessions_today = 0
        self._last_session_date: Optional[str] = None

        # Async
        self._training_task: Optional[asyncio.Task] = None
        self._auto_training_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()
        self._scheduler = None  # APScheduler instance

        # Thread safety
        self._lock = threading.Lock()

        # Callbacks
        self._on_training_complete: Optional[Callable] = None
        self._on_training_error: Optional[Callable] = None

        # Auto-load buffer from disk if available
        if self.config.buffer_persistence_path:
            self._try_load_buffer()

        log.info(
            "TrainingScheduler initialized",
            config=self.config.to_dict(),
            buffer_size=len(self.buffer),
        )

    # -------------------------------------------------------------------------
    # BUFFER OPERATIONS
    # -------------------------------------------------------------------------

    def add_experience(
        self,
        trace: Any,
        feedback: Any,
        reward: float,
        td_error: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Aggiunge esperienza al buffer.

        Args:
            trace: ExecutionTrace
            feedback: MultilevelFeedback
            reward: Reward calcolato
            td_error: TD-error per priorità (opzionale)
            metadata: Dati aggiuntivi

        Returns:
            ID dell'esperienza
        """
        # Skip quarantined feedback (Story 9-5)
        feedback_status = getattr(feedback, "status", None)
        if metadata:
            feedback_status = feedback_status or metadata.get("feedback_status")
        if feedback_status in ("quarantined", "flagged", "deleted"):
            log.debug(
                "Experience rejected (quarantined/flagged)",
                status=feedback_status,
                reward=reward,
            )
            return ""

        if isinstance(self.buffer, PrioritizedReplayBuffer):
            exp_id = self.buffer.add(trace, feedback, reward, td_error, metadata)
        else:
            priority = 1.0 + abs(td_error or 0)
            exp_id = self.buffer.add(trace, feedback, reward, priority, metadata)

        log.debug(
            "Experience added",
            exp_id=exp_id,
            reward=reward,
            buffer_size=len(self.buffer)
        )

        return exp_id

    def get_buffer_stats(self) -> BufferStats:
        """Restituisce statistiche del buffer."""
        return self.buffer.get_stats()

    # -------------------------------------------------------------------------
    # TRAINING CONDITIONS
    # -------------------------------------------------------------------------

    def should_train(self) -> bool:
        """
        Verifica se le condizioni per il training sono soddisfatte.

        Returns:
            True se training dovrebbe essere avviato
        """
        with self._lock:
            # Non trainare se già in corso
            if self._status == TrainingStatus.TRAINING:
                return False

            # Non trainare se in pausa
            if self._status == TrainingStatus.PAUSED:
                return False

            # ERROR recovery: wait for cooldown then transition to IDLE
            if self._status == TrainingStatus.ERROR:
                if self._error_timestamp is not None:
                    elapsed = time.monotonic() - self._error_timestamp
                    if elapsed >= self.config.error_cooldown_seconds:
                        self._status = TrainingStatus.IDLE
                        self._error_timestamp = None
                        log.info(
                            "Training scheduler recovered from ERROR",
                            cooldown_elapsed=round(elapsed, 1),
                        )
                    else:
                        return False
                else:
                    return False

            # Check buffer threshold
            buffer_size = len(self.buffer)

            # Idle timeout: buffer non-empty but below threshold for >N days
            if buffer_size > 0 and buffer_size < self.config.buffer_threshold:
                oldest = self.buffer.oldest_timestamp()
                if oldest and (datetime.now(UTC).replace(tzinfo=None) - oldest) > timedelta(
                    days=self.config.idle_timeout_days
                ):
                    log.info(
                        "Idle timeout triggered",
                        buffer_size=buffer_size,
                        oldest_days=(datetime.now(UTC).replace(tzinfo=None) - oldest).days,
                    )
                    return True

            if buffer_size < self.config.buffer_threshold:
                return False

            # Check time interval
            if self._last_training_at:
                elapsed = datetime.now(UTC).replace(tzinfo=None) - self._last_training_at
                if elapsed.total_seconds() < self.config.min_interval_seconds:
                    return False

            return True

    def get_time_until_next_training(self) -> Optional[timedelta]:
        """
        Calcola tempo rimanente fino al prossimo training possibile.

        Returns:
            timedelta se applicabile, None altrimenti
        """
        if not self._last_training_at:
            return timedelta(seconds=0) if len(self.buffer) >= self.config.buffer_threshold else None

        elapsed = datetime.now(UTC).replace(tzinfo=None) - self._last_training_at
        remaining = self.config.min_interval_seconds - elapsed.total_seconds()

        if remaining <= 0:
            return timedelta(seconds=0)

        return timedelta(seconds=remaining)

    # -------------------------------------------------------------------------
    # TRAINING EXECUTION
    # -------------------------------------------------------------------------

    async def run_training_epoch(
        self,
        trigger: TrainingTrigger = TrainingTrigger.MANUAL
    ) -> TrainingResult:
        """
        Esegue un ciclo di training.

        Args:
            trigger: Cosa ha triggerato il training

        Returns:
            TrainingResult con metriche
        """
        start_time = datetime.now(UTC).replace(tzinfo=None)

        with self._lock:
            if self._status == TrainingStatus.TRAINING:
                return TrainingResult(
                    success=False,
                    error="Training already in progress"
                )

            if self._status == TrainingStatus.ERROR:
                remaining = self._get_error_cooldown_remaining()
                if remaining and remaining > 0:
                    return TrainingResult(
                        success=False,
                        error=f"Error cooldown active: {remaining:.0f}s remaining"
                    )
                # Cooldown elapsed — allow training, clear error state
                self._error_timestamp = None

            self._status = TrainingStatus.TRAINING
            self._total_epochs = self.config.epochs_per_run
            self._current_epoch = 0

        log.info(
            "Training started",
            trigger=trigger.value,
            buffer_size=len(self.buffer),
            epochs=self.config.epochs_per_run
        )

        # Fire on_training_start callbacks
        for cb in (self.config.on_training_start or []):
            try:
                if asyncio.iscoroutinefunction(cb):
                    await cb(trigger)
                else:
                    cb(trigger)
            except Exception as e:
                log.warning("on_training_start callback failed", error=str(e))

        try:
            # Load from checkpoint or create fresh policy
            policy, trainer, loaded_from_checkpoint = self._get_or_create_policy()

            # Loop β E.3: tool-gating policy trained in the SAME pass (optional,
            # failure-isolated so it never breaks expert-gating training).
            tool_policy = tool_trainer = None
            try:
                tool_policy, tool_trainer, _ = self._get_or_create_tool_policy()
            except Exception as e:
                log.warning("Tool policy unavailable for this epoch", error=str(e))
            tool_samples_processed = 0

            total_loss = 0.0
            total_reward = 0.0
            samples_processed = 0

            for epoch in range(self.config.epochs_per_run):
                with self._lock:
                    self._current_epoch = epoch + 1

                # Sample batch
                if isinstance(self.buffer, PrioritizedReplayBuffer):
                    batch, indices, weights = self.buffer.sample_with_priority(
                        self.config.batch_size
                    )
                else:
                    batch = self.buffer.sample(self.config.batch_size)
                    weights = [1.0] * len(batch)

                if not batch:
                    log.warning("Empty batch, skipping epoch", epoch=epoch)
                    continue

                # Training su batch
                epoch_loss = 0.0
                epoch_reward = 0.0

                for i, exp in enumerate(batch):
                    try:
                        # Reconstruct trace e feedback
                        from .execution_trace import ExecutionTrace
                        from .multilevel_feedback import MultilevelFeedback

                        trace = ExecutionTrace.from_dict(exp.trace_data)
                        feedback = MultilevelFeedback.from_dict(exp.feedback_data)

                        # Update policy
                        trace.set_reward(exp.reward)
                        metrics = trainer.update_from_feedback(trace, feedback)

                        # Loop β E.3: train the tool-gating policy on the SAME
                        # experience (independent of the gating update). Isolated:
                        # a tool-training error never aborts the gating sample.
                        if tool_trainer is not None:
                            try:
                                tm = tool_trainer.update_from_feedback(trace, feedback)
                                if tm.get("num_actions", 0) > 0:
                                    tool_samples_processed += 1
                            except Exception as te:  # noqa: BLE001
                                log.debug("tool policy update skipped", error=str(te))

                        # Weight loss by importance sampling
                        weighted_loss = metrics.get("loss", 0.0) * weights[i]
                        epoch_loss += weighted_loss
                        epoch_reward += exp.reward
                        samples_processed += 1

                    except Exception as e:
                        log.warning(
                            "Error processing experience",
                            exp_id=exp.experience_id,
                            error=str(e)
                        )

                if batch:
                    total_loss += epoch_loss / len(batch)
                    total_reward += epoch_reward / len(batch)

                log.debug(
                    "Epoch completed",
                    epoch=epoch + 1,
                    loss=epoch_loss / len(batch) if batch else 0,
                    avg_reward=epoch_reward / len(batch) if batch else 0
                )

            # Update state
            with self._lock:
                self._last_training_at = datetime.now(UTC).replace(tzinfo=None)
                self._status = TrainingStatus.IDLE
                self._error_timestamp = None
                self._current_epoch = 0
                self._update_sessions_today()

            duration = (datetime.now(UTC).replace(tzinfo=None) - start_time).total_seconds()

            # Save versioned checkpoint + latest alias
            checkpoint_version = None
            if self.config.auto_save_checkpoint and samples_processed > 0:
                checkpoint_version = self._save_checkpoint(policy, trainer)

            # Loop β E.3: persist the tool-gating policy too.
            if (self.config.auto_save_checkpoint and tool_trainer is not None
                    and tool_samples_processed > 0):
                self._save_tool_checkpoint(tool_policy, tool_trainer)
                log.info("Tool policy trained", tool_samples=tool_samples_processed,
                         num_updates=tool_trainer.num_updates)

            # Auto-save buffer to disk
            if self.config.buffer_persistence_path:
                self._try_save_buffer()

            # TraversalPolicy training (F8d)
            traversal_trained = False
            traversal_samples = 0
            try:
                from .traversal_training_service import TraversalTrainingService
                from .database import get_async_session
                traversal_svc = TraversalTrainingService()
                async with get_async_session() as trav_session:
                    trav_samples = await traversal_svc.prepare_training_data(trav_session)
                    if len(trav_samples) >= traversal_svc.MIN_SAMPLES:
                        trav_result = await traversal_svc.train_traversal_policy(trav_samples)
                        traversal_trained = trav_result.epochs_completed > 0
                        traversal_samples = trav_result.samples_used
                        log.info("TraversalPolicy trained", **trav_result.to_dict())
            except Exception as e:
                log.warning("TraversalPolicy training skipped", error=str(e))

            # Persist weight config to database (gating priors + traversal weights)
            traversal_weights = None
            if traversal_trained:
                try:
                    traversal_weights = traversal_svc.get_domain_weights_table()
                except Exception as e:
                    log.debug("traversal_weights_extraction_skipped", error=str(e))

            weight_version_id = await self._persist_weight_config(
                policy=policy,
                checkpoint_version=checkpoint_version,
                samples_processed=samples_processed,
                traversal_weights=traversal_weights,
                tool_policy=tool_policy,
            )

            result = TrainingResult(
                success=True,
                epochs_completed=self.config.epochs_per_run,
                total_loss=total_loss / self.config.epochs_per_run if self.config.epochs_per_run > 0 else 0,
                avg_reward=total_reward / self.config.epochs_per_run if self.config.epochs_per_run > 0 else 0,
                checkpoint_version=checkpoint_version,
                loaded_from_checkpoint=loaded_from_checkpoint,
                duration_seconds=duration,
                traversal_trained=traversal_trained,
                traversal_samples=traversal_samples,
                weight_version_id=weight_version_id,
            )

            log.info(
                "Training completed",
                **result.to_dict()
            )

            if self._on_training_complete:
                self._on_training_complete(result)

            # Fire config-level callbacks
            for cb in (self.config.on_training_complete_callbacks or []):
                try:
                    if asyncio.iscoroutinefunction(cb):
                        await cb(result)
                    else:
                        cb(result)
                except Exception as e:
                    log.warning("on_training_complete callback failed", error=str(e))

            return result

        except Exception as e:
            with self._lock:
                self._status = TrainingStatus.ERROR
                self._error_timestamp = time.monotonic()

            log.error("Training failed", error=str(e))

            result = TrainingResult(
                success=False,
                error=str(e),
                duration_seconds=(datetime.now(UTC).replace(tzinfo=None) - start_time).total_seconds()
            )

            if self._on_training_error:
                self._on_training_error(result)

            for cb in (self.config.on_training_error_callbacks or []):
                try:
                    if asyncio.iscoroutinefunction(cb):
                        await cb(result)
                    else:
                        cb(result)
                except Exception as e2:
                    log.warning("on_training_error callback failed", error=str(e2))

            return result

    def _update_sessions_today(self):
        """Aggiorna contatore sessioni oggi."""
        today = datetime.now(UTC).replace(tzinfo=None).strftime("%Y-%m-%d")
        if self._last_session_date != today:
            self._training_sessions_today = 0
            self._last_session_date = today
        self._training_sessions_today += 1

    # -------------------------------------------------------------------------
    # AUTO TRAINING (APScheduler)
    # -------------------------------------------------------------------------

    async def start_auto_training(self, check_interval: int = 60):
        """
        Avvia training automatico in background via APScheduler.

        Args:
            check_interval: Intervallo check in secondi
        """
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from apscheduler.triggers.interval import IntervalTrigger
        except ImportError:
            log.warning("APScheduler not installed, falling back to asyncio loop")
            await self._start_auto_training_fallback(check_interval)
            return

        if self._scheduler is not None and self._scheduler.running:
            log.warning("Auto training already running")
            return

        self._scheduler = AsyncIOScheduler()
        self._scheduler.add_job(
            self._auto_training_check,
            trigger=IntervalTrigger(seconds=check_interval),
            id="rlcf_training_check",
            replace_existing=True,
        )
        self._scheduler.start()
        log.info("Auto training started (APScheduler)", check_interval=check_interval)

    async def stop_auto_training(self):
        """Ferma training automatico."""
        if self._scheduler is not None and self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None
            log.info("Auto training stopped (APScheduler)")
            return

        # Fallback stop
        self._stop_event.set()
        if self._auto_training_task:
            self._auto_training_task.cancel()
            try:
                await self._auto_training_task
            except asyncio.CancelledError:
                pass
        log.info("Auto training stopped")

    async def _auto_training_check(self):
        """APScheduler job: check conditions and run training if needed."""
        try:
            if self.should_train():
                await self.run_training_epoch(
                    trigger=TrainingTrigger.BUFFER_THRESHOLD
                )
        except Exception as e:
            log.error("Error in auto training check", error=str(e))

    async def _start_auto_training_fallback(self, check_interval: int):
        """Fallback to asyncio loop when APScheduler is not available."""
        if self._auto_training_task and not self._auto_training_task.done():
            return
        self._stop_event.clear()
        self._auto_training_task = asyncio.create_task(
            self._auto_training_loop(check_interval)
        )

    async def _auto_training_loop(self, check_interval: int):
        """Fallback loop for auto training."""
        while not self._stop_event.is_set():
            try:
                if self.should_train():
                    await self.run_training_epoch(
                        trigger=TrainingTrigger.BUFFER_THRESHOLD
                    )
                await asyncio.sleep(check_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error("Error in auto training loop", error=str(e))
                await asyncio.sleep(check_interval)

    # -------------------------------------------------------------------------
    # BUFFER PERSISTENCE
    # -------------------------------------------------------------------------

    def _try_load_buffer(self) -> None:
        """Load buffer from disk if file exists. Graceful on errors."""
        path = self.config.buffer_persistence_path
        if not Path(path).exists():
            log.info("No buffer file found, starting fresh", path=path)
            return
        try:
            self.buffer.load(path)
        except Exception as e:
            log.warning(
                "Buffer file corrupted, starting fresh",
                path=path,
                error=str(e),
            )

    def _try_save_buffer(self) -> None:
        """Save buffer to disk. Graceful on errors."""
        path = self.config.buffer_persistence_path
        try:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self.buffer.save(path)
        except Exception as e:
            log.warning("Buffer save failed", path=path, error=str(e))

    # -------------------------------------------------------------------------
    # POLICY CHECKPOINT MANAGEMENT
    # -------------------------------------------------------------------------

    def _get_or_create_policy(self) -> Tuple[Any, Any, bool]:
        """
        Load ExpertGatingMLP from latest checkpoint, or create fresh if none exists.

        Returns:
            Tuple (policy, trainer, loaded_from_checkpoint)
        """
        from .policy_gradient import PolicyGradientTrainer
        from merlt.experts.neural_gating.neural import ExpertGatingMLP, GatingConfig

        checkpoint_dir = Path(self.config.checkpoint_dir)
        trainer_path = checkpoint_dir / "gating_trainer_latest.pt"

        policy = ExpertGatingMLP(GatingConfig(input_dim=1024))
        trainer = PolicyGradientTrainer(policy)

        if trainer_path.exists():
            try:
                trainer.load_checkpoint(str(trainer_path))
                log.info(
                    "ExpertGatingMLP loaded from checkpoint",
                    path=str(trainer_path),
                    num_updates=trainer.num_updates,
                    baseline=trainer.baseline,
                )
                return policy, trainer, True
            except Exception as e:
                log.warning(
                    "Checkpoint load failed, using fresh policy",
                    path=str(trainer_path),
                    error=str(e),
                )

        log.info("No checkpoint found, using fresh ExpertGatingMLP")
        return policy, trainer, False

    def _get_or_create_tool_policy(self) -> Tuple[Any, Any, bool]:
        """Loop β E.3: load ToolGatingMLP from checkpoint, else create fresh.

        Returns (policy, trainer, loaded_from_checkpoint). Mirrors
        _get_or_create_policy but for the tool-gating REINFORCE policy.
        """
        from .policy_gradient import ToolPolicyTrainer
        from merlt.experts.neural_gating.tool_neural import ToolGatingMLP, ToolGatingConfig

        checkpoint_dir = Path(self.config.checkpoint_dir)
        trainer_path = checkpoint_dir / "tool_trainer_latest.pt"

        policy = ToolGatingMLP(ToolGatingConfig(input_dim=1024))
        trainer = ToolPolicyTrainer(policy)

        if trainer_path.exists():
            try:
                trainer.load_checkpoint(str(trainer_path))
                log.info("ToolGatingMLP loaded from checkpoint",
                         path=str(trainer_path), num_updates=trainer.num_updates)
                return policy, trainer, True
            except Exception as e:
                log.warning("Tool checkpoint load failed, using fresh policy",
                            path=str(trainer_path), error=str(e))

        log.info("No tool checkpoint found, using fresh ToolGatingMLP")
        return policy, trainer, False

    def _save_tool_checkpoint(self, policy: Any, trainer: Any) -> None:
        """Save the tool-gating policy (trainer-format latest + versioned +
        inference-format for PolicyManager). Mirrors _save_checkpoint."""
        checkpoint_dir = Path(self.config.checkpoint_dir)
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        try:
            version_tag = datetime.now(UTC).replace(tzinfo=None).strftime("%Y%m%d_%H%M%S")
            trainer.save_checkpoint(str(checkpoint_dir / f"tool_{version_tag}.pt"))
            trainer.save_checkpoint(str(checkpoint_dir / "tool_trainer_latest.pt"))
            log.info("Tool checkpoint saved", version=version_tag)
        except Exception as e:  # noqa: BLE001
            log.warning("Tool trainer checkpoint save failed", error=str(e))
        # The inference-format checkpoint is what the orchestrator loads at boot
        # (tool_policy_latest.pt). If it fails, the boot WARM-STARTS fresh and
        # discards trained pruning — surface it at error level (don't bury it in
        # the trainer-checkpoint catch above).
        try:
            from .policy_manager import PolicyManager, PolicyConfig
            pm = PolicyManager(config=PolicyConfig(checkpoint_dir=checkpoint_dir))
            pm.save_tool_policy(policy, name="latest")
        except Exception as e:  # noqa: BLE001
            log.error("Tool inference checkpoint save failed — boot will warm-start fresh",
                      error=str(e))

    def _save_checkpoint(self, policy: Any, trainer: Any) -> Optional[str]:
        """
        Save versioned checkpoint AND latest alias.

        Returns:
            checkpoint_version string, or None on failure
        """
        checkpoint_dir = Path(self.config.checkpoint_dir)
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        version_tag = f"{datetime.now(UTC).replace(tzinfo=None).strftime('%Y%m%d_%H%M%S')}_{self._training_sessions_today}"
        checkpoint_version = f"v{version_tag}"

        try:
            # Save versioned checkpoint (includes optimizer state + baseline)
            versioned_path = checkpoint_dir / f"gating_{checkpoint_version}.pt"
            trainer.save_checkpoint(str(versioned_path))

            # Save trainer-format latest for training resumption
            trainer_latest = checkpoint_dir / "gating_trainer_latest.pt"
            trainer.save_checkpoint(str(trainer_latest))

            # Save inference-format latest for PolicyManager loading
            # Uses separate file with mlp_state_dict format
            from .policy_manager import PolicyManager, PolicyConfig
            pm = PolicyManager(config=PolicyConfig(checkpoint_dir=checkpoint_dir))
            pm.save_gating_policy(policy, name="latest")

            log.info(
                "Checkpoint saved",
                version=checkpoint_version,
                versioned_path=str(versioned_path),
                latest=True,
            )
            return checkpoint_version

        except Exception as e:
            log.warning("Checkpoint save failed", error=str(e))
            return None

    # -------------------------------------------------------------------------
    # WEIGHT PERSISTENCE
    # -------------------------------------------------------------------------

    def _extract_weight_config(
        self,
        policy: Any,
        traversal_weights: Optional[Dict[str, Dict[str, float]]] = None,
        tool_policy: Any = None,
    ) -> "WeightConfig":
        """
        Extract current weight configuration from trained policy state.

        Builds a WeightConfig from:
        - GatingPolicy softmax output (expert priors)
        - Traversal relation weights (if available)
        - Tool-gating per-tool call-probabilities (Loop β E.3, if available)
        - Default values for retrieval and RLCF (updated separately by WeightLearner)
        """
        from merlt.weights.config import (
            WeightConfig,
            GatingWeights,
            ExpertTraversalWeights,
            LearnableWeight,
            ToolGatingWeights,
        )

        # Extract expert priors from policy (ExpertGatingMLP or GatingPolicy)
        expert_names = ["LiteralExpert", "SystemicExpert", "PrinciplesExpert", "PrecedentExpert"]
        short_names = ["literal", "systemic", "principles", "precedent"]
        expert_priors = {}

        try:
            if hasattr(policy, 'get_expert_priors'):
                # ExpertGatingMLP: use get_expert_priors() directly
                priors = policy.get_expert_priors()
                for short, pascal in zip(short_names, expert_names):
                    w = priors.get(short, 0.25)
                    expert_priors[pascal] = LearnableWeight(
                        default=round(w, 4),
                        bounds=(0.1, 0.5),
                        learnable=True,
                    )
            else:
                # Legacy GatingPolicy fallback
                import torch
                orig_device = getattr(policy, 'device', 'cpu')
                policy.to("cpu")
                try:
                    with torch.no_grad():
                        dummy = torch.zeros(1, getattr(policy, 'input_dim', 1024))
                        logits = policy.mlp(dummy)
                        weights = torch.softmax(logits, dim=-1).squeeze(0)
                        for i, name in enumerate(expert_names):
                            w = float(weights[i].item())
                            expert_priors[name] = LearnableWeight(
                                default=round(w, 4),
                                bounds=(0.1, 0.5),
                                learnable=True,
                            )
                finally:
                    policy.to(orig_device)
        except Exception as e:
            log.debug("extract_gating_weights_fallback", error=str(e))
            for name in expert_names:
                expert_priors[name] = LearnableWeight(default=0.25, bounds=(0.1, 0.5))

        # Build expert traversal weights from TraversalPolicy table
        expert_traversal = {}
        if traversal_weights:
            for expert_key, rel_weights in traversal_weights.items():
                # Map short expert name → PascalCase
                pascal_name = {
                    "literal": "LiteralExpert",
                    "systemic": "SystemicExpert",
                    "principles": "PrinciplesExpert",
                    "precedent": "PrecedentExpert",
                }.get(expert_key, expert_key)

                lw_map = {}
                for rel_type, w in rel_weights.items():
                    lw_map[rel_type] = LearnableWeight(
                        default=round(w, 4),
                        bounds=(0.0, 1.0),
                        learnable=True,
                    )
                expert_traversal[pascal_name] = ExpertTraversalWeights(weights=lw_map)

        # Tool-gating per-tool call-probabilities (Loop β E.3).
        tool_gating = None
        if tool_policy is not None:
            try:
                priors = tool_policy.get_tool_priors()  # {tool: P(call)}
                tool_gating = ToolGatingWeights(
                    tool_priors={
                        t: LearnableWeight(default=round(float(p), 4), bounds=(0.0, 1.0), learnable=True)
                        for t, p in priors.items()
                    }
                )
            except Exception as e:
                log.debug("extract_tool_weights_skipped", error=str(e))

        return WeightConfig(
            gating=GatingWeights(expert_priors=expert_priors),
            expert_traversal=expert_traversal,
            tool_gating=tool_gating,
        )

    async def _persist_weight_config(
        self,
        policy: Any,
        checkpoint_version: Optional[str],
        samples_processed: int,
        traversal_weights: Optional[Dict[str, Dict[str, float]]] = None,
        tool_policy: Any = None,
    ) -> Optional[str]:
        """
        Persist current weight configuration to database via WeightStore.

        Returns:
            weight version ID, or None if persistence skipped/failed
        """
        import os

        db_url = os.environ.get("RLCF_DATABASE_URL")
        if not db_url:
            log.debug("weight_persistence_skipped", reason="RLCF_DATABASE_URL not set")
            return None

        try:
            from merlt.weights.store import WeightStore

            config = self._extract_weight_config(policy, traversal_weights, tool_policy=tool_policy)
            store = WeightStore(database_url=db_url)

            version_id = await store.save_weights(
                config=config,
                experiment_id=self.config.experiment_id,
                metrics={
                    "checkpoint_version": checkpoint_version or "none",
                    "samples_processed": float(samples_processed),
                    "epochs": float(self.config.epochs_per_run),
                },
            )

            log.info(
                "Weight config persisted to database",
                weight_version_id=version_id,
                checkpoint_version=checkpoint_version,
            )
            return version_id

        except Exception as e:
            log.warning("weight_persistence_failed", error=str(e))
            return None

    # -------------------------------------------------------------------------
    # STATUS AND CONTROL
    # -------------------------------------------------------------------------

    def get_status(self) -> SchedulerStatus:
        """Restituisce stato corrente dello scheduler."""
        with self._lock:
            buffer_stats = self.buffer.get_stats()

            next_training = None
            remaining = self.get_time_until_next_training()
            if remaining is not None:
                next_training = (datetime.now(UTC).replace(tzinfo=None) + remaining).isoformat()

            return SchedulerStatus(
                status=self._status,
                buffer_size=buffer_stats.size,
                buffer_capacity=buffer_stats.capacity,
                last_training_at=self._last_training_at.isoformat() if self._last_training_at else None,
                next_training_at=next_training,
                is_training=self._status == TrainingStatus.TRAINING,
                current_epoch=self._current_epoch,
                total_epochs=self._total_epochs,
                training_sessions_today=self._training_sessions_today,
                avg_reward=buffer_stats.avg_reward,
                error_cooldown_remaining_seconds=self._get_error_cooldown_remaining(),
            )

    def _get_error_cooldown_remaining(self) -> Optional[float]:
        """Returns remaining cooldown seconds if in ERROR state, else None."""
        if self._status == TrainingStatus.ERROR and self._error_timestamp is not None:
            elapsed = time.monotonic() - self._error_timestamp
            remaining = self.config.error_cooldown_seconds - elapsed
            return max(0.0, remaining)
        return None

    def pause(self):
        """Mette in pausa il training automatico."""
        with self._lock:
            if self._status != TrainingStatus.TRAINING:
                self._status = TrainingStatus.PAUSED
        log.info("Training paused")

    def resume(self):
        """Riprende il training automatico."""
        with self._lock:
            if self._status == TrainingStatus.PAUSED:
                self._status = TrainingStatus.IDLE
        log.info("Training resumed")

    def set_on_training_complete(self, callback: Callable[[TrainingResult], None]):
        """Imposta callback per training completato."""
        self._on_training_complete = callback

    def set_on_training_error(self, callback: Callable[[TrainingResult], None]):
        """Imposta callback per errore training."""
        self._on_training_error = callback


# =============================================================================
# SINGLETON
# =============================================================================

_scheduler_instance: Optional[TrainingScheduler] = None
_scheduler_lock = threading.Lock()


def get_scheduler(config: Optional[SchedulerConfig] = None) -> TrainingScheduler:
    """
    Ottiene singleton TrainingScheduler.

    Args:
        config: Configurazione (usata solo alla prima chiamata)

    Returns:
        TrainingScheduler singleton
    """
    global _scheduler_instance

    with _scheduler_lock:
        if _scheduler_instance is None:
            _scheduler_instance = TrainingScheduler(config)
        return _scheduler_instance


def reset_scheduler():
    """Reset singleton (per testing)."""
    global _scheduler_instance
    with _scheduler_lock:
        _scheduler_instance = None
