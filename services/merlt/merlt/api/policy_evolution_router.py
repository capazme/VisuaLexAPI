"""
Policy Evolution Router
========================

Time-series endpoints for policy weight evolution tracking.

Endpoints:
- GET /policy-evolution/time-series: Confidence/reward over sliding window
- GET /policy-evolution/expert-evolution: Expert usage stacked over time
- GET /policy-evolution/aggregation-history: Disagreement trends per component
"""

import structlog
from collections import defaultdict
from datetime import datetime, timedelta, UTC
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey

from merlt.experts.models import QATrace, QAFeedback, AggregatedFeedback
from merlt.rlcf.database import get_async_session

log = structlog.get_logger()

router = APIRouter(prefix="/policy-evolution", tags=["policy-evolution"])


# =============================================================================
# MODELS
# =============================================================================


class TimeSeriesPoint(BaseModel):
    timestamp: str
    confidence: Optional[float] = None
    reward: Optional[float] = None
    query_count: int = 0


class ExpertEvolutionPoint(BaseModel):
    timestamp: str
    literal: float = 0.0
    systemic: float = 0.0
    principles: float = 0.0
    precedent: float = 0.0


class AggregationHistoryPoint(BaseModel):
    timestamp: str
    component: str
    avg_rating: Optional[float] = None
    disagreement_score: Optional[float] = None
    total_feedback: int = 0


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/time-series")
async def get_time_series(
    metric: str = Query("confidence", description="Metric: confidence or reward"),
    window: int = Query(50, ge=5, le=500, description="Sliding window size (traces)"),
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum records to return"),
    api_key: ApiKey = Depends(verify_api_key),
) -> List[TimeSeriesPoint]:
    """
    Confidence or reward time-series from QATrace data.

    Returns data points computed from the last N traces, grouped by day.
    """
    log.info("Getting policy time-series", metric=metric, window=window)

    try:
        async with get_async_session() as session:
            # Confidence from traces
            trace_result = await session.execute(
                select(
                    func.date(QATrace.created_at).label("day"),
                    func.avg(QATrace.confidence).label("avg_confidence"),
                    func.count(QATrace.trace_id).label("query_count"),
                )
                .where(QATrace.consent_level != "anonymous")
                .group_by(func.date(QATrace.created_at))
                .order_by(func.date(QATrace.created_at).desc())
                .limit(window)
            )
            trace_rows = trace_result.all()

            # Reward from feedback (avg inline_rating normalized to 0-1)
            fb_result = await session.execute(
                select(
                    func.date(QAFeedback.created_at).label("day"),
                    func.avg(QAFeedback.inline_rating).label("avg_rating"),
                )
                .where(QAFeedback.inline_rating.isnot(None))
                .group_by(func.date(QAFeedback.created_at))
            )
            reward_by_day = {
                str(row.day): round((row.avg_rating - 1) / 4, 4)
                for row in fb_result.all()
                if row.avg_rating is not None
            }

        all_points = []
        for row in reversed(trace_rows):
            day_str = str(row.day)
            all_points.append(TimeSeriesPoint(
                timestamp=day_str,
                confidence=round(row.avg_confidence, 4) if row.avg_confidence else None,
                reward=reward_by_day.get(day_str),
                query_count=row.query_count,
            ))
        return all_points[offset:offset + limit]

    except Exception as e:
        log.warning("time-series fetch failed", error=str(e))
        return []


@router.get("/expert-evolution")
async def get_expert_evolution(
    days: int = Query(30, ge=1, le=180, description="Period in days"),
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum records to return"),
    api_key: ApiKey = Depends(verify_api_key),
) -> List[ExpertEvolutionPoint]:
    """
    Expert usage evolution: how often each expert is selected, by day.

    Returns stacked area chart data showing expert selection distribution.
    """
    log.info("Getting expert evolution", days=days)

    try:
        since = datetime.now(UTC) - timedelta(days=days)

        async with get_async_session() as session:
            result = await session.execute(
                select(QATrace.created_at, QATrace.selected_experts)
                .where(
                    QATrace.created_at >= since,
                    QATrace.selected_experts.isnot(None),
                )
                .order_by(QATrace.created_at)
            )
            rows = result.all()

        # Group by day and count expert selections
        daily_counts: dict = defaultdict(lambda: {"literal": 0, "systemic": 0, "principles": 0, "precedent": 0, "total": 0})

        for created_at, experts in rows:
            day = str(created_at.date())
            if experts:
                for exp in experts:
                    if exp in daily_counts[day]:
                        daily_counts[day][exp] += 1
                daily_counts[day]["total"] += 1

        all_points = []
        for day in sorted(daily_counts.keys()):
            counts = daily_counts[day]
            total = counts["total"] or 1
            all_points.append(ExpertEvolutionPoint(
                timestamp=day,
                literal=round(counts["literal"] / total, 4),
                systemic=round(counts["systemic"] / total, 4),
                principles=round(counts["principles"] / total, 4),
                precedent=round(counts["precedent"] / total, 4),
            ))
        return all_points[offset:offset + limit]

    except Exception as e:
        log.warning("expert-evolution fetch failed", error=str(e))
        return []


@router.get("/aggregation-history")
async def get_aggregation_history(
    days: int = Query(30, ge=1, le=180, description="Period in days"),
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum records to return"),
    api_key: ApiKey = Depends(verify_api_key),
) -> List[AggregationHistoryPoint]:
    """
    Aggregated feedback trends per component from AggregatedFeedback table.
    """
    log.info("Getting aggregation history", days=days)

    try:
        since = datetime.now(UTC) - timedelta(days=days)

        async with get_async_session() as session:
            result = await session.execute(
                select(AggregatedFeedback)
                .where(AggregatedFeedback.period_end >= since)
                .order_by(AggregatedFeedback.period_end)
            )
            rows = result.scalars().all()

        all_points = []
        for row in rows:
            all_points.append(AggregationHistoryPoint(
                timestamp=row.period_end.isoformat() if row.period_end else "",
                component=row.component or "",
                avg_rating=row.avg_rating,
                disagreement_score=row.disagreement_score,
                total_feedback=row.total_feedback or 0,
            ))
        return all_points[offset:offset + limit]

    except Exception as e:
        log.warning("aggregation-history fetch failed", error=str(e))
        return []
