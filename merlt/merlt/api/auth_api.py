"""
Auth API
========

FastAPI router per sincronizzazione authority utente tra VisuaLex e MERL-T.

Endpoint:
- POST /auth/sync - Sincronizza credenziali e calcola authority
- GET /auth/authority/{user_id} - Recupera authority utente
- POST /auth/delta - Applica delta authority per singola azione
- POST /auth/estimate - Stima authority per nuovo utente

Esempio:
    >>> from fastapi import FastAPI
    >>> from merlt.api.auth_api import router
    >>>
    >>> app = FastAPI()
    >>> app.include_router(router, prefix="/api/v1")
"""

import structlog
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, ConfigDict

from merlt.rlcf.authority_sync import (
    AuthoritySyncService,
    VisualexUserSync,
    AuthorityBreakdown,
)

log = structlog.get_logger()

router = APIRouter(prefix="/auth", tags=["auth"])


# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class UserSyncModel(BaseModel):
    """Request per sincronizzazione utente da VisuaLex."""
    visualex_user_id: str = Field(..., description="ID utente in VisuaLex")
    merlt_user_id: str = Field(..., description="UUID condiviso MERL-T")

    # Credenziali
    qualification: str = Field(
        ...,
        description="Qualifica professionale",
        examples=["studente", "avvocato", "magistrato", "docente"],
    )
    specializations: List[str] = Field(
        default_factory=list,
        description="Lista specializzazioni",
    )
    years_experience: int = Field(
        default=0,
        ge=0,
        description="Anni di esperienza",
    )
    institution: Optional[str] = Field(
        None,
        description="Istituzione di appartenenza",
    )

    # Attività aggregata
    total_feedback: int = Field(
        default=0,
        ge=0,
        description="Totale feedback inviati",
    )
    validated_feedback: int = Field(
        default=0,
        ge=0,
        description="Feedback peer-validated",
    )
    ingestions: int = Field(
        default=0,
        ge=0,
        description="Numero ingestion effettuate",
    )
    validations: int = Field(
        default=0,
        ge=0,
        description="Numero validazioni effettuate",
    )

    # Domain activity
    domain_activity: Dict[str, int] = Field(
        default_factory=dict,
        description="Attività per dominio giuridico (es. {'civile': 50})",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "visualex_user_id": "visualex-123",
                "merlt_user_id": "550e8400-e29b-41d4-a716-446655440000",
                "qualification": "avvocato",
                "specializations": ["civile", "commerciale"],
                "years_experience": 8,
                "institution": "Studio Legale Rossi",
                "total_feedback": 25,
                "validated_feedback": 15,
                "ingestions": 3,
                "validations": 40,
                "domain_activity": {"civile": 60, "commerciale": 30},
            }
        }
    )


class AuthorityBreakdownModel(BaseModel):
    """Breakdown del calcolo authority."""
    baseline: float = Field(..., description="Baseline credentials (B_u)")
    track_record: float = Field(..., description="Track record score (T_u)")
    level_authority: float = Field(..., description="Domain authority media (P_u)")
    domain_scores: Dict[str, float] = Field(
        ...,
        description="Scores per singolo dominio",
    )
    final_authority: float = Field(..., description="Authority finale calcolata")


class SyncResponseModel(BaseModel):
    """Response per sincronizzazione."""
    success: bool
    user_id: str
    authority: float = Field(..., description="Authority score finale (0-1)")
    breakdown: AuthorityBreakdownModel
    synced_at: str


class DeltaRequestModel(BaseModel):
    """Request per applicare delta authority."""
    user_id: str = Field(..., description="UUID utente MERL-T")
    action: str = Field(
        ...,
        description="Tipo di azione",
        examples=[
            "feedback_simple",
            "feedback_detailed",
            "validation_correct",
            "validation_incorrect",
            "ingestion_approved",
            "disagreement_annotation",
            "peer_validation",
        ],
    )
    current_authority: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Authority corrente dell'utente",
    )


class DeltaResponseModel(BaseModel):
    """Response per delta authority."""
    success: bool
    user_id: str
    delta: float = Field(..., description="Delta calcolato")
    new_authority: float = Field(..., description="Nuova authority dopo delta")
    action: str


class EstimateRequestModel(BaseModel):
    """Request per stima authority."""
    qualification: str = Field(
        ...,
        description="Qualifica professionale",
    )
    years_experience: int = Field(
        default=0,
        ge=0,
        description="Anni di esperienza",
    )
    specializations: List[str] = Field(
        default_factory=list,
        description="Lista specializzazioni",
    )


class EstimateResponseModel(BaseModel):
    """Response per stima authority."""
    estimated_authority: float = Field(
        ...,
        description="Authority stimata (senza track record e domain)",
    )
    qualification: str
    note: str = Field(
        default="Stima basata solo su credenziali, senza track record e domain activity",
    )


class AuthorityResponseModel(BaseModel):
    """Response per get authority."""
    success: bool
    user_id: str
    authority: Optional[float] = Field(
        None,
        description="Authority score (None se utente non trovato)",
    )
    found: bool


# =============================================================================
# GLOBAL STATE
# =============================================================================

# Service singleton
_service: Optional[AuthoritySyncService] = None

# Cache authority in-memory (in produzione: Redis)
_authority_cache: Dict[str, Dict[str, Any]] = {}


def get_service() -> AuthoritySyncService:
    """Dependency injection per service."""
    global _service
    if _service is None:
        _service = AuthoritySyncService()
    return _service


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post(
    "/sync",
    response_model=SyncResponseModel,
    summary="Sincronizza credenziali utente",
    description="""
    Sincronizza credenziali utente da VisuaLex e calcola authority.

    Formula: A_u(t) = 0.4*B_u + 0.4*T_u + 0.2*P_u

    Dove:
    - **B_u**: Baseline credentials (qualifica, esperienza, specializzazioni)
    - **T_u**: Track record (feedback, ingestion, validazioni)
    - **P_u**: Domain authority (attività per ambito giuridico)
    """,
)
async def sync_user(
    request: UserSyncModel,
    service: AuthoritySyncService = Depends(get_service),
) -> SyncResponseModel:
    """Sincronizza credenziali e calcola authority."""
    log.info(
        "API: sync_user",
        visualex_id=request.visualex_user_id,
        merlt_id=request.merlt_user_id,
        qualification=request.qualification,
    )

    try:
        # Converti in dataclass
        user_data = VisualexUserSync(
            visualex_user_id=request.visualex_user_id,
            merlt_user_id=request.merlt_user_id,
            qualification=request.qualification,
            specializations=request.specializations,
            years_experience=request.years_experience,
            institution=request.institution,
            total_feedback=request.total_feedback,
            validated_feedback=request.validated_feedback,
            ingestions=request.ingestions,
            validations=request.validations,
            domain_activity=request.domain_activity,
        )

        # Sync
        authority, breakdown = await service.sync_user(user_data)

        # Cache
        _authority_cache[request.merlt_user_id] = {
            "authority": authority,
            "breakdown": breakdown.to_dict(),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }

        return SyncResponseModel(
            success=True,
            user_id=request.merlt_user_id,
            authority=authority,
            breakdown=AuthorityBreakdownModel(
                baseline=breakdown.baseline,
                track_record=breakdown.track_record,
                level_authority=breakdown.level_authority,
                domain_scores=breakdown.domain_scores,
                final_authority=breakdown.final_authority,
            ),
            synced_at=datetime.now(timezone.utc).isoformat(),
        )

    except Exception as e:
        log.error(f"Failed to sync user: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/authority/{user_id}",
    response_model=AuthorityResponseModel,
    summary="Recupera authority utente",
    description="Recupera authority score per un utente dal cache.",
)
async def get_authority(user_id: str) -> AuthorityResponseModel:
    """Recupera authority utente dal cache."""
    log.info("API: get_authority", user_id=user_id)

    cached = _authority_cache.get(user_id)

    if cached:
        return AuthorityResponseModel(
            success=True,
            user_id=user_id,
            authority=cached["authority"],
            found=True,
        )
    else:
        return AuthorityResponseModel(
            success=True,
            user_id=user_id,
            authority=None,
            found=False,
        )


@router.post(
    "/delta",
    response_model=DeltaResponseModel,
    summary="Applica delta authority",
    description="""
    Calcola e applica delta authority per una singola azione.

    Utile per aggiornamenti incrementali senza ricalcolo completo.

    **Azioni supportate:**
    - feedback_simple: +0.001
    - feedback_detailed: +0.005
    - validation_correct: +0.003
    - validation_incorrect: -0.002
    - ingestion_approved: +0.01
    - disagreement_annotation: +0.008
    - peer_validation: +0.002

    **Diminishing returns:**
    - Authority > 0.8: delta * 0.5
    - Authority > 0.9: delta * 0.25
    """,
)
async def apply_delta(
    request: DeltaRequestModel,
    service: AuthoritySyncService = Depends(get_service),
) -> DeltaResponseModel:
    """Applica delta authority per singola azione."""
    log.info(
        "API: apply_delta",
        user_id=request.user_id,
        action=request.action,
        current=request.current_authority,
    )

    try:
        delta = service.calculate_authority_delta(
            action=request.action,
            current_authority=request.current_authority,
        )

        new_authority = max(0.0, min(1.0, request.current_authority + delta))

        # Aggiorna cache se presente
        if request.user_id in _authority_cache:
            _authority_cache[request.user_id]["authority"] = new_authority

        return DeltaResponseModel(
            success=True,
            user_id=request.user_id,
            delta=delta,
            new_authority=new_authority,
            action=request.action,
        )

    except Exception as e:
        log.error(f"Failed to apply delta: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/estimate",
    response_model=EstimateResponseModel,
    summary="Stima authority per nuovo utente",
    description="""
    Stima rapida authority senza dati completi.

    Utile per nuovi utenti o preview.

    Calcola solo componente baseline (B_u * 0.4), senza track record e domain.
    """,
)
async def estimate_authority(
    request: EstimateRequestModel,
    service: AuthoritySyncService = Depends(get_service),
) -> EstimateResponseModel:
    """Stima authority per nuovo utente."""
    log.info(
        "API: estimate_authority",
        qualification=request.qualification,
    )

    try:
        estimated = service.estimate_authority(
            qualification=request.qualification,
            years_experience=request.years_experience,
            specializations=request.specializations,
        )

        return EstimateResponseModel(
            estimated_authority=estimated,
            qualification=request.qualification,
        )

    except Exception as e:
        log.error(f"Failed to estimate authority: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/qualifications",
    summary="Lista qualifiche supportate",
    description="Restituisce lista qualifiche e relativi baseline scores.",
)
async def list_qualifications(
    service: AuthoritySyncService = Depends(get_service),
) -> Dict[str, Any]:
    """Lista qualifiche supportate."""
    return {
        "qualifications": service.QUALIFICATION_SCORES,
        "weights": {
            "baseline": service.WEIGHT_BASELINE,
            "track_record": service.WEIGHT_TRACK_RECORD,
            "level_authority": service.WEIGHT_LEVEL_AUTHORITY,
        },
        "formula": "A_u(t) = 0.4*B_u + 0.4*T_u + 0.2*P_u",
    }


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "router",
    "UserSyncModel",
    "SyncResponseModel",
    "DeltaRequestModel",
    "DeltaResponseModel",
    "EstimateRequestModel",
    "EstimateResponseModel",
    "AuthorityResponseModel",
    "AuthorityBreakdownModel",
]
