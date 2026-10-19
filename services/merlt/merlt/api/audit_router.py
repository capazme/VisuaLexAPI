"""
Audit Log Router
=================

GET endpoints for querying the immutable audit trail.

Endpoints:
- GET /audit/logs: Query audit log with filters
"""

import structlog
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Query, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.rlcf.database import get_async_session_dep
from merlt.rlcf.audit_service import AuditService

log = structlog.get_logger()

router = APIRouter(prefix="/audit", tags=["audit"])

_audit_service = AuditService()


class AuditLogResponse(BaseModel):
    id: int
    timestamp: str
    action: str
    actor_hash: str
    resource_type: str
    resource_id: str
    content_hash: Optional[str] = None
    consent_level: Optional[str] = None
    prev_hash: Optional[str] = None


@router.get("/logs", response_model=List[AuditLogResponse])
async def get_audit_logs(
    since: Optional[str] = Query(None, description="ISO timestamp start"),
    until: Optional[str] = Query(None, description="ISO timestamp end"),
    action: Optional[str] = Query(None, description="Filter: CREATE, UPDATE, DELETE"),
    resource_type: Optional[str] = Query(None, description="Filter: feedback, trace, etc."),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(require_role("admin")),
) -> List[AuditLogResponse]:
    """Query audit log entries with optional filters."""
    since_dt = datetime.fromisoformat(since) if since else None
    until_dt = datetime.fromisoformat(until) if until else None

    entries = await _audit_service.get_logs(
        session,
        since=since_dt,
        until=until_dt,
        action_filter=action,
        resource_type=resource_type,
        limit=limit,
        offset=offset,
    )

    return [
        AuditLogResponse(
            id=e.id,
            timestamp=e.timestamp.isoformat() if e.timestamp else "",
            action=e.action,
            actor_hash=e.actor_hash,
            resource_type=e.resource_type,
            resource_id=e.resource_id,
            content_hash=e.content_hash,
            consent_level=e.consent_level,
            prev_hash=e.prev_hash,
        )
        for e in entries
    ]
