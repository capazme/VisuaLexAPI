"""
MERL-T Research Tracking Router
================================

Receives anonymized interaction events from the frontend for research analytics.
Events are stored in-memory (future: PostgreSQL) and can be exported for analysis.

Endpoints:
- POST /tracking/events - Receive batch of tracking events
"""

import structlog
from typing import List, Dict, Any
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from merlt.api.auth import verify_api_key
from merlt.experts.models import ApiKey

log = structlog.get_logger()

router = APIRouter(prefix="/tracking", tags=["tracking"])


# =============================================================================
# Models
# =============================================================================

class TrackingEvent(BaseModel):
    type: str = Field(..., description="Event type (e.g. 'article:viewed')")
    data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: int = Field(..., description="Unix timestamp ms")


class TrackingBatch(BaseModel):
    events: List[TrackingEvent] = Field(default_factory=list)


class TrackingResponse(BaseModel):
    received: int
    timestamp: str


# =============================================================================
# In-memory store (replace with DB in production)
# =============================================================================

_event_buffer: List[Dict[str, Any]] = []
_MAX_BUFFER = 10000


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/events", response_model=TrackingResponse)
async def receive_tracking_events(
    batch: TrackingBatch,
    api_key: ApiKey = Depends(verify_api_key),
) -> TrackingResponse:
    """
    Receive a batch of anonymized tracking events from the frontend.

    Events are buffered in memory. No PII is stored.
    """
    global _event_buffer

    for event in batch.events:
        _event_buffer.append({
            "type": event.type,
            "data": event.data,
            "client_ts": event.timestamp,
            "server_ts": datetime.now(timezone.utc).isoformat(),
        })

    # Trim buffer if too large
    if len(_event_buffer) > _MAX_BUFFER:
        _event_buffer = _event_buffer[-_MAX_BUFFER:]

    log.debug(
        "Tracking events received",
        count=len(batch.events),
        buffer_size=len(_event_buffer),
    )

    return TrackingResponse(
        received=len(batch.events),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


__all__ = ["router"]
