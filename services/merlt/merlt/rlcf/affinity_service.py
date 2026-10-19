"""
Expert Affinity Update Service (F8c)
======================================

Updates expert_affinity in the bridge table based on source feedback.

The bridge table learns which chunks are good for which expert through
user feedback on source relevance. This enables personalized retrieval
where the system knows that certain chunks work better for specific
interpretive approaches.

Update formula: new_aff = old_aff + lr * (target - old_aff), bounded [0.1, 0.95]

Example:
    >>> from merlt.rlcf.affinity_service import AffinityUpdateService
    >>> svc = AffinityUpdateService()
    >>> await svc.update_from_source_feedback(session, trace, feedback)
"""

import structlog
from typing import Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from merlt.experts.models import QATrace, QAFeedback

log = structlog.get_logger()

EXPERT_TYPES = ["literal", "systemic", "principles", "precedent"]


class AffinityUpdateService:
    """Updates expert_affinity in bridge table based on feedback F8."""

    LEARNING_RATE = 0.1
    MIN_AFFINITY = 0.1
    MAX_AFFINITY = 0.95
    DEFAULT_AFFINITY = 0.5
    # Explicit feedback weighs 3x implicit.
    # Effective lr for explicit updates = LEARNING_RATE * EXPLICIT_WEIGHT = 0.3
    # Implicit updates use LEARNING_RATE directly (0.1)
    EXPLICIT_WEIGHT = 3.0

    def _clamp(self, value: float) -> float:
        """Clamp affinity to [MIN, MAX] bounds."""
        return max(self.MIN_AFFINITY, min(self.MAX_AFFINITY, value))

    def _default_affinity(self) -> Dict[str, float]:
        """Return default affinity dict for all experts."""
        return {e: self.DEFAULT_AFFINITY for e in EXPERT_TYPES}

    async def update_from_source_feedback(
        self,
        session: AsyncSession,
        trace: QATrace,
        feedback: QAFeedback,
    ) -> Optional[Dict[str, float]]:
        """
        Update affinity when a user rates a source.

        1. Find chunk in bridge table via source_id (URN)
        2. Identify which experts used this source (from trace.full_trace)
        3. Update affinity: new = old + lr * (target - old)
           - target = (source_relevance - 1) / 4 (normalized 0-1)
        4. Bound [0.1, 0.95]
        """
        source_urn = feedback.source_id
        if not source_urn or feedback.source_relevance is None:
            return None

        target = (feedback.source_relevance - 1) / 4  # 1→0, 5→1

        # Find which experts used this source from the trace
        experts_using_source = self._find_experts_for_source(
            trace.full_trace, source_urn
        )
        if not experts_using_source:
            # Fallback: attribute to all selected experts
            experts_using_source = trace.selected_experts or []

        # Update bridge table entry
        try:
            from merlt.storage.bridge.models import BridgeTableEntry
            result = await session.execute(
                select(BridgeTableEntry).where(
                    BridgeTableEntry.graph_node_urn == source_urn
                )
            )
            entries = result.scalars().all()

            updated_affinity = None
            for entry in entries:
                current = entry.expert_affinity or self._default_affinity()
                new_affinity = dict(current)

                for expert in experts_using_source:
                    if expert in new_affinity:
                        old = new_affinity[expert]
                        lr = self.LEARNING_RATE * self.EXPLICIT_WEIGHT
                        new_affinity[expert] = self._clamp(
                            old + lr * (target - old)
                        )

                entry.expert_affinity = new_affinity
                updated_affinity = new_affinity

            if entries:
                # flush() not commit() — we don't own this session,
                # let the caller's commit handle final persistence
                await session.flush()

            log.debug(
                "Source affinity updated",
                source_urn=source_urn[:50],
                experts=experts_using_source,
                target=round(target, 3),
                entries_updated=len(entries),
            )
            return updated_affinity

        except Exception as e:
            log.warning("Bridge table affinity update failed", error=str(e))
            return None

    async def update_implicit_from_expert_feedback(
        self,
        session: AsyncSession,
        trace: QATrace,
        feedback: QAFeedback,
        expert_id: str,
    ) -> None:
        """
        F8 implicit: if an expert receives a positive rating,
        its sources gain affinity.
        """
        if not trace.sources:
            return

        # Compute implicit target from feedback
        if feedback.inline_rating is not None:
            target = (feedback.inline_rating - 1) / 4
        elif feedback.retrieval_score is not None:
            target = feedback.retrieval_score
        else:
            return

        # Only update if feedback is meaningful (not neutral)
        if abs(target - 0.5) < 0.1:
            return

        try:
            from merlt.storage.bridge.models import BridgeTableEntry

            for source_data in trace.sources:
                source_urn = source_data.get("article_urn") or source_data.get("source_id")
                if not source_urn:
                    continue

                result = await session.execute(
                    select(BridgeTableEntry).where(
                        BridgeTableEntry.graph_node_urn == source_urn
                    )
                )
                entries = result.scalars().all()

                for entry in entries:
                    current = entry.expert_affinity or self._default_affinity()
                    new_affinity = dict(current)

                    if expert_id in new_affinity:
                        old = new_affinity[expert_id]
                        # Implicit uses base learning rate (not multiplied)
                        new_affinity[expert_id] = self._clamp(
                            old + self.LEARNING_RATE * (target - old)
                        )

                    entry.expert_affinity = new_affinity

            # flush() not commit() — we don't own this session
            await session.flush()

        except Exception as e:
            log.warning("Implicit affinity update failed", error=str(e))

    async def get_affinity_stats(
        self, session: AsyncSession, node_urn: str
    ) -> Dict[str, float]:
        """Return current affinity for a node."""
        try:
            from merlt.storage.bridge.models import BridgeTableEntry
            result = await session.execute(
                select(BridgeTableEntry).where(
                    BridgeTableEntry.graph_node_urn == node_urn
                ).limit(1)
            )
            entry = result.scalar_one_or_none()
            if entry and entry.expert_affinity:
                return entry.expert_affinity
        except Exception as e:
            log.warning("Get affinity stats failed", error=str(e))

        return self._default_affinity()

    @staticmethod
    def _find_experts_for_source(
        full_trace: Optional[Dict], source_urn: str
    ) -> List[str]:
        """Extract which experts used a specific source from the pipeline trace."""
        if not full_trace:
            return []

        experts = []
        expert_results = full_trace.get("expert_results", {})
        for expert_name, expert_data in expert_results.items():
            if not isinstance(expert_data, dict):
                continue
            # Check sources in expert's results
            expert_sources = expert_data.get("sources", [])
            for src in expert_sources:
                src_id = src.get("source_id") or src.get("article_urn") or src.get("urn", "")
                if src_id == source_urn:
                    experts.append(expert_name)
                    break

        return experts
