"""
Feedback Aggregation Service
==============================

Aggregates QAFeedback per component with authority weighting.

Implements periodic aggregation of feedback across pipeline components
(experts, router, synthesizer, NER, bridge) weighted by user authority scores.

Uses Shannon entropy (from aggregation.py) for disagreement detection.

Example:
    >>> from merlt.rlcf.feedback_aggregation_service import FeedbackAggregationService
    >>> svc = FeedbackAggregationService()
    >>> async with get_async_session() as session:
    ...     result = await svc.run_periodic_aggregation(session)
    ...     print(f"Processed {result.total_feedback_processed} feedback")
"""

import structlog
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, UTC
from typing import Dict, List, Optional
from collections import defaultdict

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from merlt.experts.models import QATrace, QAFeedback
from merlt.rlcf.aggregation import calculate_disagreement

log = structlog.get_logger()

# Components that can be aggregated
VALID_COMPONENTS = [
    "ner", "router", "literal", "systemic", "principles",
    "precedent", "synthesizer", "bridge",
]


@dataclass
class ComponentAggregation:
    """Aggregation result for a single component."""
    component: str
    avg_rating: float
    total_feedback: int
    authority_weighted_avg: float
    disagreement_score: float
    variance: float
    period_start: datetime
    period_end: datetime

    def to_dict(self) -> Dict:
        return {
            "component": self.component,
            "avg_rating": round(self.avg_rating, 4),
            "total_feedback": self.total_feedback,
            "authority_weighted_avg": round(self.authority_weighted_avg, 4),
            "disagreement_score": round(self.disagreement_score, 4),
            "variance": round(self.variance, 4),
            "period_start": self.period_start.isoformat(),
            "period_end": self.period_end.isoformat(),
        }


@dataclass
class AggregatedTraceResult:
    """Aggregation of all feedback for a single trace."""
    trace_id: str
    total_feedback: int
    avg_inline_rating: Optional[float]
    avg_retrieval_score: Optional[float]
    avg_reasoning_score: Optional[float]
    avg_synthesis_score: Optional[float]
    authority_weighted_inline: Optional[float]
    components: Dict[str, ComponentAggregation] = field(default_factory=dict)


@dataclass
class AggregationRunResult:
    """Result of a batch aggregation run."""
    components_aggregated: int
    total_feedback_processed: int
    high_disagreement_components: List[str]
    timestamp: datetime

    def to_dict(self) -> Dict:
        return {
            "components_aggregated": self.components_aggregated,
            "total_feedback_processed": self.total_feedback_processed,
            "high_disagreement_components": self.high_disagreement_components,
            "timestamp": self.timestamp.isoformat(),
        }


class FeedbackAggregationService:
    """Aggregates QAFeedback per component, weighted by user authority."""

    DISAGREEMENT_THRESHOLD = 0.4

    async def aggregate_trace_feedback(
        self, session: AsyncSession, trace_id: str
    ) -> AggregatedTraceResult:
        """Aggregate all feedback for a single trace."""
        result = await session.execute(
            select(QAFeedback).where(QAFeedback.trace_id == trace_id)
        )
        feedbacks = result.scalars().all()

        if not feedbacks:
            return AggregatedTraceResult(
                trace_id=trace_id,
                total_feedback=0,
                avg_inline_rating=None,
                avg_retrieval_score=None,
                avg_reasoning_score=None,
                avg_synthesis_score=None,
                authority_weighted_inline=None,
            )

        # Compute inline rating averages
        inline_ratings = [
            (f.inline_rating, f.user_authority or 1.0)
            for f in feedbacks if f.inline_rating is not None
        ]
        avg_inline = None
        weighted_inline = None
        if inline_ratings:
            avg_inline = sum(r for r, _ in inline_ratings) / len(inline_ratings)
            total_w = sum(w for _, w in inline_ratings)
            if total_w > 0:
                weighted_inline = sum(r * w for r, w in inline_ratings) / total_w

        # Compute detailed score averages
        retrieval_scores = [f.retrieval_score for f in feedbacks if f.retrieval_score is not None]
        reasoning_scores = [f.reasoning_score for f in feedbacks if f.reasoning_score is not None]
        synthesis_scores = [f.synthesis_score for f in feedbacks if f.synthesis_score is not None]

        return AggregatedTraceResult(
            trace_id=trace_id,
            total_feedback=len(feedbacks),
            avg_inline_rating=avg_inline,
            avg_retrieval_score=sum(retrieval_scores) / len(retrieval_scores) if retrieval_scores else None,
            avg_reasoning_score=sum(reasoning_scores) / len(reasoning_scores) if reasoning_scores else None,
            avg_synthesis_score=sum(synthesis_scores) / len(synthesis_scores) if synthesis_scores else None,
            authority_weighted_inline=weighted_inline,
        )

    DEFAULT_AGGREGATION_DAYS = 30

    async def aggregate_component_feedback(
        self,
        session: AsyncSession,
        component: str,
        since: Optional[datetime] = None,
    ) -> ComponentAggregation:
        """Aggregate feedback for a specific component type."""
        now = datetime.now(UTC)
        period_start = since or (now - timedelta(days=self.DEFAULT_AGGREGATION_DAYS))

        # Query feedback based on component
        query = select(QAFeedback).where(QAFeedback.created_at >= period_start)

        if component in ("literal", "systemic", "principles", "precedent"):
            # Expert feedback: from preferred_expert or detailed_comment tag
            query = query.where(
                (QAFeedback.preferred_expert == component)
                | (QAFeedback.detailed_comment.ilike(f"%[expert:{component}]%"))
            )
        elif component == "router":
            query = query.where(
                QAFeedback.detailed_comment.ilike("%[router]%")
            )
        elif component == "synthesizer":
            # Detailed feedback targets synthesizer
            query = query.where(QAFeedback.synthesis_score.isnot(None))
        elif component == "bridge":
            # Source feedback targets bridge
            query = query.where(QAFeedback.source_id.isnot(None))
        else:
            # NER or generic
            query = query.where(
                QAFeedback.detailed_comment.ilike(f"%[{component}]%")
            )

        result = await session.execute(query)
        feedbacks = result.scalars().all()

        if not feedbacks:
            return ComponentAggregation(
                component=component,
                avg_rating=0.0,
                total_feedback=0,
                authority_weighted_avg=0.0,
                disagreement_score=0.0,
                variance=0.0,
                period_start=period_start,
                period_end=now,
            )

        # Extract ratings per feedback
        ratings_with_authority = []
        for f in feedbacks:
            authority = f.user_authority or 1.0
            if f.inline_rating is not None:
                rating = (f.inline_rating - 1) / 4  # normalize to 0-1
            elif f.synthesis_score is not None:
                rating = f.synthesis_score
            elif f.source_relevance is not None:
                rating = (f.source_relevance - 1) / 4
            else:
                rating = 0.5
            ratings_with_authority.append((rating, authority))

        ratings = [r for r, _ in ratings_with_authority]
        avg_rating = sum(ratings) / len(ratings) if ratings else 0.0

        # Authority-weighted average
        total_authority = sum(w for _, w in ratings_with_authority)
        if total_authority > 0:
            authority_weighted = sum(r * w for r, w in ratings_with_authority) / total_authority
        else:
            authority_weighted = avg_rating

        # Disagreement via Shannon entropy
        # Bin ratings into positions: low (0-0.33), mid (0.33-0.66), high (0.66-1.0)
        # Always include all 3 bins so calculate_disagreement sees full distribution
        positions: Dict[str, float] = {"low": 0.0, "mid": 0.0, "high": 0.0}
        for rating, authority in ratings_with_authority:
            if rating < 0.33:
                positions["low"] += authority
            elif rating < 0.66:
                positions["mid"] += authority
            else:
                positions["high"] += authority

        # Need at least 2 non-zero bins for meaningful disagreement
        non_zero_bins = sum(1 for v in positions.values() if v > 0)
        disagreement = calculate_disagreement(positions) if non_zero_bins > 1 else 0.0

        # Variance
        if len(ratings) > 1:
            mean = sum(ratings) / len(ratings)
            variance = sum((r - mean) ** 2 for r in ratings) / len(ratings)
        else:
            variance = 0.0

        return ComponentAggregation(
            component=component,
            avg_rating=avg_rating,
            total_feedback=len(feedbacks),
            authority_weighted_avg=authority_weighted,
            disagreement_score=disagreement,
            variance=variance,
            period_start=period_start,
            period_end=now,
        )

    async def run_periodic_aggregation(
        self, session: AsyncSession, since: Optional[datetime] = None
    ) -> AggregationRunResult:
        """Run batch aggregation across all components."""
        now = datetime.now(UTC)
        period_start = since or (now - timedelta(days=self.DEFAULT_AGGREGATION_DAYS))

        total_processed = 0
        high_disagreement = []
        components_done = 0

        for component in VALID_COMPONENTS:
            try:
                agg = await self.aggregate_component_feedback(
                    session, component, since=period_start
                )
                if agg.total_feedback > 0:
                    components_done += 1
                    total_processed += agg.total_feedback

                    if agg.disagreement_score > self.DISAGREEMENT_THRESHOLD:
                        high_disagreement.append(component)

                    log.debug(
                        "Component aggregated",
                        component=component,
                        total=agg.total_feedback,
                        avg=round(agg.authority_weighted_avg, 3),
                        disagreement=round(agg.disagreement_score, 3),
                    )
            except Exception as e:
                log.warning(
                    "Component aggregation failed",
                    component=component,
                    error=str(e),
                )

        result = AggregationRunResult(
            components_aggregated=components_done,
            total_feedback_processed=total_processed,
            high_disagreement_components=high_disagreement,
            timestamp=now,
        )

        log.info("Periodic aggregation completed", **result.to_dict())
        return result
