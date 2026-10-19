"""
Feedback Quarantine Router
===========================

REST API per gestione quarantine/moderation di feedback.

Endpoints:
- POST /feedback/{feedback_id}/flag — flag da admin
- POST /feedback/{feedback_id}/quarantine — quarantina
- POST /feedback/{feedback_id}/approve — approva
- GET /feedback/flagged — lista flagged con paginazione
- GET /feedback/quarantined — lista quarantinati
- POST /feedback/auto-detect — trigger outlier detection
"""

from typing import Any, Dict, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.rlcf.database import get_async_session
from merlt.rlcf.quarantine_service import QuarantineService

log = structlog.get_logger()

router = APIRouter(prefix="/feedback", tags=["feedback-quarantine"])

_service = QuarantineService()


# =============================================================================
# MODELS
# =============================================================================


class FlagRequest(BaseModel):
    reason: str
    flagged_by: str = "admin"


class QuarantineRequest(BaseModel):
    reason: str
    reviewed_by: str = "admin"


class ApproveRequest(BaseModel):
    reviewed_by: str = "admin"


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.post("/{feedback_id}/flag")
async def flag_feedback(
    feedback_id: int,
    request: FlagRequest,
    api_key: ApiKey = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Flag un feedback come sospetto."""
    async with get_async_session() as session:
        result = await _service.flag_feedback(
            session, feedback_id, request.reason, request.flagged_by
        )
    if result is None:
        raise HTTPException(status_code=404, detail=f"Feedback {feedback_id} not found")
    return result


@router.post("/{feedback_id}/quarantine")
async def quarantine_feedback(
    feedback_id: int,
    request: QuarantineRequest,
    api_key: ApiKey = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Quarantina feedback (esclude da training)."""
    async with get_async_session() as session:
        result = await _service.quarantine_feedback(
            session, feedback_id, request.reason, request.reviewed_by
        )
    if result is None:
        raise HTTPException(status_code=404, detail=f"Feedback {feedback_id} not found")
    return result


@router.post("/{feedback_id}/approve")
async def approve_feedback(
    feedback_id: int,
    request: ApproveRequest = ApproveRequest(),
    api_key: ApiKey = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Approva feedback dopo review."""
    async with get_async_session() as session:
        result = await _service.approve_feedback(
            session, feedback_id, request.reviewed_by
        )
    if result is None:
        raise HTTPException(status_code=404, detail=f"Feedback {feedback_id} not found")
    return result


@router.get("/flagged")
async def get_flagged(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, Any]:
    """Lista feedback flaggati con paginazione."""
    async with get_async_session() as session:
        return await _service.get_flagged(session, limit, offset)


@router.get("/quarantined")
async def get_quarantined(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, Any]:
    """Lista feedback quarantinati."""
    async with get_async_session() as session:
        return await _service.get_quarantined(session, limit, offset)


@router.post("/auto-detect")
async def auto_detect_outliers(
    api_key: ApiKey = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Trigger rilevazione automatica outlier."""
    async with get_async_session() as session:
        return await _service.auto_detect_outliers(session)
