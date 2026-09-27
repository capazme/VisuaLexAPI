"""
MERL-T Research Tracking Router
================================

Receives anonymized RLCF interaction events from the frontend (Slice 1 signals).
Events are persisted to PostgreSQL (`tracking_events`) so they survive restarts
and give the feedback loop a durable input substrate. If the DB is unavailable
the endpoint falls back to a bounded in-memory buffer (best-effort, never fails
the fire-and-forget event).

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
from merlt.storage.enrichment.database import get_db_session
from merlt.storage.enrichment.models import TrackingEventRecord

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
# Persistence helpers
# =============================================================================

# Bounded fallback buffer used only when the DB is unreachable.
_event_buffer: List[Dict[str, Any]] = []
_MAX_BUFFER = 10000


def build_tracking_records(events: List[TrackingEvent]) -> List[TrackingEventRecord]:
    """Map incoming events to ORM rows, lifting an opaque user_id out of the payload."""
    records: List[TrackingEventRecord] = []
    for event in events:
        user_id = None
        if isinstance(event.data, dict):
            raw_uid = event.data.get("user_id")
            if raw_uid is not None:
                user_id = str(raw_uid)
        records.append(
            TrackingEventRecord(
                event_type=event.type,
                user_id=user_id,
                payload=event.data,
                client_ts=event.timestamp,
            )
        )
    return records


async def persist_tracking_events(session, events: List[TrackingEvent]) -> int:
    """Add tracking rows to the session. Returns the number of rows staged."""
    records = build_tracking_records(events)
    for record in records:
        session.add(record)
    return len(records)


def _buffer_fallback(events: List[TrackingEvent]) -> None:
    global _event_buffer
    for event in events:
        _event_buffer.append(
            {
                "type": event.type,
                "data": event.data,
                "client_ts": event.timestamp,
                "server_ts": datetime.now(timezone.utc).isoformat(),
            }
        )
    if len(_event_buffer) > _MAX_BUFFER:
        _event_buffer = _event_buffer[-_MAX_BUFFER:]


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

    Persisted to PostgreSQL; on DB failure, buffered in memory (best-effort).
    """
    persisted = False
    try:
        async with get_db_session() as session:
            await persist_tracking_events(session, batch.events)
        persisted = True
    except Exception as e:
        log.error("Tracking persist failed, falling back to buffer", error=str(e))
        _buffer_fallback(batch.events)

    log.debug(
        "Tracking events received",
        count=len(batch.events),
        persisted=persisted,
        buffer_size=len(_event_buffer),
    )

    return TrackingResponse(
        received=len(batch.events),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


__all__ = ["router", "build_tracking_records", "persist_tracking_events"]
