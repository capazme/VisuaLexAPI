"""
Replay-buffer rehydration
=========================

The RLCF replay buffer lives in process memory and is persisted to a JSON file
(``TrainingScheduler``, path from ``MERLT_RLCF_BUFFER_PATH``). When that file is
missing or unreadable, for example on a fresh volume, the buffer starts empty
even though every feedback event is durable in Postgres
(``qa_feedback JOIN qa_traces``). ``rehydrate_buffer`` rebuilds it from those
rows at boot. It never starts training.

This module also owns ``build_experience``, the single mapping from a
``(QATrace, QAFeedback)`` pair to a replay experience (reward, trace,
``MultilevelFeedback``, metadata). ``experts_router._wire_feedback_to_training``
uses it for live feedback and the rehydrator uses it for persisted rows, so a
restart can never change the training signal.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, NamedTuple, Optional, Tuple

import structlog

from merlt.rlcf.multilevel_feedback import (
    MultilevelFeedback,
    ReasoningFeedback,
    RetrievalFeedback,
    SynthesisFeedback,
    create_feedback_from_user_rating,
)
from merlt.rlcf.policy_gradient import (
    RELATION_FEEDBACK_SOURCE_PREFIX,
    preferred_relation_from_source_id,
)

log = structlog.get_logger()

FEEDBACK_TYPES = ("inline", "detailed", "source", "preference", "refine", "router", "relation")

# Moderated feedback never reaches the buffer (Story 9-5).
EXCLUDED_FEEDBACK_STATUSES = ("quarantined", "flagged", "deleted")

# The router channel stores its rating in inline_rating and tags the comment.
ROUTER_COMMENT_PREFIX = "[router]"

# Rows fetched per query while rehydrating: each trace carries query embeddings,
# so the rows are read in pages rather than in one result set.
REHYDRATION_PAGE_SIZE = 200


class ExperienceInput(NamedTuple):
    """What ``TrainingScheduler.add_experience`` takes for one feedback event."""

    trace_data: Dict[str, Any]
    feedback: MultilevelFeedback
    reward: float
    metadata: Dict[str, Any]


@dataclass
class RehydrationResult:
    """Outcome of a rehydration run."""

    added: int = 0
    rows_seen: int = 0
    skipped_no_execution_trace: int = 0
    skipped_unknown_type: int = 0
    skipped_status: int = 0
    skipped_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "added": self.added,
            "rows_seen": self.rows_seen,
            "skipped_no_execution_trace": self.skipped_no_execution_trace,
            "skipped_unknown_type": self.skipped_unknown_type,
            "skipped_status": self.skipped_status,
            "skipped_reason": self.skipped_reason,
        }


# =============================================================================
# SHARED EXPERIENCE BUILDING (live wiring + rehydration)
# =============================================================================

def feedback_reward(feedback: Any, feedback_type: str) -> float:
    """Scalar reward for one feedback event (blueprint Parte 2, reward per channel)."""
    if feedback_type == "inline":
        return (feedback.inline_rating - 1) / 4  # 1→0, 5→1
    if feedback_type == "detailed":
        return (
            0.3 * feedback.retrieval_score
            + 0.4 * feedback.reasoning_score
            + 0.3 * feedback.synthesis_score
        )
    if feedback_type == "source":
        return (feedback.source_relevance - 1) / 4  # 1→0, 5→1
    if feedback_type == "preference":
        # Positive return above the neutral baseline: "I prefer this canon"
        # is an endorsement, not a neutral event. The DIRECTIONAL signal
        # (which canon) rides in metadata and is what actually shifts the
        # gating weights via per-expert shaping.
        return 0.7
    if feedback_type == "relation":
        # Slice 4 L3: "privilegia questa relazione" is a positive endorsement,
        # mirror of the preference channel (0.7). The DIRECTIONAL signal
        # (which relation) rides in metadata['preferred_relation'] and is
        # what shapes the traversal head (advantage = authority·(r + β)).
        return 0.7
    if feedback_type == "refine":
        return 0.3
    if feedback_type == "router":
        return 1.0 if feedback.inline_rating and feedback.inline_rating >= 4 else 0.0
    return 0.5


def execution_trace_of(trace: Any) -> Dict[str, Any]:
    """The RLCF ExecutionTrace stored with a QATrace (Loop β Bug-4 0.3).

    ``full_trace`` nests the execution_trace (query_id + Actions carrying
    query_embedding/log_prob) under 'execution_trace'. Older rows stored only
    the flat pipeline trace (no actions): fall back to it so legacy feedback
    still no-ops gracefully instead of erroring.
    """
    stored = trace.full_trace if trace.full_trace else {}
    return stored.get("execution_trace") or stored


def build_experience(
    trace: Any,
    feedback: Any,
    feedback_type: str,
    authority: Optional[float] = None,
) -> ExperienceInput:
    """
    Build the replay experience for one feedback event.

    Slice 4 P2b (L2), teach-the-weights:
    - ``preference`` gets a genuinely POSITIVE reward (0.7) and carries the
      chosen canon in ``metadata['preferred_expert']``; the gating trainer turns
      it into a per-expert shaping term (``policy_gradient._preferred_expert_index``).
    - ``authority`` authority-weights the update on the live heads. The explicit
      argument wins, else the value stored on the feedback row; ``None`` means
      downstream defaults to 1.0 (authority-neutral).
    """
    reward = feedback_reward(feedback, feedback_type)
    trace_data = execution_trace_of(trace)

    if feedback_type == "detailed":
        ml_feedback = MultilevelFeedback(
            query_id=trace.trace_id,
            retrieval_feedback=RetrievalFeedback(
                precision=feedback.retrieval_score,
                ranking_quality=feedback.retrieval_score,
            ),
            reasoning_feedback=ReasoningFeedback(
                logical_coherence=feedback.reasoning_score,
                legal_soundness=feedback.reasoning_score,
            ),
            synthesis_feedback=SynthesisFeedback(
                clarity=feedback.synthesis_score,
                usefulness=feedback.synthesis_score,
                user_satisfaction=feedback.synthesis_score,
            ),
            overall_rating=reward,
            user_id=feedback.user_id,
        )
    else:
        ml_feedback = create_feedback_from_user_rating(
            query_id=trace.trace_id,
            user_rating=reward,
            user_id=feedback.user_id,
        )

    # These keys round-trip through the replay buffer
    # (MultilevelFeedback.to_dict/from_dict) and are read by the gating/tool
    # trainers (policy_gradient._extract_authority / _preferred_expert_index).
    preferred_expert = getattr(feedback, "preferred_expert", None)
    if preferred_expert:
        ml_feedback.metadata["preferred_expert"] = preferred_expert
    # Slice 4 L3: relation-preference rows encode the relation in source_id
    # ("relation:<TYPE>", no schema change).
    preferred_relation = preferred_relation_from_source_id(getattr(feedback, "source_id", None))
    if preferred_relation:
        ml_feedback.metadata["preferred_relation"] = preferred_relation
    eff_authority = authority if authority is not None else getattr(feedback, "user_authority", None)
    if eff_authority is not None:
        ml_feedback.metadata["authority"] = eff_authority

    metadata = {
        "feedback_type": feedback_type,
        "feedback_id": feedback.id,
        "trace_id": trace.trace_id,
    }
    return ExperienceInput(trace_data, ml_feedback, reward, metadata)


def infer_feedback_type(feedback: Any) -> Optional[str]:
    """Which feedback channel wrote a QAFeedback row, from the columns it set.

    Mirrors the writers in experts_router: relation rows carry
    ``source_id='relation:<TYPE>'``, preference rows ``preferred_expert``,
    refine rows ``follow_up_query``/``refined_trace_id``, detailed rows the three
    scores, source rows ``source_relevance``, and router rows an
    ``inline_rating`` with a comment starting ``[router]``. None when the row
    matches no channel.
    """
    source_id = getattr(feedback, "source_id", None) or ""
    if source_id.startswith(RELATION_FEEDBACK_SOURCE_PREFIX):
        return "relation"
    if getattr(feedback, "preferred_expert", None):
        return "preference"
    if getattr(feedback, "follow_up_query", None) or getattr(feedback, "refined_trace_id", None):
        return "refine"
    if all(
        getattr(feedback, name, None) is not None
        for name in ("retrieval_score", "reasoning_score", "synthesis_score")
    ):
        return "detailed"
    if getattr(feedback, "source_relevance", None) is not None:
        return "source"
    if getattr(feedback, "inline_rating", None) is not None:
        comment = getattr(feedback, "detailed_comment", None) or ""
        return "router" if comment.startswith(ROUTER_COMMENT_PREFIX) else "inline"
    return None


# =============================================================================
# REHYDRATION
# =============================================================================

def rehydrate_from_rows(scheduler: Any, rows: Iterable[Tuple[Any, Any]]) -> RehydrationResult:
    """
    Push persisted ``(QAFeedback, QATrace)`` rows into the scheduler's buffer.

    Rows should come oldest first, the order in which live feedback would have
    arrived. Rows are skipped when the feedback is moderated, when the trace
    has no stored execution_trace (older traces, whose replay would only no-op
    in training), or when no channel can be inferred. The scheduler
    de-duplicates on ``feedback_id`` and saves the buffer once.
    """
    result = RehydrationResult()
    experiences: List[ExperienceInput] = []
    for feedback, trace in rows:
        result.rows_seen += 1
        if getattr(feedback, "status", None) in EXCLUDED_FEEDBACK_STATUSES:
            result.skipped_status += 1
            continue
        if not isinstance((trace.full_trace or {}).get("execution_trace"), dict):
            result.skipped_no_execution_trace += 1
            continue
        feedback_type = infer_feedback_type(feedback)
        if feedback_type is None:
            result.skipped_unknown_type += 1
            continue
        experiences.append(build_experience(trace, feedback, feedback_type))
    result.added = scheduler.add_experiences_bulk(experiences)
    return result


def build_rehydration_query(page_size: int, before_id: Optional[int] = None):
    """Most recent eligible feedback rows first, one page, keyset-paginated on
    the autoincrement ``QAFeedback.id`` (insertion order)."""
    from sqlalchemy import select

    from merlt.experts.models import QAFeedback, QATrace

    stmt = (
        select(QAFeedback, QATrace)
        .join(QATrace, QAFeedback.trace_id == QATrace.trace_id)
        .where(
            QAFeedback.status.notin_(EXCLUDED_FEEDBACK_STATUSES),
            QATrace.full_trace.has_key("execution_trace"),
        )
        .order_by(QAFeedback.id.desc())
        .limit(page_size)
    )
    if before_id is not None:
        stmt = stmt.where(QAFeedback.id < before_id)
    return stmt


async def load_recent_rows(session: Any, limit: int) -> List[Tuple[Any, Any]]:
    """Up to ``limit`` most recent eligible ``(QAFeedback, QATrace)`` rows, oldest first."""
    rows: List[Tuple[Any, Any]] = []
    before_id: Optional[int] = None
    while len(rows) < limit:
        page_size = min(REHYDRATION_PAGE_SIZE, limit - len(rows))
        page = (await session.execute(build_rehydration_query(page_size, before_id))).all()
        rows.extend((feedback, trace) for feedback, trace in page)
        if len(page) < page_size:
            break
        before_id = page[-1][0].id
    rows.reverse()
    return rows


async def rehydrate_buffer(
    scheduler: Any = None,
    session: Any = None,
    limit: Optional[int] = None,
) -> RehydrationResult:
    """
    Rebuild the replay buffer from persisted feedback when it is empty.

    Runs only when the buffer holds no experience after the file load, so the
    same feedback is never counted twice. Bounded to ``max_buffer_size`` rows.
    Uses ``session`` when given, else opens an RLCF database session.
    """
    if scheduler is None:
        from merlt.rlcf.training_scheduler import get_scheduler

        scheduler = get_scheduler()

    if len(scheduler.buffer) > 0:
        log.info("Replay buffer loaded from file, rehydration skipped", buffer_size=len(scheduler.buffer))
        return RehydrationResult(skipped_reason="buffer_not_empty")

    limit = limit or scheduler.config.max_buffer_size
    if session is None:
        from merlt.rlcf.database import get_async_session

        async with get_async_session() as own_session:
            rows = await load_recent_rows(own_session, limit)
    else:
        rows = await load_recent_rows(session, limit)

    result = rehydrate_from_rows(scheduler, rows)
    log.info("Replay buffer rehydrated from persisted feedback", **result.to_dict())
    return result
