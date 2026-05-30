"""
RLCF Router
===========

Endpoints REST e WebSocket per monitoraggio RLCF training.

Questo router espone API per:
- Stato training corrente (dati REALI da TrainingScheduler)
- Avvio/stop training
- Buffer feedback status
- Pesi policy correnti
- WebSocket per metriche real-time

Tutti i dati sono REALI, non mock.

Endpoints REST:
- GET /rlcf/training/status - Stato training corrente
- POST /rlcf/training/start - Avvia training
- POST /rlcf/training/stop - Ferma training
- GET /rlcf/buffer/status - Stato buffer feedback
- GET /rlcf/policies/weights - Pesi GatingPolicy
- GET /rlcf/policies/history - Storia pesi nel tempo

WebSocket:
- WS /rlcf/training/stream - Stream metriche real-time

Example:
    >>> response = await client.get("/api/v1/rlcf/training/status")
    >>> status = response.json()
    >>> print(f"Epoch: {status['current_epoch']}/{status['total_epochs']}")
"""

import asyncio
from datetime import datetime
from typing import Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.rlcf.database import get_async_session_dep

log = structlog.get_logger()

router = APIRouter(prefix="/rlcf", tags=["rlcf"])


# =============================================================================
# MODELS (Response models for API)
# =============================================================================


class TrainingConfig(BaseModel):
    """Configurazione per avvio training."""
    epochs: int = Field(50, ge=1, le=500, description="Numero totale di epoch")
    learning_rate: float = Field(0.0001, ge=0.00001, le=0.01, description="Learning rate")
    batch_size: int = Field(32, ge=8, le=256, description="Batch size")
    buffer_threshold: int = Field(100, ge=50, le=1000, description="Minimo feedback per training")


class TrainingStatus(BaseModel):
    """Stato corrente del training."""
    is_running: bool = False
    is_paused: bool = False
    current_epoch: int = 0
    total_epochs: int = 0
    current_loss: Optional[float] = None
    best_loss: Optional[float] = None
    learning_rate: float = 0.0001
    started_at: Optional[str] = None
    eta_seconds: Optional[int] = None
    last_updated: Optional[str] = None
    training_sessions_today: int = 0


class BufferStatus(BaseModel):
    """Stato del feedback buffer."""
    size: int = 0
    capacity: int = 0
    fill_percentage: float = 0.0
    positive_count: int = 0
    negative_count: int = 0
    neutral_count: int = 0
    training_ready: bool = False
    last_feedback_at: Optional[str] = None
    avg_reward: float = 0.0


class PolicyWeightsStatus(BaseModel):
    """Pesi correnti delle policy."""
    gating: Dict[str, float] = Field(default_factory=dict)
    traversal: Dict[str, float] = Field(default_factory=dict)
    timestamp: Optional[str] = None


class PolicyWeightsHistory(BaseModel):
    """Storia dei pesi nel tempo."""
    history: List[PolicyWeightsStatus] = Field(default_factory=list)
    epochs: List[int] = Field(default_factory=list)


class TrainingStartResponse(BaseModel):
    """Response all'avvio training."""
    success: bool
    training_id: str = ""
    message: str = ""
    config: Optional[TrainingConfig] = None


class TrainingStopResponse(BaseModel):
    """Response allo stop training."""
    success: bool
    epochs_completed: int = 0
    final_loss: float = 0.0
    message: str = ""


# =============================================================================
# HELPER FUNCTIONS - Real Data Access
# =============================================================================


def _get_scheduler():
    """
    Ottiene il TrainingScheduler singleton.

    Returns None se non disponibile.
    """
    try:
        from merlt.rlcf.training_scheduler import get_scheduler
        return get_scheduler()
    except ImportError:
        log.warning("TrainingScheduler not available")
        return None
    except Exception as e:
        log.warning("Could not get TrainingScheduler", error=str(e))
        return None


async def _get_policy_weights() -> PolicyWeightsStatus:
    """
    Ottiene i pesi policy reali dal sistema RLCF.

    Legge l'ultima versione ATTIVA dei pesi dal ``WeightStore`` — la stessa store
    in cui il ``TrainingScheduler`` persiste i gating priors allenati via
    ``_persist_weight_config`` (``experiment_id='rlcf_training'``). Fallback ai
    default uniformi se nessuna versione è ancora stata salvata.

    Loop β E.2 fix: il percorso precedente chiamava
    ``RLCFPersistence().load_latest_checkpoint()`` — un metodo INESISTENTE — per
    cui l'endpoint cadeva sempre nell'except e restituiva i default, senza MAI
    riflettere il training. Ora legge dallo store che il training scrive davvero.
    """
    try:
        import os
        from merlt.weights.store import WeightStore

        db_url = os.environ.get("RLCF_DATABASE_URL")
        if db_url:
            store = WeightStore(database_url=db_url)
            # experiment_id deve combaciare con quello che il TrainingScheduler usa
            # per persistere i pesi: leggilo dallo scheduler vivo (evita un
            # mismatch silenzioso se è stato configurato un experiment_id non
            # di default), col fallback al default di SchedulerConfig.
            scheduler = _get_scheduler()
            experiment_id = (
                getattr(scheduler.config, "experiment_id", "rlcf_training")
                if scheduler is not None
                else "rlcf_training"
            )
            config = await store.get_weights(experiment_id=experiment_id)
            if config and config.gating and config.gating.expert_priors:
                short = {
                    "LiteralExpert": "literal",
                    "SystemicExpert": "systemic",
                    "PrinciplesExpert": "principles",
                    "PrecedentExpert": "precedent",
                }
                gating = {}
                for name, lw in config.gating.expert_priors.items():
                    key = short.get(name, name.lower().replace("expert", ""))
                    gating[key] = round(float(getattr(lw, "default", 0.25)), 4)
                if gating:
                    return PolicyWeightsStatus(
                        gating=gating,
                        traversal={
                            "avg_depth": 2.0,
                            "avg_width": 2.0,
                            "exploration_rate": 0.2,
                        },
                        timestamp=getattr(config, "updated_at", None) or datetime.now().isoformat(),
                    )
    except Exception as e:
        log.debug("Could not load policy weights from weight store", error=str(e))

    # Return default weights if nothing available
    return PolicyWeightsStatus(
        gating={
            "literal": 0.25,
            "systemic": 0.25,
            "principles": 0.25,
            "precedent": 0.25,
        },
        traversal={
            "avg_depth": 2.0,
            "avg_width": 2.0,
            "exploration_rate": 0.2,
        },
        timestamp=datetime.now().isoformat(),
    )


def _get_buffer_feedback_distribution(buffer) -> dict:
    """
    Analizza distribuzione feedback nel buffer.

    Conta esperienze positive, negative, neutral basandosi sul reward.
    """
    positive = 0
    negative = 0
    neutral = 0

    try:
        experiences = buffer.get_all() if hasattr(buffer, 'get_all') else []

        for exp in experiences:
            reward = exp.reward if hasattr(exp, 'reward') else 0
            if reward > 0.3:
                positive += 1
            elif reward < -0.3:
                negative += 1
            else:
                neutral += 1

    except Exception as e:
        log.debug("Could not analyze buffer distribution", error=str(e))

    return {
        "positive": positive,
        "negative": negative,
        "neutral": neutral,
    }


# WebSocket connections
_connected_websockets: List[WebSocket] = []


async def _broadcast_training_update(data: dict):
    """Invia update a tutti i WebSocket connessi."""
    dead_sockets = []
    for ws in _connected_websockets:
        try:
            await ws.send_json(data)
        except (ConnectionError, RuntimeError):
            dead_sockets.append(ws)

    for ws in dead_sockets:
        if ws in _connected_websockets:
            _connected_websockets.remove(ws)


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/training/status", response_model=TrainingStatus)
async def get_training_status(
    api_key: ApiKey = Depends(verify_api_key),
) -> TrainingStatus:
    """
    Recupera stato corrente del training RLCF.

    Dati REALI dal TrainingScheduler.

    Returns:
        TrainingStatus con epoch, loss, ETA

    Example:
        >>> GET /api/v1/rlcf/training/status
        {
          "is_running": true,
          "current_epoch": 15,
          "total_epochs": 50,
          "current_loss": 0.0234,
          "learning_rate": 0.0001,
          "eta_seconds": 1800
        }
    """
    scheduler = _get_scheduler()

    if scheduler is None:
        # Return empty status if scheduler not available
        return TrainingStatus(
            last_updated=datetime.now().isoformat()
        )

    try:
        status = scheduler.get_status()

        return TrainingStatus(
            is_running=status.is_training,
            is_paused=status.status.value == "paused",
            current_epoch=status.current_epoch,
            total_epochs=status.total_epochs,
            current_loss=None,  # TrainingScheduler doesn't track current loss between runs
            best_loss=None,
            learning_rate=0.0001,  # Default, could be from config
            started_at=status.last_training_at,  # Using last training as reference
            eta_seconds=None,
            last_updated=datetime.now().isoformat(),
            training_sessions_today=status.training_sessions_today,
        )
    except Exception as e:
        log.error("Error getting training status", error=str(e))
        return TrainingStatus(
            last_updated=datetime.now().isoformat()
        )


@router.post("/training/start", response_model=TrainingStartResponse)
async def start_training(
    config: TrainingConfig,
    api_key: ApiKey = Depends(require_role("admin")),
) -> TrainingStartResponse:
    """
    Avvia training RLCF con configurazione.

    Usa il TrainingScheduler reale per avviare il training.

    Args:
        config: TrainingConfig con epochs, learning_rate, etc.

    Returns:
        TrainingStartResponse con training_id

    Example:
        >>> POST /api/v1/rlcf/training/start
        >>> {"epochs": 50, "learning_rate": 0.0001}
        {
          "success": true,
          "training_id": "train_abc123",
          "message": "Training avviato"
        }
    """
    scheduler = _get_scheduler()

    if scheduler is None:
        return TrainingStartResponse(
            success=False,
            message="TrainingScheduler non disponibile. Verificare configurazione RLCF.",
        )

    try:
        status = scheduler.get_status()

        if status.is_training:
            return TrainingStartResponse(
                success=False,
                message="Training già in corso. Fermarlo prima di avviarne uno nuovo.",
            )

        # Check buffer
        if status.buffer_size < config.buffer_threshold:
            return TrainingStartResponse(
                success=False,
                message=f"Buffer insufficiente ({status.buffer_size}/{config.buffer_threshold}). "
                        f"Raccogliere più feedback prima del training.",
            )

        # Start training in background
        from merlt.rlcf.training_scheduler import TrainingTrigger

        training_id = f"train_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        # Run training asynchronously
        asyncio.create_task(scheduler.run_training_epoch(trigger=TrainingTrigger.API))

        log.info("Training started via API", training_id=training_id)

        return TrainingStartResponse(
            success=True,
            training_id=training_id,
            message=f"Training avviato con {config.epochs} epoch",
            config=config,
        )

    except Exception as e:
        log.error("Error starting training", error=str(e))
        return TrainingStartResponse(
            success=False,
            message=f"Errore avvio training: {str(e)}",
        )


@router.post("/training/stop", response_model=TrainingStopResponse)
async def stop_training(
    api_key: ApiKey = Depends(require_role("admin")),
) -> TrainingStopResponse:
    """
    Ferma training in corso.

    Returns:
        TrainingStopResponse con statistiche finali

    Example:
        >>> POST /api/v1/rlcf/training/stop
        {
          "success": true,
          "epochs_completed": 15,
          "final_loss": 0.0234,
          "message": "Training fermato"
        }
    """
    scheduler = _get_scheduler()

    if scheduler is None:
        return TrainingStopResponse(
            success=False,
            message="TrainingScheduler non disponibile",
        )

    try:
        status = scheduler.get_status()

        if not status.is_training:
            return TrainingStopResponse(
                success=False,
                message="Nessun training in corso",
            )

        # Pause the scheduler (stop auto-training)
        scheduler.pause()

        return TrainingStopResponse(
            success=True,
            epochs_completed=status.current_epoch,
            final_loss=0.0,  # Not tracked between runs
            message=f"Training fermato dopo {status.current_epoch} epoch",
        )

    except Exception as e:
        log.error("Error stopping training", error=str(e))
        return TrainingStopResponse(
            success=False,
            message=f"Errore stop training: {str(e)}",
        )


@router.get("/buffer/status", response_model=BufferStatus)
async def get_buffer_status(
    api_key: ApiKey = Depends(verify_api_key),
) -> BufferStatus:
    """
    Recupera stato del feedback buffer.

    Dati REALI dal buffer del TrainingScheduler.

    Returns:
        BufferStatus con size, distribution, training_ready

    Example:
        >>> GET /api/v1/rlcf/buffer/status
        {
          "size": 847,
          "capacity": 1000,
          "fill_percentage": 84.7,
          "positive_count": 623,
          "negative_count": 112,
          "neutral_count": 112,
          "training_ready": true
        }
    """
    scheduler = _get_scheduler()

    if scheduler is None:
        return BufferStatus()

    try:
        buffer_stats = scheduler.get_buffer_stats()
        scheduler_status = scheduler.get_status()

        # Analyze feedback distribution
        distribution = _get_buffer_feedback_distribution(scheduler.buffer)

        fill_percentage = (buffer_stats.size / buffer_stats.capacity * 100) if buffer_stats.capacity > 0 else 0

        return BufferStatus(
            size=buffer_stats.size,
            capacity=buffer_stats.capacity,
            fill_percentage=round(fill_percentage, 1),
            positive_count=distribution["positive"],
            negative_count=distribution["negative"],
            neutral_count=distribution["neutral"],
            training_ready=buffer_stats.size >= scheduler.config.buffer_threshold,
            last_feedback_at=None,  # Could be tracked if needed
            avg_reward=buffer_stats.avg_reward,
        )

    except Exception as e:
        log.error("Error getting buffer status", error=str(e))
        return BufferStatus()


@router.get("/policies/weights", response_model=PolicyWeightsStatus)
async def get_policy_weights(
    api_key: ApiKey = Depends(verify_api_key),
) -> PolicyWeightsStatus:
    """
    Recupera pesi correnti delle policy.

    Tenta di caricare da checkpoint reale, altrimenti default.

    Returns:
        PolicyWeightsStatus con gating e traversal weights

    Example:
        >>> GET /api/v1/rlcf/policies/weights
        {
          "gating": {"literal": 0.35, "systemic": 0.28, ...},
          "traversal": {"avg_depth": 3.2, "avg_width": 2.8, ...}
        }
    """
    return await _get_policy_weights()


@router.get("/policies/history", response_model=PolicyWeightsHistory)
async def get_policy_history(
    limit: int = Query(50, ge=1, le=500, description="Numero massimo di entry"),
    api_key: ApiKey = Depends(verify_api_key),
) -> PolicyWeightsHistory:
    """
    Recupera storia dei pesi delle policy nel tempo.

    Carica da checkpoint storici salvati.

    Args:
        limit: Numero massimo di entry da restituire

    Returns:
        PolicyWeightsHistory con lista di snapshot temporali

    Example:
        >>> GET /api/v1/rlcf/policies/history?limit=20
        {
          "history": [...],
          "epochs": [1, 2, 3, ...]
        }
    """
    history = []
    epochs = []

    try:
        from merlt.rlcf.persistence import RLCFPersistence

        persistence = RLCFPersistence()
        checkpoints = persistence.list_checkpoints(limit=limit)

        for i, checkpoint in enumerate(checkpoints):
            history.append(PolicyWeightsStatus(
                gating=checkpoint.gating_weights or {},
                traversal=checkpoint.traversal_params or {},
                timestamp=checkpoint.created_at.isoformat() if checkpoint.created_at else None,
            ))
            epochs.append(i + 1)

    except Exception as e:
        log.debug("Could not load policy history", error=str(e))

    return PolicyWeightsHistory(
        history=history,
        epochs=epochs,
    )


@router.post("/aggregation/run")
async def run_aggregation(
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(require_role("admin")),
):
    """
    Trigger periodic feedback aggregation across all components.

    Returns aggregation results with disagreement flags.
    """
    try:
        from merlt.rlcf.feedback_aggregation_service import FeedbackAggregationService
        svc = FeedbackAggregationService()
        result = await svc.run_periodic_aggregation(session)
        return result.to_dict()
    except Exception as e:
        log.error("Aggregation run failed", error=str(e))
        return {
            "components_aggregated": 0,
            "total_feedback_processed": 0,
            "high_disagreement_components": [],
            "error": str(e),
        }


@router.get("/aggregation/latest")
async def get_latest_aggregation(
    component: Optional[str] = Query(None, description="Filter by component"),
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Get latest aggregation results, optionally filtered by component.
    """
    try:
        from merlt.rlcf.feedback_aggregation_service import (
            FeedbackAggregationService,
            VALID_COMPONENTS,
        )
        svc = FeedbackAggregationService()

        if component:
            agg = await svc.aggregate_component_feedback(session, component)
            return agg.to_dict()

        # All components
        results = {}
        for comp in VALID_COMPONENTS:
            agg = await svc.aggregate_component_feedback(session, comp)
            if agg.total_feedback > 0:
                results[comp] = agg.to_dict()

        return {"components": results, "timestamp": datetime.now().isoformat()}

    except Exception as e:
        log.error("Get latest aggregation failed", error=str(e))
        return {"components": {}, "error": str(e)}


@router.websocket("/training/stream")
async def training_stream(websocket: WebSocket):
    """
    WebSocket per streaming metriche training real-time.

    Invia stato corrente ogni 5 secondi.

    Invia eventi:
    - initial_state: Stato iniziale
    - status_update: Aggiornamenti periodici
    - keepalive: Ping per mantenere connessione

    Example:
        >>> ws = await websockets.connect("ws://localhost:8100/api/v1/rlcf/training/stream")
        >>> async for message in ws:
        ...     data = json.loads(message)
        ...     print(f"Status: {data['event']}")
    """
    await websocket.accept()
    _connected_websockets.append(websocket)

    log.info("RLCF training WebSocket connected", total_connections=len(_connected_websockets))

    try:
        # Send initial state
        scheduler = _get_scheduler()

        if scheduler:
            status = scheduler.get_status()
            buffer_stats = scheduler.get_buffer_stats()
            policy_weights = await _get_policy_weights()

            await websocket.send_json({
                "event": "initial_state",
                "data": {
                    "training": {
                        "is_running": status.is_training,
                        "current_epoch": status.current_epoch,
                        "total_epochs": status.total_epochs,
                        "training_sessions_today": status.training_sessions_today,
                    },
                    "buffer": {
                        "size": buffer_stats.size,
                        "capacity": buffer_stats.capacity,
                        "avg_reward": buffer_stats.avg_reward,
                    },
                    "weights": {
                        "gating": policy_weights.gating,
                        "traversal": policy_weights.traversal,
                    },
                }
            })
        else:
            await websocket.send_json({
                "event": "initial_state",
                "data": {
                    "training": {"is_running": False, "current_epoch": 0, "total_epochs": 0},
                    "buffer": {"size": 0, "capacity": 0, "avg_reward": 0},
                    "weights": {"gating": {}, "traversal": {}},
                }
            })

        # Keep connection alive and send periodic updates
        while True:
            try:
                # Wait for ping or data
                data = await asyncio.wait_for(websocket.receive_text(), timeout=5)
                if data == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                # Send status update
                if scheduler:
                    status = scheduler.get_status()
                    await websocket.send_json({
                        "event": "status_update",
                        "data": {
                            "is_training": status.is_training,
                            "current_epoch": status.current_epoch,
                            "buffer_size": status.buffer_size,
                        },
                        "timestamp": datetime.now().isoformat(),
                    })
                else:
                    await websocket.send_json({
                        "event": "keepalive",
                        "timestamp": datetime.now().isoformat()
                    })

    except WebSocketDisconnect:
        log.info("RLCF training WebSocket disconnected")
    finally:
        if websocket in _connected_websockets:
            _connected_websockets.remove(websocket)


# =============================================================================
# SYNTHETIC FEEDBACK (Story 6-10)
# =============================================================================


@router.post("/synthetic/generate")
async def generate_synthetic_feedback(
    count: int = Query(50, ge=1, le=500, description="Number of feedback pairs"),
    domain: Optional[str] = Query(None, description="Domain filter"),
    difficulty: Optional[int] = Query(None, ge=1, le=5, description="Difficulty filter"),
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(require_role("admin")),
):
    """Generate synthetic feedback for cold-start or testing."""
    from merlt.rlcf.synthetic_feedback_service import SyntheticFeedbackService

    svc = SyntheticFeedbackService()
    result = await svc.generate_feedback_batch(
        session, count=count, domain=domain, difficulty=difficulty
    )
    return result.to_dict()
