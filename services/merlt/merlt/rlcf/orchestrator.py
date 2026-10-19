"""
RLCF Orchestrator
==================

Central hub connecting Expert feedback to weight updates.

Flow:
    Expert.record_feedback()
        → RLCFOrchestrator.record_expert_feedback()
            → Persist to PostgreSQL (Feedback table)
            → Update user authority (AuthorityModule)
            → Compute weight gradients (WeightLearner)
            → Persist weights (WeightStore)

This is the missing link that activates the RLCF learning loop.

References:
    docs/rlcf/RLCF.md - RLCF Framework documentation
    merlt/weights/learner.py - Weight learning logic
    merlt/rlcf/authority.py - Authority scoring
"""

import asyncio

import structlog
from typing import Dict, Any, Optional, List
from datetime import datetime
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.rlcf.models import (
    User,
    LegalTask,
    Response,
    Feedback,
    TaskType,
    TaskStatus,
)
from merlt.rlcf.authority import (
    calculate_quality_score,
    update_track_record,
    update_authority_score,
)
from merlt.weights.store import WeightStore
from merlt.weights.learner import WeightLearner, RLCFFeedback

log = structlog.get_logger()


@dataclass
class ExpertFeedbackRecord:
    """
    Record of feedback for an expert response.

    Attributes:
        trace_id: ID della query/trace originale
        expert_type: Tipo di expert (literal, systemic, principles, precedent)
        user_rating: Rating utente 0-1 (0=scarso, 1=eccellente)
        feedback_type: Tipo di feedback (accuracy, utility, transparency)
        interpretation: Interpretazione prodotta dall'expert
        sources_cited: Numero di fonti citate
        confidence: Confidence score dell'expert
        feedback_details: Dettagli aggiuntivi del feedback
    """
    trace_id: str
    expert_type: str
    user_rating: float
    feedback_type: str = "accuracy"
    interpretation: str = ""
    sources_cited: int = 0
    confidence: float = 0.5
    feedback_details: Dict[str, Any] = field(default_factory=dict)


class RLCFOrchestrator:
    """
    Central orchestrator connecting Expert feedback to weight updates.

    Responsabilities:
    1. Persist expert feedback to RLCF database
    2. Update user authority scores via AuthorityModule
    3. Trigger weight updates via WeightLearner
    4. Provide feedback aggregation for RLCF dashboard

    Example:
        >>> from merlt.rlcf.orchestrator import RLCFOrchestrator
        >>> from merlt.rlcf.database import get_async_session
        >>> from merlt.weights.store import WeightStore
        >>> from merlt.weights.learner import WeightLearner
        >>>
        >>> async with get_async_session() as db:
        ...     store = WeightStore()
        ...     learner = WeightLearner(store)
        ...     orchestrator = RLCFOrchestrator(db, store, learner)
        ...
        ...     result = await orchestrator.record_expert_feedback(
        ...         expert_type="literal",
        ...         response=expert_response,
        ...         user_rating=0.8
        ...     )
    """

    def __init__(
        self,
        db_session: AsyncSession,
        weight_store: WeightStore,
        weight_learner: WeightLearner,
        min_authority_for_update: float = 0.3
    ):
        """
        Initialize RLCFOrchestrator.

        Args:
            db_session: Async SQLAlchemy session
            weight_store: WeightStore for weight persistence
            weight_learner: WeightLearner for gradient updates
            min_authority_for_update: Minimum authority to trigger weight updates
        """
        self.db = db_session
        self.store = weight_store
        self.learner = weight_learner
        self.min_authority = min_authority_for_update

        log.info(
            "RLCFOrchestrator initialized",
            min_authority=min_authority_for_update
        )

    async def record_expert_feedback(
        self,
        expert_type: str,
        response: Any,  # ExpertResponse from merlt.experts.base
        user_rating: float,
        feedback_type: str = "accuracy",
        user_id: Optional[int] = None,
        feedback_details: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Record feedback for an expert response and trigger weight updates.

        Flow:
        1. Create/get LegalTask for this query
        2. Create Response record
        3. Create Feedback record with user rating
        4. Update user authority if user_id provided
        5. Trigger weight update via WeightLearner

        Args:
            expert_type: Type of expert (literal, systemic, principles, precedent)
            response: ExpertResponse object from the expert
            user_rating: User rating 0-1 (0=poor, 1=excellent)
            feedback_type: Type of feedback (accuracy, utility, transparency)
            user_id: Optional user ID for authority tracking
            feedback_details: Optional additional feedback details

        Returns:
            Dict with feedback_id, authority_used, weights_updated status
        """
        trace_id = getattr(response, 'trace_id', datetime.now().strftime("%Y%m%d_%H%M%S"))
        interpretation = getattr(response, 'interpretation', '')
        confidence = getattr(response, 'confidence', 0.5)
        legal_basis = getattr(response, 'legal_basis', [])
        sources_cited = len(legal_basis) if legal_basis else 0

        log.info(
            "Recording expert feedback",
            expert_type=expert_type,
            trace_id=trace_id,
            user_rating=user_rating,
            user_id=user_id
        )

        # Step 1: Create or get LegalTask
        task = await self._get_or_create_task(trace_id, expert_type)

        # Step 2: Create Response record
        db_response = await self._create_response(
            task_id=task.id,
            expert_type=expert_type,
            interpretation=interpretation,
            confidence=confidence,
            sources_cited=sources_cited
        )

        # Step 3: Create Feedback record
        feedback = await self._create_feedback(
            response_id=db_response.id,
            user_id=user_id,
            user_rating=user_rating,
            feedback_type=feedback_type,
            expert_type=expert_type,
            confidence=confidence,
            feedback_details=feedback_details or {}
        )

        # Step 4: Update user authority if user provided
        authority = 0.5  # Default for anonymous feedback
        if user_id:
            authority = await self._update_user_authority(user_id, feedback)

        # Step 5: Trigger weight update
        weights_updated = False
        if authority >= self.min_authority:
            weights_updated = await self._trigger_weight_update(
                expert_type=expert_type,
                user_rating=user_rating,
                authority=authority,
                trace_id=trace_id
            )

        result = {
            "feedback_id": feedback.id,
            "response_id": db_response.id,
            "task_id": task.id,
            "authority_used": authority,
            "weights_updated": weights_updated,
            "expert_type": expert_type,
            "timestamp": datetime.now().isoformat()
        }

        log.info(
            "Expert feedback recorded successfully",
            **result
        )

        return result

    async def _get_or_create_task(
        self,
        trace_id: str,
        expert_type: str
    ) -> LegalTask:
        """Get existing task or create new one for this trace."""
        # Check if task exists for this trace
        result = await self.db.execute(
            select(LegalTask).where(
                LegalTask.input_data["trace_id"].astext == trace_id
            )
        )
        task = result.scalar_one_or_none()

        if task:
            return task

        # Create new task
        task = LegalTask(
            task_type=TaskType.QA.value,
            input_data={
                "trace_id": trace_id,
                "expert_type": expert_type,
                "created_by": "expert_feedback"
            },
            status=TaskStatus.OPEN.value
        )
        self.db.add(task)
        await self.db.commit()
        await self.db.refresh(task)

        log.debug(
            "Created new LegalTask",
            task_id=task.id,
            trace_id=trace_id
        )

        return task

    async def _create_response(
        self,
        task_id: int,
        expert_type: str,
        interpretation: str,
        confidence: float,
        sources_cited: int
    ) -> Response:
        """Create Response record in database."""
        response = Response(
            task_id=task_id,
            output_data={
                "expert_type": expert_type,
                "interpretation": interpretation[:1000],  # Truncate for storage
                "confidence": confidence,
                "sources_cited": sources_cited
            },
            model_version=f"expert_{expert_type}_v1"
        )
        self.db.add(response)
        await self.db.commit()
        await self.db.refresh(response)

        return response

    async def _create_feedback(
        self,
        response_id: int,
        user_id: Optional[int],
        user_rating: float,
        feedback_type: str,
        expert_type: str,
        confidence: float,
        feedback_details: Dict[str, Any]
    ) -> Feedback:
        """Create Feedback record in database."""
        # Map user_rating to the 3 score dimensions
        accuracy_score = user_rating * 5.0  # Scale to 0-5
        utility_score = user_rating * 5.0
        transparency_score = confidence * 5.0

        feedback = Feedback(
            user_id=user_id,
            response_id=response_id,
            is_blind_phase=False,
            accuracy_score=accuracy_score,
            utility_score=utility_score,
            transparency_score=transparency_score,
            feedback_data={
                "feedback_type": feedback_type,
                "expert_type": expert_type,
                "user_rating": user_rating,
                "confidence": confidence,
                **feedback_details
            }
        )
        self.db.add(feedback)
        await self.db.commit()
        await self.db.refresh(feedback)

        return feedback

    async def _update_user_authority(
        self,
        user_id: int,
        feedback: Feedback
    ) -> float:
        """Update user authority based on feedback quality."""
        try:
            # Calculate quality score for this feedback
            quality_score = await calculate_quality_score(self.db, feedback)

            # Update track record
            await update_track_record(self.db, user_id, quality_score)

            # Update overall authority
            authority = await update_authority_score(
                self.db,
                user_id,
                recent_performance=quality_score
            )

            log.debug(
                "User authority updated",
                user_id=user_id,
                quality_score=quality_score,
                new_authority=authority
            )

            return authority

        except Exception as e:
            log.warning(
                "Failed to update user authority",
                user_id=user_id,
                error=str(e)
            )
            return 0.5

    async def _trigger_weight_update(
        self,
        expert_type: str,
        user_rating: float,
        authority: float,
        trace_id: str
    ) -> bool:
        """Trigger weight update via WeightLearner."""
        try:
            # Create RLCF feedback for weight learning
            rlcf_feedback = RLCFFeedback(
                query_id=trace_id,
                user_id="system",
                authority=authority,
                relevance_scores={expert_type: user_rating},
                task_type="expert_evaluation",
                timestamp=datetime.now().isoformat()
            )

            # Update expert traversal weights
            await self.learner.update_from_feedback(
                category="expert_traversal",
                feedback=rlcf_feedback,
                experiment_id=f"expert_{expert_type}"
            )

            log.info(
                "Weight update triggered",
                expert_type=expert_type,
                authority=authority,
                rating=user_rating
            )

            return True

        except Exception as e:
            log.error(
                "Failed to trigger weight update",
                expert_type=expert_type,
                error=str(e)
            )
            return False

    async def get_expert_feedback_stats(
        self,
        expert_type: Optional[str] = None,
        days: int = 30
    ) -> Dict[str, Any]:
        """
        Get aggregated statistics for expert feedback.

        Useful for RLCF dashboard and monitoring.

        Args:
            expert_type: Filter by expert type (optional)
            days: Number of days to look back

        Returns:
            Dict with feedback statistics
        """
        from datetime import timedelta
        from sqlalchemy import func

        cutoff = datetime.now() - timedelta(days=days)

        # Base query
        query = (
            select(
                func.count(Feedback.id).label("total_feedback"),
                func.avg(Feedback.accuracy_score).label("avg_accuracy"),
                func.avg(Feedback.utility_score).label("avg_utility")
            )
            .join(Response, Response.id == Feedback.response_id)
            .where(Feedback.submitted_at >= cutoff)
        )

        if expert_type:
            query = query.where(
                Response.output_data["expert_type"].astext == expert_type
            )

        result = await self.db.execute(query)
        row = result.first()

        return {
            "period_days": days,
            "expert_type": expert_type or "all",
            "total_feedback": row.total_feedback if row else 0,
            "avg_accuracy": round(row.avg_accuracy or 0, 2),
            "avg_utility": round(row.avg_utility or 0, 2),
            "queried_at": datetime.now().isoformat()
        }



# Singleton instance for easy access
_orchestrator_instance: Optional[RLCFOrchestrator] = None
_orchestrator_lock = asyncio.Lock()


async def get_orchestrator(
    db_session: AsyncSession,
    store: Optional[WeightStore] = None,
    learner: Optional[WeightLearner] = None
) -> RLCFOrchestrator:
    """
    Get or create RLCFOrchestrator singleton (async-safe).

    Args:
        db_session: Database session
        store: Optional WeightStore (creates default if None)
        learner: Optional WeightLearner (creates default if None)

    Returns:
        RLCFOrchestrator instance
    """
    global _orchestrator_instance

    async with _orchestrator_lock:
        if _orchestrator_instance is None:
            if store is None:
                store = WeightStore()
            if learner is None:
                learner = WeightLearner(store)

            _orchestrator_instance = RLCFOrchestrator(
                db_session=db_session,
                weight_store=store,
                weight_learner=learner
            )

        return _orchestrator_instance
