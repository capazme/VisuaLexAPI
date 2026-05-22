"""
Dataset Export Router
=====================

GDPR-compliant dataset export for academic analysis.

Endpoints:
- GET /export/feedback: Export QAFeedback dataset
- GET /export/traces: Export QATrace dataset
- GET /export/aggregation: Export AggregatedFeedback dataset
"""

import structlog
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from merlt.api.auth import require_role
from merlt.experts.models import ApiKey
from merlt.rlcf.export_service import DatasetExportService
from merlt.rlcf.database import get_async_session

log = structlog.get_logger()

router = APIRouter(prefix="/export", tags=["export"])

_svc = DatasetExportService()


@router.get("/feedback")
async def export_feedback(
    since_days: int = Query(30, ge=1, le=365, description="Export data from last N days"),
    output_format: str = Query("json", description="json or csv"),
    anonymize: bool = Query(True, description="Anonymize user data"),
    api_key: ApiKey = Depends(require_role("admin")),
):
    """Export QAFeedback dataset for academic analysis."""
    log.info("Exporting feedback dataset", since_days=since_days, output_format=output_format, anonymize=anonymize)

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=since_days)

    async with get_async_session() as session:
        result = await _svc.export_feedback_dataset(
            session, since=since, output_format=output_format, anonymize=anonymize
        )

    if output_format == "csv":
        return Response(
            content=result["data"],
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=feedback_export.csv"},
        )
    return result


@router.get("/traces")
async def export_traces(
    since_days: int = Query(30, ge=1, le=365, description="Export data from last N days"),
    output_format: str = Query("json", description="json or csv"),
    anonymize: bool = Query(True, description="Anonymize user data"),
    api_key: ApiKey = Depends(require_role("admin")),
):
    """Export QATrace dataset for academic analysis."""
    log.info("Exporting traces dataset", since_days=since_days, output_format=output_format, anonymize=anonymize)

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=since_days)

    async with get_async_session() as session:
        result = await _svc.export_traces_dataset(
            session, since=since, output_format=output_format, anonymize=anonymize
        )

    if output_format == "csv":
        return Response(
            content=result["data"],
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=traces_export.csv"},
        )
    return result


@router.get("/aggregation")
async def export_aggregation(
    since_days: int = Query(30, ge=1, le=365, description="Export data from last N days"),
    api_key: ApiKey = Depends(require_role("admin")),
):
    """Export AggregatedFeedback dataset (no user data)."""
    log.info("Exporting aggregation dataset", since_days=since_days)

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=since_days)

    async with get_async_session() as session:
        result = await _svc.export_aggregation_dataset(session, since=since)

    return result
