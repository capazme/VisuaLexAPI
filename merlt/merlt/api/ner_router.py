"""
NER Feedback Router (Loop β #2 — learned legal-reference NER via RLCF)
=====================================================================

Receives NER correction/confirmation signals from the VisuaLex BFF and stores
them in the authority-weighted `ner_feedback` table — the labeled training set
for the learned spaCy NER (Phase 4).

Endpoints:
    POST /api/v1/ner/feedback       - Store one NER correction/confirmation
    GET  /api/v1/ner/feedback/stats - Counts by feedback_type / source_surface

The BFF is the only caller; auth + consent are enforced BFF-side. This endpoint
trusts the `user_id` (varchar, never an FK) and computes the authority weight
server-side from UserDomainAuthority. Privacy: for the Q&A surface the BFF sends
only a ±500-char context window, never the raw query.
"""

import hashlib
import structlog
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, func as safunc

from merlt.api.auth import verify_api_key
from merlt.experts.models import ApiKey
from merlt.storage.enrichment.database import get_db_session
from merlt.storage.enrichment.models import NERFeedback, UserDomainAuthority

log = structlog.get_logger()

router = APIRouter(prefix="/ner", tags=["ner"])

VALID_SURFACES = {"article_xref", "qa_chip", "implicit", "search_mining"}
VALID_TYPES = {"confirmation", "correction", "false_positive", "missed"}


def compute_sample_weight(authority: float) -> float:
    """Map a [0,1] authority score to a [0.5, 2.0] training sample weight.

    Default/new user authority 0.5 → weight 1.0; top authority 1.0 → 2.0;
    low authority 0.1 → 0.5 (floored). Keeps every correction usable while
    letting trusted users pull harder on the model.
    """
    return max(0.5, min(2.0, authority * 2.0))


class NERFeedbackRequest(BaseModel):
    user_id: str = Field(..., max_length=100)
    source_surface: str
    feedback_type: str
    article_urn: Optional[str] = Field(None, max_length=300)
    selected_text: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    context_window: Optional[str] = None
    original_parsed: Optional[Dict[str, Any]] = None
    correct_reference: Optional[Dict[str, Any]] = None
    confidence_before: Optional[float] = None


class NERFeedbackResponse(BaseModel):
    received: bool
    feedback_id: str
    sample_weight: float


async def _resolve_authority(session, user_id: str) -> float:
    """Best authority across the user's domains; 0.5 default for unknown users."""
    result = await session.execute(
        select(safunc.max(UserDomainAuthority.domain_authority)).where(
            UserDomainAuthority.user_id == user_id
        )
    )
    value = result.scalar()
    return float(value) if value is not None else 0.5


def _make_feedback_id(req: "NERFeedbackRequest") -> str:
    raw = "|".join(str(x) for x in (
        req.user_id, req.source_surface, req.article_urn,
        req.selected_text, req.start_offset, req.feedback_type,
        datetime.utcnow().isoformat(),
    ))
    return "ner-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


@router.post("/feedback", response_model=NERFeedbackResponse)
async def submit_ner_feedback(
    req: NERFeedbackRequest,
    api_key: ApiKey = Depends(verify_api_key),
) -> NERFeedbackResponse:
    """Store one NER correction/confirmation with an authority-weighted sample weight."""
    if req.source_surface not in VALID_SURFACES:
        raise HTTPException(status_code=422, detail=f"invalid source_surface: {req.source_surface}")
    if req.feedback_type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"invalid feedback_type: {req.feedback_type}")

    feedback_id = _make_feedback_id(req)
    async with get_db_session() as session:
        authority = await _resolve_authority(session, req.user_id)
        weight = compute_sample_weight(authority)
        session.add(NERFeedback(
            feedback_id=feedback_id,
            source_surface=req.source_surface,
            user_id=req.user_id,
            article_urn=req.article_urn,
            selected_text=req.selected_text,
            start_offset=req.start_offset,
            end_offset=req.end_offset,
            context_window=req.context_window,
            feedback_type=req.feedback_type,
            original_parsed=req.original_parsed,
            correct_reference=req.correct_reference,
            confidence_before=req.confidence_before,
            user_authority=authority,
            sample_weight=weight,
            created_at=datetime.utcnow(),
        ))

    log.info("NER feedback stored", feedback_id=feedback_id,
             surface=req.source_surface, type=req.feedback_type, weight=round(weight, 2))
    return NERFeedbackResponse(received=True, feedback_id=feedback_id, sample_weight=weight)


@router.get("/feedback/stats")
async def ner_feedback_stats(api_key: ApiKey = Depends(verify_api_key)):
    """Counts by feedback_type and source_surface (admin dashboard, Phase 4)."""
    async with get_db_session() as session:
        total = (await session.execute(select(safunc.count(NERFeedback.id)))).scalar() or 0
        untrained = (await session.execute(
            select(safunc.count(NERFeedback.id)).where(NERFeedback.used_in_training.is_(False))
        )).scalar() or 0
        by_type = (await session.execute(
            select(NERFeedback.feedback_type, safunc.count(NERFeedback.id))
            .group_by(NERFeedback.feedback_type)
        )).all()
        by_surface = (await session.execute(
            select(NERFeedback.source_surface, safunc.count(NERFeedback.id))
            .group_by(NERFeedback.source_surface)
        )).all()
    return {
        "total": total,
        "untrained": untrained,
        "by_type": {k: v for k, v in by_type},
        "by_surface": {k: v for k, v in by_surface},
    }


__all__ = ["router", "compute_sample_weight"]
