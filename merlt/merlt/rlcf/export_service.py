"""
Dataset Export Service
======================

GDPR-compliant export of feedback, traces, and aggregation data
for academic analysis.

Features:
- Anonymization: SHA-256 hash of user_id with salt, query text removal
- GDPR: skips consent_level='anonymous' records
- Formats: JSON and CSV (via csv.DictWriter → io.StringIO)

Example:
    >>> from merlt.rlcf.export_service import DatasetExportService
    >>> svc = DatasetExportService()
    >>> async with get_async_session() as session:
    ...     data = await svc.export_feedback_dataset(session, format="json", anonymize=True)
"""

import csv
import hashlib
import io
import os
import structlog
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from merlt.experts.models import QATrace, QAFeedback, AggregatedFeedback

log = structlog.get_logger()


def _get_anon_salt() -> str:
    """Get anonymization salt from environment. Fails loudly if missing."""
    salt = os.getenv("EXPORT_ANON_SALT")
    if not salt:
        raise RuntimeError(
            "EXPORT_ANON_SALT environment variable is required for anonymized exports. "
            "Set it to a random secret string."
        )
    return salt


class DatasetExportService:
    """Export datasets for academic analysis with GDPR compliance."""

    @staticmethod
    def _anonymize_user_id(user_id: str) -> str:
        """Deterministic SHA-256 hash with salt from env."""
        salt = _get_anon_salt()
        return hashlib.sha256(
            f"{salt}:{user_id}".encode()
        ).hexdigest()[:16]

    @staticmethod
    def _to_csv(rows: list[dict]) -> str:
        """Convert list of dicts to CSV string."""
        if not rows:
            return ""
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue()

    async def export_feedback_dataset(
        self,
        session: AsyncSession,
        since: Optional[datetime] = None,
        output_format: str = "json",
        anonymize: bool = True,
    ) -> dict:
        """
        Export QAFeedback records.

        GDPR: joins with QATrace to skip anonymous consent traces.
        Anonymize: hash user_id, omit detailed_comment and follow_up_query.
        """
        period_start = since or (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30))

        query = (
            select(QAFeedback, QATrace.consent_level)
            .join(QATrace, QAFeedback.trace_id == QATrace.trace_id)
            .where(
                QAFeedback.created_at >= period_start,
                QATrace.consent_level != "anonymous",
            )
            .order_by(QAFeedback.created_at)
        )

        result = await session.execute(query)
        rows_raw = result.all()

        rows = []
        for fb, consent in rows_raw:
            row = {
                "feedback_id": fb.id,
                "trace_id": fb.trace_id,
                "user_id": self._anonymize_user_id(fb.user_id) if anonymize else fb.user_id,
                "inline_rating": fb.inline_rating,
                "retrieval_score": fb.retrieval_score,
                "reasoning_score": fb.reasoning_score,
                "synthesis_score": fb.synthesis_score,
                "source_relevance": fb.source_relevance,
                "preferred_expert": fb.preferred_expert,
                "user_authority": fb.user_authority,
                "created_at": fb.created_at.isoformat() if fb.created_at else None,
                "consent_level": consent,
            }
            # Only include text fields if not anonymizing
            if not anonymize:
                row["detailed_comment"] = fb.detailed_comment
                row["source_id"] = fb.source_id
            rows.append(row)

        if output_format == "csv":
            return {"format": "csv", "data": self._to_csv(rows), "count": len(rows)}
        return {"format": "json", "data": rows, "count": len(rows)}

    async def export_traces_dataset(
        self,
        session: AsyncSession,
        since: Optional[datetime] = None,
        output_format: str = "json",
        anonymize: bool = True,
    ) -> dict:
        """
        Export QATrace records.

        GDPR: skips anonymous consent traces.
        Anonymize: hash user_id, omit query text (keep query_type).
        """
        period_start = since or (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30))

        query = (
            select(QATrace)
            .where(
                QATrace.created_at >= period_start,
                QATrace.consent_level != "anonymous",
            )
            .order_by(QATrace.created_at)
        )

        result = await session.execute(query)
        traces = result.scalars().all()

        rows = []
        for t in traces:
            row = {
                "trace_id": t.trace_id,
                "user_id": self._anonymize_user_id(t.user_id) if anonymize else t.user_id,
                "query_type": t.query_type,
                "selected_experts": t.selected_experts,
                "synthesis_mode": t.synthesis_mode,
                "confidence": t.confidence,
                "execution_time_ms": t.execution_time_ms,
                "routing_method": t.routing_method,
                "consent_level": t.consent_level,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            if not anonymize:
                row["query"] = t.query
                row["synthesis_text"] = t.synthesis_text
            # For CSV, flatten selected_experts
            if output_format == "csv" and t.selected_experts:
                row["selected_experts"] = ",".join(t.selected_experts)
            rows.append(row)

        if output_format == "csv":
            return {"format": "csv", "data": self._to_csv(rows), "count": len(rows)}
        return {"format": "json", "data": rows, "count": len(rows)}

    async def export_aggregation_dataset(
        self,
        session: AsyncSession,
        since: Optional[datetime] = None,
    ) -> dict:
        """
        Export AggregatedFeedback records (no user data, no anonymization needed).
        """
        period_start = since or (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=30))

        query = (
            select(AggregatedFeedback)
            .where(AggregatedFeedback.period_end >= period_start)
            .order_by(AggregatedFeedback.period_end)
        )

        result = await session.execute(query)
        aggs = result.scalars().all()

        rows = []
        for a in aggs:
            rows.append({
                "id": a.id,
                "component": a.component,
                "period_start": a.period_start.isoformat() if a.period_start else None,
                "period_end": a.period_end.isoformat() if a.period_end else None,
                "avg_rating": a.avg_rating,
                "authority_weighted_avg": a.authority_weighted_avg,
                "disagreement_score": a.disagreement_score,
                "total_feedback": a.total_feedback,
            })

        return {"format": "json", "data": rows, "count": len(rows)}
