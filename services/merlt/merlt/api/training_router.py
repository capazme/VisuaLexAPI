"""
Training API Router
===================

Endpoint per gestione training RLCF automatico.

Endpoints:
- GET /training/status - Stato scheduler e buffer
- POST /training/start - Avvia training manuale
- POST /training/pause - Pausa training automatico
- POST /training/resume - Riprende training automatico
- GET /training/buffer - Statistiche buffer esperienze
- POST /training/add-experience - Aggiunge esperienza al buffer
- GET /training/config - Configurazione scheduler
- PUT /training/config - Aggiorna configurazione

Nota: Training automatico gira in background quando abilitato.
"""

import structlog
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.rlcf.training_scheduler import (
    get_scheduler,
    TrainingScheduler,
    SchedulerConfig,
    SchedulerStatus,
    TrainingResult,
    TrainingTrigger,
    TrainingStatus,
)
from merlt.rlcf.replay_buffer import BufferStats

log = structlog.get_logger()

router = APIRouter(prefix="/training", tags=["RLCF Training"])


# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class TrainingStatusResponse(BaseModel):
    """Response per status training."""
    status: str = Field(..., description="Stato corrente (idle, training, paused, error)")
    buffer_size: int = Field(..., description="Esperienze nel buffer")
    buffer_capacity: int = Field(..., description="Capacita' massima buffer")
    last_training_at: Optional[str] = Field(None, description="Ultimo training (ISO)")
    next_training_at: Optional[str] = Field(None, description="Prossimo training stimato (ISO)")
    is_training: bool = Field(..., description="True se training in corso")
    current_epoch: int = Field(0, description="Epoch corrente")
    total_epochs: int = Field(0, description="Epoch totali previsti")
    training_sessions_today: int = Field(0, description="Sessioni oggi")
    avg_reward: float = Field(0.0, description="Reward medio nel buffer")
    # Frontend-compatible alias fields (TrainingStatus in rlcfService.ts)
    is_running: bool = Field(default=False, description="Alias for is_training")
    is_paused: bool = Field(default=False)
    current_loss: Optional[float] = None
    best_loss: Optional[float] = None
    learning_rate: Optional[float] = None


class StartTrainingRequest(BaseModel):
    """Request per avvio training."""
    epochs: Optional[int] = Field(None, ge=1, le=100, description="Override numero epoch")
    batch_size: Optional[int] = Field(None, ge=8, le=256, description="Override batch size")


class StartTrainingResponse(BaseModel):
    """Response dopo avvio training."""
    success: bool
    message: str
    training_id: Optional[str] = None


class TrainingResultResponse(BaseModel):
    """Response con risultato training."""
    success: bool
    session_id: Optional[str] = None
    epochs_completed: int = 0
    total_loss: float = 0.0
    avg_reward: float = 0.0
    checkpoint_version: Optional[str] = None
    duration_seconds: float = 0.0
    error: Optional[str] = None


class BufferStatsResponse(BaseModel):
    """Response con statistiche buffer."""
    size: int = Field(..., description="Esperienze nel buffer")
    capacity: int = Field(..., description="Capacita' massima")
    total_added: int = Field(..., description="Totale esperienze aggiunte")
    total_sampled: int = Field(..., description="Totale campionamenti")
    avg_reward: float = Field(0.0, description="Reward medio")
    avg_priority: float = Field(1.0, description="Priorita' media")
    fill_ratio: float = Field(0.0, description="Rapporto riempimento")


class AddExperienceRequest(BaseModel):
    """Request per aggiungere esperienza."""
    trace_data: dict = Field(..., description="ExecutionTrace serializzata")
    feedback_data: dict = Field(..., description="MultilevelFeedback serializzato")
    reward: float = Field(..., ge=-1.0, le=1.0, description="Reward [-1, 1]")
    td_error: Optional[float] = Field(None, description="TD-error per priorita'")
    metadata: Optional[dict] = Field(None, description="Metadata aggiuntivi")


class AddExperienceResponse(BaseModel):
    """Response dopo aggiunta esperienza."""
    success: bool = True
    experience_id: str = Field(..., description="ID esperienza")
    buffer_size: int = Field(..., description="Nuovo size buffer")
    training_ready: bool = Field(False, description="True se buffer ha raggiunto threshold")


class SchedulerConfigRequest(BaseModel):
    """Request per aggiornare configurazione."""
    buffer_threshold: Optional[int] = Field(None, ge=10, le=10000)
    min_interval_seconds: Optional[int] = Field(None, ge=60, le=86400)
    batch_size: Optional[int] = Field(None, ge=8, le=256)
    epochs_per_run: Optional[int] = Field(None, ge=1, le=100)
    auto_save_checkpoint: Optional[bool] = None


class SchedulerConfigResponse(BaseModel):
    """Response con configurazione."""
    buffer_threshold: int
    min_interval_seconds: int
    max_buffer_size: int
    batch_size: int
    epochs_per_run: int
    prioritized_replay: bool
    alpha: float
    auto_save_checkpoint: bool


# =============================================================================
# DEPENDENCY
# =============================================================================

def get_training_scheduler() -> TrainingScheduler:
    """Dependency per ottenere scheduler."""
    return get_scheduler()


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.get(
    "/status",
    response_model=TrainingStatusResponse,
    summary="Stato training scheduler"
)
async def get_training_status(
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(verify_api_key),
) -> TrainingStatusResponse:
    """
    Ritorna lo stato corrente del training scheduler.

    Include:
    - Stato (idle, training, paused, error)
    - Dimensione buffer
    - Timestamp ultimo/prossimo training
    - Metriche sessione corrente
    """
    status = scheduler.get_status()

    return TrainingStatusResponse(
        status=status.status.value,
        buffer_size=status.buffer_size,
        buffer_capacity=status.buffer_capacity,
        last_training_at=status.last_training_at,
        next_training_at=status.next_training_at,
        is_training=status.is_training,
        current_epoch=status.current_epoch,
        total_epochs=status.total_epochs,
        training_sessions_today=status.training_sessions_today,
        avg_reward=status.avg_reward,
        is_running=status.is_training,
        is_paused=status.status.value == "paused",
    )


@router.post(
    "/start",
    response_model=TrainingResultResponse,
    summary="Avvia training manuale"
)
async def start_training(
    request: StartTrainingRequest = None,
    background_tasks: BackgroundTasks = None,
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(require_role("admin")),
) -> TrainingResultResponse:
    """
    Avvia un ciclo di training manualmente.

    Il training viene eseguito in modo sincrono.
    Per training in background, usare /start-async.
    """
    status = scheduler.get_status()

    if status.is_training:
        raise HTTPException(
            status_code=409,
            detail="Training already in progress"
        )

    if status.buffer_size < 10:
        raise HTTPException(
            status_code=400,
            detail=f"Buffer too small ({status.buffer_size}). Need at least 10 experiences."
        )

    log.info(
        "Manual training requested",
        buffer_size=status.buffer_size,
        epochs=request.epochs if request else None
    )

    # Esegui training
    result = await scheduler.run_training_epoch(trigger=TrainingTrigger.API)

    return TrainingResultResponse(
        success=result.success,
        session_id=result.session_id,
        epochs_completed=result.epochs_completed,
        total_loss=result.total_loss,
        avg_reward=result.avg_reward,
        checkpoint_version=result.checkpoint_version,
        duration_seconds=result.duration_seconds,
        error=result.error,
    )


@router.post(
    "/pause",
    summary="Pausa training automatico"
)
async def pause_training(
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(require_role("admin")),
) -> dict:
    """Mette in pausa il training automatico."""
    scheduler.pause()
    return {"success": True, "message": "Training paused"}


@router.post(
    "/resume",
    summary="Riprende training automatico"
)
async def resume_training(
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(require_role("admin")),
) -> dict:
    """Riprende il training automatico."""
    scheduler.resume()
    return {"success": True, "message": "Training resumed"}


@router.get(
    "/buffer",
    response_model=BufferStatsResponse,
    summary="Statistiche buffer esperienze"
)
async def get_buffer_stats(
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(verify_api_key),
) -> BufferStatsResponse:
    """
    Ritorna statistiche del buffer di esperienze.

    Include:
    - Dimensione corrente e capacità
    - Totale esperienze aggiunte/campionate
    - Reward e priorità medi
    """
    stats = scheduler.get_buffer_stats()

    return BufferStatsResponse(
        size=stats.size,
        capacity=stats.capacity,
        total_added=stats.total_added,
        total_sampled=stats.total_sampled,
        avg_reward=stats.avg_reward,
        avg_priority=stats.avg_priority,
        fill_ratio=stats.size / stats.capacity if stats.capacity > 0 else 0,
    )


@router.post(
    "/add-experience",
    response_model=AddExperienceResponse,
    summary="Aggiunge esperienza al buffer"
)
async def add_experience(
    request: AddExperienceRequest,
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(verify_api_key),
) -> AddExperienceResponse:
    """
    Aggiunge un'esperienza al buffer di replay.

    L'esperienza viene usata per training futuro.
    Ritorna se il buffer ha raggiunto la soglia per training.
    """
    exp_id = scheduler.add_experience(
        trace=request.trace_data,
        feedback=request.feedback_data,
        reward=request.reward,
        td_error=request.td_error,
        metadata=request.metadata,
    )

    stats = scheduler.get_buffer_stats()
    training_ready = scheduler.should_train()

    return AddExperienceResponse(
        success=True,
        experience_id=exp_id,
        buffer_size=stats.size,
        training_ready=training_ready,
    )


@router.get(
    "/config",
    response_model=SchedulerConfigResponse,
    summary="Configurazione scheduler"
)
async def get_scheduler_config(
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(verify_api_key),
) -> SchedulerConfigResponse:
    """Ritorna configurazione corrente dello scheduler."""
    config = scheduler.config

    return SchedulerConfigResponse(
        buffer_threshold=config.buffer_threshold,
        min_interval_seconds=config.min_interval_seconds,
        max_buffer_size=config.max_buffer_size,
        batch_size=config.batch_size,
        epochs_per_run=config.epochs_per_run,
        prioritized_replay=config.prioritized_replay,
        alpha=config.alpha,
        auto_save_checkpoint=config.auto_save_checkpoint,
    )


@router.put(
    "/config",
    response_model=SchedulerConfigResponse,
    summary="Aggiorna configurazione"
)
async def update_scheduler_config(
    request: SchedulerConfigRequest,
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(require_role("admin")),
) -> SchedulerConfigResponse:
    """
    Aggiorna configurazione dello scheduler.

    Solo i campi specificati vengono aggiornati.
    """
    if request.buffer_threshold is not None:
        scheduler.config.buffer_threshold = request.buffer_threshold

    if request.min_interval_seconds is not None:
        scheduler.config.min_interval_seconds = request.min_interval_seconds

    if request.batch_size is not None:
        scheduler.config.batch_size = request.batch_size

    if request.epochs_per_run is not None:
        scheduler.config.epochs_per_run = request.epochs_per_run

    if request.auto_save_checkpoint is not None:
        scheduler.config.auto_save_checkpoint = request.auto_save_checkpoint

    log.info("Scheduler config updated", config=scheduler.config.to_dict())

    return await get_scheduler_config(scheduler)


@router.post(
    "/start-auto",
    summary="Avvia training automatico in background"
)
async def start_auto_training(
    check_interval: int = 60,
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(require_role("admin")),
) -> dict:
    """
    Avvia il training automatico in background.

    Il training viene eseguito quando:
    1. Buffer raggiunge la soglia
    2. Intervallo minimo tra training e' passato

    Args:
        check_interval: Intervallo check in secondi (default 60)
    """
    await scheduler.start_auto_training(check_interval)

    return {
        "success": True,
        "message": f"Auto training started with {check_interval}s check interval"
    }


@router.post(
    "/stop-auto",
    summary="Ferma training automatico"
)
async def stop_auto_training(
    scheduler: TrainingScheduler = Depends(get_training_scheduler),
    api_key: ApiKey = Depends(require_role("admin")),
) -> dict:
    """Ferma il training automatico in background."""
    await scheduler.stop_auto_training()

    return {"success": True, "message": "Auto training stopped"}
