"""
Feedback API
============

FastAPI router per ricezione feedback da fonti esterne.

Endpoint:
- POST /feedback/interaction - Registra singola interazione
- POST /feedback/batch - Registra batch di interazioni
- POST /feedback/explicit - Registra feedback esplicito
- POST /feedback/session - Finalizza sessione e genera MultilevelFeedback

Esempio:
    >>> from fastapi import FastAPI
    >>> from merlt.api.feedback_api import router
    >>>
    >>> app = FastAPI()
    >>> app.include_router(router, prefix="/api/v1")
"""

import structlog
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, ConfigDict

from merlt.rlcf.external_feedback import (
    ExternalFeedbackAdapter,
    FeedbackAccumulator,
    VisualexInteraction,
    MultilevelFeedback,
    FeedbackLevel,
)

log = structlog.get_logger()

router = APIRouter(prefix="/feedback", tags=["feedback"])


# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class InteractionModel(BaseModel):
    """Singola interazione da VisuaLex."""
    user_id: str = Field(..., description="UUID dell'utente")
    interaction_type: str = Field(
        ...,
        description="Tipo di interazione",
        examples=[
            "bookmark_add", "highlight_create", "first_result_click",
            "skip_results", "cross_ref_found", "doctrine_read",
            "quicknorm_save", "dossier_add", "long_read", "quick_close"
        ]
    )
    timestamp: Optional[str] = Field(None, description="Timestamp ISO (default: now)")

    article_urn: Optional[str] = Field(None, description="URN articolo")
    query_text: Optional[str] = Field(None, description="Testo query")
    trace_id: Optional[str] = Field(None, description="ID trace MERL-T")

    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Metadati aggiuntivi"
    )


class BatchInteractionsModel(BaseModel):
    """Batch di interazioni."""
    user_id: str = Field(..., description="UUID dell'utente")
    user_authority: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Authority dell'utente"
    )
    trace_id: Optional[str] = Field(None, description="ID trace MERL-T")
    interactions: List[InteractionModel] = Field(
        ...,
        description="Lista di interazioni"
    )


class ExplicitFeedbackModel(BaseModel):
    """Feedback esplicito da popup."""
    user_id: str = Field(..., description="UUID dell'utente")
    user_authority: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Authority dell'utente"
    )
    trace_id: Optional[str] = Field(None, description="ID trace MERL-T")

    # Retrieval feedback
    precision: Optional[float] = Field(None, ge=0.0, le=1.0)
    recall: Optional[float] = Field(None, ge=0.0, le=1.0)
    missing_sources: List[str] = Field(default_factory=list)
    ranking_quality: Optional[float] = Field(None, ge=0.0, le=1.0)

    # Reasoning feedback
    legal_soundness: Optional[float] = Field(None, ge=0.0, le=1.0)
    logical_coherence: Optional[float] = Field(None, ge=0.0, le=1.0)
    citation_quality: Optional[float] = Field(None, ge=0.0, le=1.0)

    # Synthesis feedback
    clarity: Optional[float] = Field(None, ge=0.0, le=1.0)
    completeness: Optional[float] = Field(None, ge=0.0, le=1.0)
    usefulness: Optional[float] = Field(None, ge=0.0, le=1.0)
    user_satisfaction: Optional[float] = Field(None, ge=0.0, le=1.0)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "user_id": "550e8400-e29b-41d4-a716-446655440000",
                "user_authority": 0.7,
                "trace_id": "trace-123",
                "precision": 0.8,
                "clarity": 0.9,
                "usefulness": 0.85,
            }
        }
    )


class SessionFinalizeModel(BaseModel):
    """Richiesta finalizzazione sessione."""
    session_id: str = Field(..., description="ID sessione")
    user_id: str = Field(..., description="UUID dell'utente")
    user_authority: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Authority dell'utente"
    )
    trace_id: Optional[str] = Field(None, description="ID trace MERL-T")

    interactions: List[InteractionModel] = Field(
        default_factory=list,
        description="Interazioni della sessione"
    )
    explicit_feedback: Optional[Dict[str, Any]] = Field(
        None,
        description="Feedback esplicito da popup"
    )


class MultilevelFeedbackResponse(BaseModel):
    """Risposta con MultilevelFeedback."""
    success: bool
    feedback: Dict[str, Any]
    interaction_count: int
    has_retrieval: bool
    has_reasoning: bool
    has_synthesis: bool


class InteractionResponse(BaseModel):
    """Risposta registrazione interazione."""
    success: bool
    message: str
    partial_feedback: Optional[Dict[str, Any]] = None


# =============================================================================
# GLOBAL STATE (in produzione: Redis/database)
# =============================================================================

# Accumulatori per sessione (in memoria per demo)
_accumulators: Dict[str, FeedbackAccumulator] = {}

# Adapter singleton
_adapter: Optional[ExternalFeedbackAdapter] = None


def get_adapter() -> ExternalFeedbackAdapter:
    """Dependency injection per adapter."""
    global _adapter
    if _adapter is None:
        _adapter = ExternalFeedbackAdapter()
    return _adapter


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post(
    "/interaction",
    response_model=InteractionResponse,
    summary="Registra singola interazione",
    description="""
    Registra una singola interazione utente e restituisce il partial feedback.

    Tipi di interazione supportati:
    - **Retrieval**: bookmark_add, highlight_create, first_result_click, skip_results, cross_ref_found
    - **Reasoning**: doctrine_read, annotation_create, annotation_question
    - **Synthesis**: quicknorm_save, dossier_add, long_read, quick_close, search_after_ai
    """,
)
async def register_interaction(
    interaction: InteractionModel,
    adapter: ExternalFeedbackAdapter = Depends(get_adapter),
) -> InteractionResponse:
    """Registra singola interazione."""
    log.info(
        "API: register_interaction",
        user_id=interaction.user_id,
        type=interaction.interaction_type,
    )

    try:
        # Converti in VisualexInteraction
        timestamp = datetime.now(timezone.utc)
        if interaction.timestamp:
            try:
                timestamp = datetime.fromisoformat(interaction.timestamp)
            except ValueError:
                pass

        visualex_interaction = VisualexInteraction(
            user_id=interaction.user_id,
            interaction_type=interaction.interaction_type,
            timestamp=timestamp,
            article_urn=interaction.article_urn,
            query_text=interaction.query_text,
            trace_id=interaction.trace_id,
            metadata=interaction.metadata,
        )

        # Converti in partial feedback
        partial = adapter.convert_interaction(visualex_interaction)

        if partial:
            return InteractionResponse(
                success=True,
                message="Interaction registered",
                partial_feedback={
                    "level": partial.level.value,
                    "field": partial.field,
                    "delta": partial.delta,
                }
            )
        else:
            return InteractionResponse(
                success=True,
                message="Interaction registered (no feedback mapping)",
                partial_feedback=None,
            )

    except Exception as e:
        log.error(f"Failed to register interaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/batch",
    response_model=MultilevelFeedbackResponse,
    summary="Registra batch di interazioni",
    description="Registra un batch di interazioni e genera MultilevelFeedback aggregato.",
)
async def register_batch(
    batch: BatchInteractionsModel,
    adapter: ExternalFeedbackAdapter = Depends(get_adapter),
) -> MultilevelFeedbackResponse:
    """Registra batch di interazioni."""
    log.info(
        "API: register_batch",
        user_id=batch.user_id,
        count=len(batch.interactions),
    )

    try:
        # Converti interazioni
        interactions = []
        for i in batch.interactions:
            timestamp = datetime.now(timezone.utc)
            if i.timestamp:
                try:
                    timestamp = datetime.fromisoformat(i.timestamp)
                except ValueError:
                    pass

            interactions.append(VisualexInteraction(
                user_id=i.user_id,
                interaction_type=i.interaction_type,
                timestamp=timestamp,
                article_urn=i.article_urn,
                query_text=i.query_text,
                trace_id=i.trace_id,
                metadata=i.metadata,
            ))

        # Aggrega
        feedback = adapter.aggregate_session(
            interactions=interactions,
            user_id=batch.user_id,
            user_authority=batch.user_authority,
            trace_id=batch.trace_id,
        )

        return MultilevelFeedbackResponse(
            success=True,
            feedback=feedback.to_dict(),
            interaction_count=len(interactions),
            has_retrieval=feedback.has_retrieval_feedback,
            has_reasoning=feedback.has_reasoning_feedback,
            has_synthesis=feedback.has_synthesis_feedback,
        )

    except Exception as e:
        log.error(f"Failed to register batch: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/explicit",
    response_model=MultilevelFeedbackResponse,
    summary="Registra feedback esplicito",
    description="""
    Registra feedback esplicito da popup/form.

    Il feedback esplicito ha priorità su quello implicito.
    """,
)
async def register_explicit(
    explicit: ExplicitFeedbackModel,
    adapter: ExternalFeedbackAdapter = Depends(get_adapter),
) -> MultilevelFeedbackResponse:
    """Registra feedback esplicito."""
    log.info(
        "API: register_explicit",
        user_id=explicit.user_id,
        trace_id=explicit.trace_id,
    )

    try:
        # Costruisci dict per merge
        explicit_dict = {}
        for field_name in [
            "precision", "recall", "missing_sources", "ranking_quality",
            "legal_soundness", "logical_coherence", "citation_quality",
            "clarity", "completeness", "usefulness", "user_satisfaction",
        ]:
            value = getattr(explicit, field_name, None)
            if value is not None:
                explicit_dict[field_name] = value

        # Crea feedback con solo explicit
        feedback = adapter.aggregate_session(
            interactions=[],
            explicit_feedback=explicit_dict,
            user_id=explicit.user_id,
            user_authority=explicit.user_authority,
            trace_id=explicit.trace_id,
        )

        return MultilevelFeedbackResponse(
            success=True,
            feedback=feedback.to_dict(),
            interaction_count=0,
            has_retrieval=feedback.has_retrieval_feedback,
            has_reasoning=feedback.has_reasoning_feedback,
            has_synthesis=feedback.has_synthesis_feedback,
        )

    except Exception as e:
        log.error(f"Failed to register explicit feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session",
    response_model=MultilevelFeedbackResponse,
    summary="Finalizza sessione",
    description="""
    Finalizza una sessione combinando interazioni implicite e feedback esplicito.

    Questo endpoint dovrebbe essere chiamato alla fine di una sessione utente
    per generare il MultilevelFeedback completo.
    """,
)
async def finalize_session(
    session: SessionFinalizeModel,
    adapter: ExternalFeedbackAdapter = Depends(get_adapter),
) -> MultilevelFeedbackResponse:
    """Finalizza sessione e genera feedback completo."""
    log.info(
        "API: finalize_session",
        session_id=session.session_id,
        user_id=session.user_id,
        interaction_count=len(session.interactions),
    )

    try:
        # Converti interazioni
        interactions = []
        for i in session.interactions:
            timestamp = datetime.now(timezone.utc)
            if i.timestamp:
                try:
                    timestamp = datetime.fromisoformat(i.timestamp)
                except ValueError:
                    pass

            interactions.append(VisualexInteraction(
                user_id=i.user_id,
                interaction_type=i.interaction_type,
                timestamp=timestamp,
                article_urn=i.article_urn,
                query_text=i.query_text,
                trace_id=i.trace_id,
                metadata=i.metadata,
            ))

        # Aggrega con explicit
        feedback = adapter.aggregate_session(
            interactions=interactions,
            explicit_feedback=session.explicit_feedback,
            user_id=session.user_id,
            user_authority=session.user_authority,
            trace_id=session.trace_id,
        )

        return MultilevelFeedbackResponse(
            success=True,
            feedback=feedback.to_dict(),
            interaction_count=len(interactions),
            has_retrieval=feedback.has_retrieval_feedback,
            has_reasoning=feedback.has_reasoning_feedback,
            has_synthesis=feedback.has_synthesis_feedback,
        )

    except Exception as e:
        log.error(f"Failed to finalize session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/mappings",
    summary="Lista mapping interazioni → feedback",
    description="Restituisce la lista dei mapping tra tipi di interazione e campi feedback.",
)
async def get_mappings(
    adapter: ExternalFeedbackAdapter = Depends(get_adapter),
) -> Dict[str, Any]:
    """Restituisce mapping interazioni → feedback."""
    mappings = {}
    for interaction_type, (level, field_name, delta) in adapter.IMPLICIT_MAPPINGS.items():
        mappings[interaction_type] = {
            "level": level.value,
            "field": field_name,
            "delta": delta,
        }

    return {
        "mappings": mappings,
        "levels": [level.value for level in FeedbackLevel],
        "total_mappings": len(mappings),
    }


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "router",
    "InteractionModel",
    "BatchInteractionsModel",
    "ExplicitFeedbackModel",
    "SessionFinalizeModel",
    "MultilevelFeedbackResponse",
    "InteractionResponse",
]
