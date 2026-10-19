"""
Audit Service
==============

Immutable, hash-chained audit log for RLCF operations.

Each entry records who did what, when, with a SHA-256 hash chain
for tamper detection. Actor IDs are hashed for privacy.

Example:
    >>> from merlt.rlcf.audit_service import AuditService
    >>> audit = AuditService()
    >>> await audit.log_event(session, "CREATE", "user123", "feedback", "42", {"rating": 5})
"""

import hashlib
import json
import structlog
from datetime import datetime, UTC
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from merlt.experts.models import AuditLogEntry

log = structlog.get_logger()


class AuditService:
    """Writes and queries immutable audit log entries."""

    def __init__(self, salt: str = "merlt_audit"):
        self._salt = salt
        self._prev_hash: Optional[str] = None

    def _hash_actor(self, actor_id: str) -> str:
        """Deterministic SHA-256 hash of actor ID."""
        return hashlib.sha256(
            f"{self._salt}:{actor_id}".encode()
        ).hexdigest()

    def _hash_content(self, details: Optional[Dict]) -> Optional[str]:
        """SHA-256 hash of payload for integrity verification."""
        if not details:
            return None
        payload = json.dumps(details, sort_keys=True, default=str)
        return hashlib.sha256(payload.encode()).hexdigest()

    def _compute_chain_hash(self, entry_data: str) -> str:
        """Compute hash including previous entry for chain integrity."""
        prev = self._prev_hash or "genesis"
        combined = f"{prev}:{entry_data}"
        return hashlib.sha256(combined.encode()).hexdigest()

    async def log_event(
        self,
        session: AsyncSession,
        action: str,
        actor_id: str,
        resource_type: str,
        resource_id: str,
        details: Optional[Dict[str, Any]] = None,
        consent_level: Optional[str] = None,
    ) -> AuditLogEntry:
        """
        Record an audit event.

        Args:
            session: Database session
            action: CREATE, UPDATE, or DELETE
            actor_id: Raw user ID (will be hashed)
            resource_type: feedback, trace, etc.
            resource_id: ID of the affected resource
            details: Optional JSON details
            consent_level: Optional consent level

        Returns:
            Created AuditLogEntry
        """
        actor_hash = self._hash_actor(actor_id)
        content_hash = self._hash_content(details)

        chain_data = f"{action}:{actor_hash}:{resource_type}:{resource_id}:{content_hash}"
        prev_hash = self._compute_chain_hash(chain_data)

        entry = AuditLogEntry(
            action=action,
            actor_hash=actor_hash,
            resource_type=resource_type,
            resource_id=str(resource_id),
            content_hash=content_hash,
            consent_level=consent_level,
            prev_hash=self._prev_hash,
            details=details,
        )
        session.add(entry)
        await session.flush()

        self._prev_hash = prev_hash

        log.debug(
            "Audit event logged",
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
        )
        return entry

    async def get_logs(
        self,
        session: AsyncSession,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        action_filter: Optional[str] = None,
        resource_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[AuditLogEntry]:
        """
        Query audit log entries with filters.

        Args:
            session: Database session
            since: Start timestamp
            until: End timestamp
            action_filter: Filter by action type
            resource_type: Filter by resource type
            limit: Max results
            offset: Skip N results

        Returns:
            List of matching AuditLogEntry
        """
        query = select(AuditLogEntry).order_by(desc(AuditLogEntry.timestamp))

        if since:
            query = query.where(AuditLogEntry.timestamp >= since)
        if until:
            query = query.where(AuditLogEntry.timestamp <= until)
        if action_filter:
            query = query.where(AuditLogEntry.action == action_filter)
        if resource_type:
            query = query.where(AuditLogEntry.resource_type == resource_type)

        query = query.offset(offset).limit(limit)
        result = await session.execute(query)
        return list(result.scalars().all())
