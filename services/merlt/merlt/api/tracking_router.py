"""
MERL-T Research Tracking Router
================================

Receives the RLCF interaction events the VisuaLex server relays (Slice 1
signals). They are personal data: each carries the VisuaLex user id in clear,
and a highlight the passage the user selected; never the words of a note (the
owner, 18 October 2026: the server does not relay them). They are persisted to
PostgreSQL (`tracking_events`), expire after the retention period
(`merlt.privacy.retention`) and are exported and erased by user
(`merlt.privacy.user_data`). If the DB is unavailable the endpoint answers 503
and keeps nothing: the event is lost, and the VisuaLex server notes the failure
in its dead-letter log, which keeps no personal data and expires
(apps/server/src/services/merlt/deadLetterLog.ts). An in-memory buffer here was
never drained, and an erasure could not reach it.

Endpoints:
- POST /tracking/events - Receive batch of tracking events
"""

import structlog
from typing import List, Dict, Any
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
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

def build_tracking_records(events: List[TrackingEvent]) -> List[TrackingEventRecord]:
    """Map incoming events to ORM rows, lifting the VisuaLex user id out of the
    payload into its own column (the erasure and the export find rows by it)."""
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


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/events", response_model=TrackingResponse)
async def receive_tracking_events(
    batch: TrackingBatch,
    api_key: ApiKey = Depends(verify_api_key),
) -> TrackingResponse:
    """
    Receive a batch of tracking events relayed by the VisuaLex server.

    Persisted to PostgreSQL; on DB failure, 503 and nothing kept.
    """
    try:
        async with get_db_session() as session:
            await persist_tracking_events(session, batch.events)
    except Exception as e:
        # The class only: the message can carry the payload's SQL parameters.
        log.error("Tracking persist failed", error=type(e).__name__)
        raise HTTPException(status_code=503, detail="tracking store unavailable")

    log.debug("Tracking events received", count=len(batch.events))

    return TrackingResponse(
        received=len(batch.events),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


__all__ = ["router", "build_tracking_records", "persist_tracking_events"]
