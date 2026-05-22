"""
Quarantine Service
===================

Service per gestione quarantine/flag di feedback problematico.

Permette ad admin di:
- Flag feedback sospetto
- Quarantinare feedback (esclude da training)
- Approvare feedback dopo review
- Rilevare outlier automaticamente

Esempio:
    >>> from merlt.rlcf.quarantine_service import QuarantineService
    >>>
    >>> svc = QuarantineService()
    >>> await svc.flag_feedback(session, feedback_id=123, reason="Rating outlier")
"""

import structlog
from datetime import datetime, UTC
from typing import Any, Dict, List, Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.experts.models import QAFeedback

log = structlog.get_logger()


class QuarantineService:
    """Service per quarantine e moderation di feedback."""

    async def flag_feedback(
        self,
        session: AsyncSession,
        feedback_id: int,
        reason: str,
        flagged_by: str = "admin",
    ) -> Optional[Dict[str, Any]]:
        """Flag un feedback come sospetto."""
        result = await session.execute(
            select(QAFeedback).where(QAFeedback.id == feedback_id)
        )
        feedback = result.scalar_one_or_none()
        if not feedback:
            return None

        feedback.status = "flagged"
        feedback.quarantine_reason = reason
        feedback.flagged_at = datetime.now(UTC).replace(tzinfo=None)
        feedback.flagged_by = flagged_by
        await session.commit()

        log.info("Feedback flagged", feedback_id=feedback_id, reason=reason)
        return self._to_dict(feedback)

    async def quarantine_feedback(
        self,
        session: AsyncSession,
        feedback_id: int,
        reason: str,
        reviewed_by: str = "admin",
    ) -> Optional[Dict[str, Any]]:
        """Quarantina feedback (escludi da training)."""
        result = await session.execute(
            select(QAFeedback).where(QAFeedback.id == feedback_id)
        )
        feedback = result.scalar_one_or_none()
        if not feedback:
            return None

        feedback.status = "quarantined"
        feedback.quarantine_reason = reason
        feedback.reviewed_at = datetime.now(UTC).replace(tzinfo=None)
        feedback.reviewed_by = reviewed_by
        await session.commit()

        log.info("Feedback quarantined", feedback_id=feedback_id, reason=reason)
        return self._to_dict(feedback)

    async def approve_feedback(
        self,
        session: AsyncSession,
        feedback_id: int,
        reviewed_by: str = "admin",
    ) -> Optional[Dict[str, Any]]:
        """Approva feedback dopo review."""
        result = await session.execute(
            select(QAFeedback).where(QAFeedback.id == feedback_id)
        )
        feedback = result.scalar_one_or_none()
        if not feedback:
            return None

        feedback.status = "approved"
        feedback.reviewed_at = datetime.now(UTC).replace(tzinfo=None)
        feedback.reviewed_by = reviewed_by
        await session.commit()

        log.info("Feedback approved", feedback_id=feedback_id)
        return self._to_dict(feedback)

    async def get_flagged(
        self,
        session: AsyncSession,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Lista feedback flaggati."""
        return await self._list_by_status(session, "flagged", limit, offset)

    async def get_quarantined(
        self,
        session: AsyncSession,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Lista feedback quarantinati."""
        return await self._list_by_status(session, "quarantined", limit, offset)

    async def auto_detect_outliers(
        self,
        session: AsyncSession,
        flagged_by: str = "auto_detect",
    ) -> Dict[str, Any]:
        """
        Rileva outlier automaticamente.

        Criteri:
        - Rating inline estremo (1 o 5) con authority bassa (< 0.2)
        - Feedback con commenti molto corti (< 5 chars) ma rating estremo
        """
        flagged_count = 0

        # Find low-authority extreme ratings not already flagged
        result = await session.execute(
            select(QAFeedback).where(
                and_(
                    QAFeedback.status == "approved",
                    QAFeedback.inline_rating.in_([1, 5]),
                    QAFeedback.user_authority < 0.2,
                    QAFeedback.user_authority.isnot(None),
                )
            ).limit(100)
        )

        for feedback in result.scalars().all():
            feedback.status = "flagged"
            feedback.quarantine_reason = f"Auto-detect: extreme rating ({feedback.inline_rating}) with low authority ({feedback.user_authority:.2f})"
            feedback.flagged_at = datetime.now(UTC).replace(tzinfo=None)
            feedback.flagged_by = flagged_by
            flagged_count += 1

        if flagged_count > 0:
            await session.commit()

        log.info("Auto-detect completed", flagged_count=flagged_count)
        return {"flagged_count": flagged_count, "flagged_by": flagged_by}

    async def _list_by_status(
        self,
        session: AsyncSession,
        status: str,
        limit: int,
        offset: int,
    ) -> Dict[str, Any]:
        """Lista feedback per status con paginazione."""
        # Count
        count_result = await session.execute(
            select(func.count(QAFeedback.id)).where(QAFeedback.status == status)
        )
        total = count_result.scalar() or 0

        # Query
        result = await session.execute(
            select(QAFeedback)
            .where(QAFeedback.status == status)
            .order_by(QAFeedback.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        items = [self._to_dict(f) for f in result.scalars().all()]

        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total,
        }

    @staticmethod
    def _to_dict(feedback: QAFeedback) -> Dict[str, Any]:
        return {
            "id": feedback.id,
            "trace_id": feedback.trace_id,
            "user_id": feedback.user_id,
            "inline_rating": feedback.inline_rating,
            "status": feedback.status,
            "quarantine_reason": feedback.quarantine_reason,
            "flagged_at": feedback.flagged_at.isoformat() if feedback.flagged_at else None,
            "flagged_by": feedback.flagged_by,
            "reviewed_at": feedback.reviewed_at.isoformat() if feedback.reviewed_at else None,
            "reviewed_by": feedback.reviewed_by,
            "user_authority": feedback.user_authority,
            "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
        }
