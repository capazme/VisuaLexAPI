"""
Expert Metrics Router
=====================

Endpoints REST per metriche e statistiche del sistema Expert.

Questo router espone API per:
- Performance per expert (accuracy, latency, usage)
- Statistiche classificazione query
- Reasoning trace visualizzazione
- Aggregation stats (agreement rate, divergence)

Dati reali da QATrace e QAFeedback (PostgreSQL).

Endpoints:
- GET /expert-metrics/performance - Metriche performance per expert
- GET /expert-metrics/queries/stats - Statistiche classificazione query
- GET /expert-metrics/queries/recent - Query recenti con trace
- GET /expert-metrics/trace/{trace_id} - Reasoning trace singolo
- GET /expert-metrics/aggregation - Statistiche aggregazione

Example:
    >>> response = await client.get("/api/v1/expert-metrics/performance")
    >>> performance = response.json()
    >>> for expert in performance["experts"]:
    ...     print(f"{expert['name']}: {expert['accuracy']}%")
"""

from datetime import datetime, UTC
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey

log = structlog.get_logger()

router = APIRouter(prefix="/expert-metrics", tags=["expert-metrics"])


# =============================================================================
# MODELS
# =============================================================================


class ExpertPerformance(BaseModel):
    """Performance metrics per singolo expert."""
    name: str
    display_name: str
    accuracy: float = Field(0.0, ge=0.0, le=100.0, description="Accuracy %")
    accuracy_ci: tuple[float, float] = Field((0.0, 0.0), description="95% CI")
    latency_ms: float = Field(0.0, description="Latenza media in ms")
    latency_p95: float = Field(0.0, description="Latenza p95 in ms")
    usage_percentage: float = Field(0.0, ge=0.0, le=100.0, description="% query gestite")
    feedback_score: float = Field(0.0, ge=-1.0, le=1.0, description="Score feedback medio")
    feedback_count: int = Field(0, description="Numero feedback ricevuti")
    queries_handled: int = Field(0, description="Query totali gestite")


class ExpertPerformanceResponse(BaseModel):
    """Response con performance di tutti gli expert."""
    experts: List[ExpertPerformance] = Field(default_factory=list)
    period_days: int = 7
    total_queries: int = 0
    last_updated: Optional[str] = None


class QueryTypeStats(BaseModel):
    """Statistiche per tipo di query."""
    type: str
    count: int = 0
    percentage: float = 0.0
    avg_latency_ms: float = 0.0
    avg_confidence: float = 0.0


class QueryStatsResponse(BaseModel):
    """Response con statistiche query."""
    total_queries: int = 0
    by_type: List[QueryTypeStats] = Field(default_factory=list)
    avg_latency_ms: float = 0.0
    avg_confidence: float = 0.0
    period_days: int = 7


class RecentQuery(BaseModel):
    """Query recente con summary."""
    trace_id: str
    query: str
    timestamp: str  # ISO format
    experts_used: List[str]
    confidence: float
    latency_ms: int
    mode: str  # convergent, divergent
    feedback_received: bool = False


class RecentQueriesResponse(BaseModel):
    """Response con query recenti."""
    queries: List[RecentQuery] = Field(default_factory=list)
    total_count: int = 0
    has_more: bool = False


class ExpertContribution(BaseModel):
    """Contributo di un singolo expert nella risposta."""
    expert_name: str
    confidence: float = 0.0
    weight: float = 0.0
    sources_cited: int = 0
    key_points: List[str] = Field(default_factory=list)
    excerpt: Optional[str] = None


class ReasoningTrace(BaseModel):
    """Trace completo del reasoning per una query."""
    trace_id: str
    query: str
    timestamp: str  # ISO format

    # Experts contributions
    contributions: List[ExpertContribution] = Field(default_factory=list)

    # Aggregation
    aggregation_method: str = ""
    final_confidence: float = 0.0
    confidence_ci: tuple[float, float] = (0.0, 0.0)

    # Output
    synthesis: str = ""
    mode: str = ""
    has_alternatives: bool = False

    # Performance
    total_latency_ms: int = 0
    sources_count: int = 0


class AggregationStats(BaseModel):
    """Statistiche di aggregazione delle risposte."""
    method: str = "weighted_consensus"
    total_responses: int = 0
    agreement_rate: float = 0.0  # % quando tutti concordano
    divergence_count: int = 0  # Query con divergenza
    divergence_rate: float = 0.0
    avg_confidence: float = 0.0
    confidence_ci: tuple[float, float] = (0.0, 0.0)
    avg_experts_per_query: float = 0.0


# =============================================================================
# REAL DATA ACCESS
# =============================================================================


async def _get_expert_list(period_days: int = 30) -> List[ExpertPerformance]:
    """
    Ritorna lista expert con metriche reali da QATrace e QAFeedback.
    """
    try:
        from merlt.rlcf.database import get_async_session
        from merlt.experts.models import QATrace, QAFeedback
        from sqlalchemy import select, func
        from datetime import datetime, timedelta, UTC

        since = datetime.now(UTC) - timedelta(days=period_days)

        async with get_async_session() as session:
            # Total queries in period
            total_result = await session.execute(
                select(func.count(QATrace.trace_id)).where(QATrace.created_at >= since)
            )
            total_queries = total_result.scalar() or 0

            # Get all traces to count expert usage
            traces_result = await session.execute(
                select(QATrace.selected_experts, QATrace.execution_time_ms, QATrace.confidence)
                .where(QATrace.created_at >= since)
            )
            traces = traces_result.all()

            expert_stats: dict = {
                name: {"count": 0, "latency_sum": 0, "conf_sum": 0.0, "conf_count": 0}
                for name in ["literal", "systemic", "principles", "precedent"]
            }

            for experts, latency, confidence in traces:
                if experts:
                    for exp in experts:
                        if exp in expert_stats:
                            expert_stats[exp]["count"] += 1
                            if latency:
                                expert_stats[exp]["latency_sum"] += latency
                            if confidence is not None:
                                expert_stats[exp]["conf_sum"] += confidence
                                expert_stats[exp]["conf_count"] += 1

            # Get feedback scores per expert
            fb_result = await session.execute(
                select(QAFeedback.preferred_expert, func.avg(QAFeedback.inline_rating))
                .where(
                    QAFeedback.created_at >= since,
                    QAFeedback.preferred_expert.isnot(None),
                )
                .group_by(QAFeedback.preferred_expert)
            )
            fb_scores = {row[0]: row[1] for row in fb_result.all()}

        display_names = {
            "literal": "LiteralExpert",
            "systemic": "SystemicExpert",
            "principles": "PrinciplesExpert",
            "precedent": "PrecedentExpert",
        }

        experts = []
        for name in ["literal", "systemic", "principles", "precedent"]:
            stats = expert_stats[name]
            count = stats["count"]
            usage_pct = (count / total_queries * 100) if total_queries > 0 else 0.0
            avg_latency = (stats["latency_sum"] / count) if count > 0 else 0.0
            avg_conf = (stats["conf_sum"] / stats["conf_count"]) if stats["conf_count"] > 0 else 0.0
            fb_score = fb_scores.get(name)
            feedback_score = ((fb_score - 3) / 2) if fb_score else 0.0  # normalize 1-5 to -1..1

            experts.append(ExpertPerformance(
                name=name,
                display_name=display_names[name],
                accuracy=round(avg_conf * 100, 1),
                latency_ms=round(avg_latency, 1),
                usage_percentage=round(usage_pct, 1),
                feedback_score=round(feedback_score, 3),
                queries_handled=count,
            ))

        return experts

    except Exception as e:
        log.warning("Failed to fetch real expert metrics, using defaults", error=str(e))
        return [
            ExpertPerformance(name="literal", display_name="LiteralExpert"),
            ExpertPerformance(name="systemic", display_name="SystemicExpert"),
            ExpertPerformance(name="principles", display_name="PrinciplesExpert"),
            ExpertPerformance(name="precedent", display_name="PrecedentExpert"),
        ]


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/performance", response_model=ExpertPerformanceResponse)
async def get_expert_performance(
    period_days: int = Query(7, ge=1, le=90, description="Periodo in giorni"),
    api_key: ApiKey = Depends(verify_api_key),
) -> ExpertPerformanceResponse:
    """
    Recupera metriche performance per ogni expert.

    NOTA: Attualmente restituisce valori default.
          Per popolare i dati, implementare tracking metriche.

    Args:
        period_days: Periodo di riferimento in giorni

    Returns:
        ExpertPerformanceResponse con performance di tutti gli expert

    Example:
        >>> GET /api/v1/expert-metrics/performance?period_days=7
        {
          "experts": [
            {"name": "literal", "accuracy": 0.0, "latency_ms": 0.0, ...},
            ...
          ],
          "total_queries": 0
        }
    """
    log.info("Getting expert performance", period_days=period_days)

    experts = await _get_expert_list(period_days=period_days)

    total_queries = sum(e.queries_handled for e in experts)

    return ExpertPerformanceResponse(
        experts=experts,
        period_days=period_days,
        total_queries=total_queries,
        last_updated=datetime.now().isoformat(),
    )


@router.get("/queries/stats", response_model=QueryStatsResponse)
async def get_query_stats(
    period_days: int = Query(7, ge=1, le=90, description="Periodo in giorni"),
    api_key: ApiKey = Depends(verify_api_key),
) -> QueryStatsResponse:
    """
    Recupera statistiche classificazione query da QATrace.

    Args:
        period_days: Periodo di riferimento

    Returns:
        QueryStatsResponse con breakdown per tipo
    """
    log.info("Getting query stats", period_days=period_days)

    try:
        from merlt.rlcf.database import get_async_session
        from merlt.experts.models import QATrace
        from sqlalchemy import select, func
        from datetime import timedelta

        since = datetime.now(UTC) - timedelta(days=period_days)

        async with get_async_session() as session:
            # Total + averages
            totals = await session.execute(
                select(
                    func.count(QATrace.trace_id),
                    func.avg(QATrace.execution_time_ms),
                    func.avg(QATrace.confidence),
                ).where(QATrace.created_at >= since)
            )
            row = totals.one()
            total_queries = row[0] or 0
            avg_latency = float(row[1] or 0)
            avg_conf = float(row[2] or 0)

            # Breakdown by query_type
            type_result = await session.execute(
                select(
                    QATrace.query_type,
                    func.count(QATrace.trace_id),
                    func.avg(QATrace.execution_time_ms),
                    func.avg(QATrace.confidence),
                )
                .where(QATrace.created_at >= since, QATrace.query_type.isnot(None))
                .group_by(QATrace.query_type)
            )
            by_type = []
            for qtype, count, lat, conf in type_result.all():
                pct = (count / total_queries * 100) if total_queries > 0 else 0
                by_type.append(QueryTypeStats(
                    type=qtype or "unknown",
                    count=count,
                    percentage=round(pct, 1),
                    avg_latency_ms=round(float(lat or 0), 1),
                    avg_confidence=round(float(conf or 0), 4),
                ))

        return QueryStatsResponse(
            total_queries=total_queries,
            by_type=by_type,
            avg_latency_ms=round(avg_latency, 1),
            avg_confidence=round(avg_conf, 4),
            period_days=period_days,
        )
    except Exception as e:
        log.warning("Failed to fetch query stats", error=str(e))
        return QueryStatsResponse(period_days=period_days)


@router.get("/queries/recent", response_model=RecentQueriesResponse)
async def get_recent_queries(
    limit: int = Query(10, ge=1, le=50, description="Numero massimo di query"),
    offset: int = Query(0, ge=0, description="Offset per paginazione"),
    api_key: ApiKey = Depends(verify_api_key),
) -> RecentQueriesResponse:
    """
    Recupera query recenti con summary da QATrace + QAFeedback.

    Args:
        limit: Numero massimo di query
        offset: Offset per paginazione

    Returns:
        RecentQueriesResponse con lista query
    """
    log.info("Getting recent queries", limit=limit, offset=offset)

    try:
        from merlt.rlcf.database import get_async_session
        from merlt.experts.models import QATrace, QAFeedback
        from sqlalchemy import select, func, exists

        async with get_async_session() as session:
            # Total count
            count_result = await session.execute(
                select(func.count(QATrace.trace_id))
            )
            total_count = count_result.scalar() or 0

            # Recent traces with feedback existence check
            traces_result = await session.execute(
                select(
                    QATrace.trace_id,
                    QATrace.query,
                    QATrace.created_at,
                    QATrace.selected_experts,
                    QATrace.confidence,
                    QATrace.execution_time_ms,
                    QATrace.synthesis_mode,
                    exists(
                        select(QAFeedback.id).where(QAFeedback.trace_id == QATrace.trace_id)
                    ).label("has_feedback"),
                )
                .order_by(QATrace.created_at.desc())
                .offset(offset)
                .limit(limit)
            )

            queries = []
            for row in traces_result.all():
                queries.append(RecentQuery(
                    trace_id=row.trace_id,
                    query=row.query[:200] if row.query else "",
                    timestamp=row.created_at.isoformat() if row.created_at else "",
                    experts_used=row.selected_experts or [],
                    confidence=float(row.confidence or 0),
                    latency_ms=row.execution_time_ms or 0,
                    mode=row.synthesis_mode or "unknown",
                    feedback_received=row.has_feedback,
                ))

        return RecentQueriesResponse(
            queries=queries,
            total_count=total_count,
            has_more=(offset + limit) < total_count,
        )
    except Exception as e:
        log.warning("Failed to fetch recent queries", error=str(e))
        return RecentQueriesResponse()


@router.get("/trace/{trace_id}", response_model=ReasoningTrace)
async def get_reasoning_trace(
    trace_id: str,
    api_key: ApiKey = Depends(verify_api_key),
) -> ReasoningTrace:
    """
    Recupera reasoning trace completo per una query.

    NOTA: Attualmente restituisce trace vuoto.
          Per popolare i dati, implementare persistenza dei trace.

    Args:
        trace_id: ID del trace

    Returns:
        ReasoningTrace con contributi di ogni expert

    Raises:
        HTTPException: Se trace non trovato

    Example:
        >>> GET /api/v1/expert-metrics/trace/trace_abc123
        {
          "trace_id": "trace_abc123",
          "query": "",
          "contributions": [],
          "final_confidence": 0.0
        }
    """
    log.info("Getting reasoning trace", trace_id=trace_id)

    # TODO: Implementare persistenza trace nel sistema Expert
    # Per ora ritorna un trace vuoto con l'ID richiesto
    return ReasoningTrace(
        trace_id=trace_id,
        query="",
        timestamp=datetime.now().isoformat(),
        contributions=[],
        aggregation_method="weighted_consensus",
        final_confidence=0.0,
        confidence_ci=(0.0, 0.0),
        synthesis="",
        mode="",
        has_alternatives=False,
        total_latency_ms=0,
        sources_count=0,
    )


@router.get("/aggregation", response_model=AggregationStats)
async def get_aggregation_stats(
    api_key: ApiKey = Depends(verify_api_key),
) -> AggregationStats:
    """
    Recupera statistiche di aggregazione delle risposte.

    NOTA: Attualmente restituisce valori default.

    Returns:
        AggregationStats con agreement rate, divergence, confidence

    Example:
        >>> GET /api/v1/expert-metrics/aggregation
        {
          "method": "weighted_consensus",
          "agreement_rate": 0.0,
          "divergence_count": 0,
          "avg_confidence": 0.0
        }
    """
    log.info("Getting aggregation stats")

    try:
        from merlt.rlcf.feedback_aggregation_service import FeedbackAggregationService
        from merlt.rlcf.database import get_async_session
        from merlt.experts.models import QATrace
        from sqlalchemy import select, func
        from datetime import datetime, timedelta

        since = datetime.now(UTC) - timedelta(days=30)
        svc = FeedbackAggregationService()

        async with get_async_session() as session:
            agg_result = await svc.run_periodic_aggregation(session, since=since)

            # Get trace-level stats
            trace_result = await session.execute(
                select(
                    func.count(QATrace.trace_id),
                    func.avg(QATrace.confidence),
                )
                .where(QATrace.created_at >= since)
            )
            row = trace_result.one()
            total_responses = row[0] or 0
            avg_confidence = row[1] or 0.0

            # Count divergent
            div_result = await session.execute(
                select(func.count(QATrace.trace_id))
                .where(
                    QATrace.created_at >= since,
                    QATrace.synthesis_mode == "divergent",
                )
            )
            divergence_count = div_result.scalar() or 0

        divergence_rate = (divergence_count / total_responses) if total_responses > 0 else 0.0
        agreement_rate = 1.0 - divergence_rate

        return AggregationStats(
            method="weighted_consensus",
            total_responses=total_responses,
            agreement_rate=round(agreement_rate * 100, 1),
            divergence_count=divergence_count,
            divergence_rate=round(divergence_rate * 100, 1),
            avg_confidence=round(avg_confidence, 4),
            confidence_ci=(0.0, 0.0),
            avg_experts_per_query=0.0,
        )

    except Exception as e:
        log.warning("Failed to fetch real aggregation stats", error=str(e))
        return AggregationStats()
