"""
Devil's Advocate Router
========================

API wrapper for DevilsAdvocateAssigner.
Triggered on high-consensus queries (disagreement < 0.1).

Persistence: Uses DevilsAdvocateLog DB model for durable storage.

Endpoints:
- POST /devils-advocate/check: Check if DA should trigger for a trace
- POST /devils-advocate/feedback: Submit DA feedback
- GET /devils-advocate/effectiveness: Aggregate effectiveness metrics
"""

import structlog
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from merlt.api.auth import verify_api_key
from merlt.experts.models import ApiKey as ApiKeyModel
from merlt.rlcf.devils_advocate import (
    DevilsAdvocateAssigner,
    TaskType,
)
from merlt.experts.models import DevilsAdvocateLog
from merlt.rlcf.database import get_async_session_dep

log = structlog.get_logger()

router = APIRouter(prefix="/devils-advocate", tags=["devils-advocate"])

# Singleton assigner
_assigner = DevilsAdvocateAssigner()

# Threshold: only trigger DA when disagreement is very low (high consensus)
TRIGGER_THRESHOLD = 0.1


# =============================================================================
# MODELS
# =============================================================================


class DACheckResponse(BaseModel):
    triggered: bool
    critical_prompt: Optional[str] = None
    message: str


class DAFeedbackRequest(BaseModel):
    trace_id: str
    feedback_text: str = Field(..., min_length=5, description="Devil's advocate response text")
    assessment: str = Field(
        "interesting",
        description="Assessment: valid, weak, interesting",
    )


class DAFeedbackResponse(BaseModel):
    received: bool
    engagement_score: float
    critical_keywords_found: int


class DAEffectivenessResponse(BaseModel):
    total_triggers: int = 0
    total_feedbacks: int = 0
    avg_engagement: float = 0.0
    avg_keywords: float = 0.0


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.post("/check", response_model=DACheckResponse)
async def check_devils_advocate(
    trace_id: str = Query(..., description="Trace ID to check"),
    disagreement_score: float = Query(..., ge=0.0, le=1.0, description="Current disagreement score"),
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKeyModel = Depends(verify_api_key),
):
    """
    Check if Devil's Advocate should trigger for a trace.

    Triggered when disagreement_score < 0.1 (high consensus, potential groupthink).
    """
    if disagreement_score >= TRIGGER_THRESHOLD:
        return DACheckResponse(
            triggered=False,
            critical_prompt=None,
            message=f"Disagreement {disagreement_score:.2f} >= threshold {TRIGGER_THRESHOLD}. No DA needed.",
        )

    # Generate critical prompt
    prompt = _assigner.generate_critical_prompt(task_type=TaskType.QA)

    # Persist trigger to DB
    entry = DevilsAdvocateLog(
        trace_id=trace_id,
        critical_prompt=prompt,
    )
    session.add(entry)

    log.info(
        "Devils advocate triggered",
        trace_id=trace_id,
        disagreement=disagreement_score,
    )

    return DACheckResponse(
        triggered=True,
        critical_prompt=prompt,
        message=f"High consensus detected (disagreement={disagreement_score:.2f}). Critical review recommended.",
    )


@router.post("/feedback", response_model=DAFeedbackResponse)
async def submit_da_feedback(
    request: DAFeedbackRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKeyModel = Depends(verify_api_key),
):
    """
    Submit Devil's Advocate feedback and analyze engagement.
    """
    # Analyze critical engagement
    engagement_score, keywords_found = _assigner.analyze_critical_engagement(request.feedback_text)

    # Persist feedback to DB
    entry = DevilsAdvocateLog(
        trace_id=request.trace_id,
        feedback_text=request.feedback_text,
        assessment=request.assessment,
        engagement_score=round(engagement_score, 4),
        keywords_found=keywords_found,
    )
    session.add(entry)

    log.info(
        "DA feedback received",
        trace_id=request.trace_id,
        engagement=round(engagement_score, 3),
        keywords=keywords_found,
    )

    return DAFeedbackResponse(
        received=True,
        engagement_score=round(engagement_score, 4),
        critical_keywords_found=keywords_found,
    )


@router.get("/effectiveness", response_model=DAEffectivenessResponse)
async def get_da_effectiveness(
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKeyModel = Depends(verify_api_key),
):
    """Aggregate Devil's Advocate effectiveness metrics from DB."""
    # Count triggers (entries with critical_prompt)
    trigger_result = await session.execute(
        select(func.count(DevilsAdvocateLog.id)).where(
            DevilsAdvocateLog.critical_prompt.isnot(None)
        )
    )
    total_triggers = trigger_result.scalar() or 0

    # Aggregate feedback entries (entries with feedback_text)
    feedback_result = await session.execute(
        select(
            func.count(DevilsAdvocateLog.id),
            func.avg(DevilsAdvocateLog.engagement_score),
            func.avg(DevilsAdvocateLog.keywords_found),
        ).where(DevilsAdvocateLog.feedback_text.isnot(None))
    )
    row = feedback_result.one()
    total_feedbacks = row[0] or 0
    avg_engagement = float(row[1]) if row[1] else 0.0
    avg_keywords = float(row[2]) if row[2] else 0.0

    return DAEffectivenessResponse(
        total_triggers=total_triggers,
        total_feedbacks=total_feedbacks,
        avg_engagement=round(avg_engagement, 4),
        avg_keywords=round(avg_keywords, 2),
    )
