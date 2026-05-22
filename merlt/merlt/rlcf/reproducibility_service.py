"""
Query Reproducibility Service
==============================

Reproduces historical queries with pinned config and diffs results.

Caveats always present:
- LLM is non-deterministic
- Knowledge graph may have changed since original query

Example:
    >>> from merlt.rlcf.reproducibility_service import ReproducibilityService
    >>> svc = ReproducibilityService()
    >>> async with get_async_session() as session:
    ...     result = await svc.reproduce_query(session, "trace_abc123")
"""

import structlog
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from merlt.experts.models import QATrace

log = structlog.get_logger()


@dataclass
class ReproducibilityResult:
    """Result of a query reproduction attempt."""
    original_trace_id: str
    reproduced_trace_id: Optional[str]
    config_used: Dict
    diff: Dict
    reproducibility_score: float
    caveats: List[str]

    def to_dict(self) -> Dict:
        return asdict(self)


class ReproducibilityService:
    """Reproduce historical queries and diff results."""

    CAVEATS = [
        "LLM responses are non-deterministic; exact reproduction is not guaranteed.",
        "The knowledge graph may have been updated since the original query.",
        "Expert routing may differ due to updated policy weights.",
    ]

    async def reproduce_query(
        self, session: AsyncSession, trace_id: str
    ) -> ReproducibilityResult:
        """
        Reproduce a query using its original configuration.

        1. Load original trace
        2. Extract config (experts, mode, routing)
        3. Re-run orchestrator with pinned config
        4. Diff results
        5. Compute reproducibility score
        """
        # 1. Load original trace
        result = await session.execute(
            select(QATrace).where(QATrace.trace_id == trace_id)
        )
        original = result.scalar_one_or_none()

        if not original:
            return ReproducibilityResult(
                original_trace_id=trace_id,
                reproduced_trace_id=None,
                config_used={},
                diff={"error": f"Trace {trace_id} not found"},
                reproducibility_score=0.0,
                caveats=self.CAVEATS,
            )

        # 2. Extract config
        config = self._extract_config(original)

        # 3. Re-run orchestrator
        try:
            from merlt.api.experts_router import get_orchestrator
            orchestrator = get_orchestrator()

            reproduced_result = await orchestrator.process(
                query=original.query,
                metadata={
                    "reproduce_from": trace_id,
                    "pinned_experts": config.get("selected_experts"),
                },
            )

            # 4. Build reproduced trace (not persisted — reproduction is ephemeral)
            from uuid import uuid4
            new_trace_id = f"repro_{uuid4().hex[:12]}"

            new_trace = QATrace(
                trace_id=new_trace_id,
                user_id=original.user_id,
                query=original.query,
                selected_experts=list(reproduced_result.expert_contributions.keys()),
                synthesis_mode=reproduced_result.mode.value,
                synthesis_text=reproduced_result.synthesis,
                confidence=reproduced_result.confidence,
                consent_level=original.consent_level,
                query_type=original.query_type,
            )

            # 5. Compute diff
            diff = self._compute_diff(original, new_trace, reproduced_result)
            score = self._compute_reproducibility_score(diff)

            return ReproducibilityResult(
                original_trace_id=trace_id,
                reproduced_trace_id=new_trace_id,
                config_used=config,
                diff=diff,
                reproducibility_score=score,
                caveats=self.CAVEATS,
            )

        except Exception as e:
            log.warning("Reproduce query failed", error=str(e), trace_id=trace_id)
            return ReproducibilityResult(
                original_trace_id=trace_id,
                reproduced_trace_id=None,
                config_used=config,
                diff={"error": str(e)},
                reproducibility_score=0.0,
                caveats=self.CAVEATS,
            )

    def _extract_config(self, trace: QATrace) -> Dict:
        """Extract reproducibility-relevant config from a trace."""
        config = {
            "selected_experts": trace.selected_experts or [],
            "synthesis_mode": trace.synthesis_mode,
            "routing_method": trace.routing_method,
            "query_type": trace.query_type,
            "confidence": trace.confidence,
        }

        # Extract model versions from full_trace if available
        if trace.full_trace:
            config["model_versions"] = trace.full_trace.get("model_versions", {})
            routing = trace.full_trace.get("routing", {})
            config["gating_weights"] = routing.get("gating_weights", {})

        return config

    def _compute_diff(self, original: QATrace, reproduced: QATrace, result) -> Dict:
        """Compute diff between original and reproduced traces."""
        orig_experts = set(original.selected_experts or [])
        repro_experts = set(reproduced.selected_experts or [])

        # Expert overlap (Jaccard)
        if orig_experts or repro_experts:
            expert_overlap = len(orig_experts & repro_experts) / len(orig_experts | repro_experts)
        else:
            expert_overlap = 1.0

        # Confidence delta
        orig_conf = original.confidence or 0.0
        repro_conf = reproduced.confidence or 0.0
        confidence_delta = abs(orig_conf - repro_conf)

        # Source Jaccard similarity
        orig_sources = set()
        if original.sources:
            for s in original.sources:
                urn = s.get("article_urn") or s.get("source_id", "")
                if urn:
                    orig_sources.add(urn)

        repro_sources = set()
        if result and hasattr(result, "combined_legal_basis"):
            for s in result.combined_legal_basis:
                if hasattr(s, "source_id") and s.source_id:
                    repro_sources.add(s.source_id)

        if orig_sources or repro_sources:
            source_jaccard = len(orig_sources & repro_sources) / len(orig_sources | repro_sources)
        else:
            source_jaccard = 1.0

        # Mode match
        mode_match = original.synthesis_mode == reproduced.synthesis_mode

        return {
            "expert_overlap": round(expert_overlap, 4),
            "confidence_delta": round(confidence_delta, 4),
            "source_jaccard": round(source_jaccard, 4),
            "mode_match": mode_match,
            "original_experts": sorted(orig_experts),
            "reproduced_experts": sorted(repro_experts),
            "original_confidence": orig_conf,
            "reproduced_confidence": repro_conf,
        }

    def _compute_reproducibility_score(self, diff: Dict) -> float:
        """
        Weighted average of diff metrics.

        Score = mean(expert_overlap, 1 - confidence_delta, source_jaccard)
        """
        if "error" in diff:
            return 0.0

        expert_overlap = diff.get("expert_overlap", 0.0)
        confidence_sim = 1.0 - diff.get("confidence_delta", 1.0)
        source_jaccard = diff.get("source_jaccard", 0.0)

        score = (expert_overlap + confidence_sim + source_jaccard) / 3.0
        return round(max(0.0, min(1.0, score)), 4)
