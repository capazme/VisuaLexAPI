"""
Expert System Q&A Router
=========================

FastAPI router for Expert System Q&A with multi-level feedback.

Endpoints:
- POST /experts/query: Submit query to MultiExpertOrchestrator
- POST /experts/feedback/inline: Quick thumbs up/down
- POST /experts/feedback/detailed: 3-dimension feedback form
- POST /experts/feedback/source: Per-source rating
- POST /experts/feedback/refine: Conversational follow-up

Usage:
    from merlt.api.experts_router import router as experts_router
    app.include_router(experts_router)
"""

import json
import structlog
import time
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from merlt.experts.orchestrator import MultiExpertOrchestrator
from merlt.experts.synthesizer import SynthesisMode
from merlt.experts.models import QATrace, QAFeedback, ApiKey
from merlt.api.auth import verify_api_key
from merlt.api.rate_limit import check_rate_limit
from merlt.rlcf.database import get_async_session_dep
from merlt.rlcf.training_scheduler import get_scheduler
from merlt.rlcf.pii_service import PIIMaskingService
from merlt.rlcf.audit_service import AuditService
from merlt.rlcf.multilevel_feedback import (
    MultilevelFeedback,
    RetrievalFeedback,
    ReasoningFeedback,
    SynthesisFeedback,
    create_feedback_from_user_rating,
)
from merlt.rlcf.authority import update_track_record, update_authority_score
from merlt.rlcf.database import get_async_session
from merlt.rlcf import models as rlcf_models
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

log = structlog.get_logger()

router = APIRouter(prefix="/experts", tags=["experts"])


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class ExpertQueryRequest(BaseModel):
    """Request for Expert Q&A query."""
    query: str = Field(..., min_length=5, description="Legal query in natural language")
    user_id: str = Field(..., description="User ID for tracking and authority")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context (entities, article_urn, etc.)")
    max_experts: Optional[int] = Field(4, ge=1, le=4, description="Max number of experts to invoke")
    include_trace: bool = Field(False, description="Include full pipeline trace in response")
    consent_level: Literal["anonymous", "basic", "full"] = Field(
        "basic",
        description="Storage consent level: anonymous (redact query+user_id), basic (redact query), full (no redaction)"
    )


class SourceReference(BaseModel):
    """Legal source reference in response."""
    article_urn: str
    expert: str
    relevance: float = Field(..., ge=0.0, le=1.0)
    excerpt: Optional[str] = None
    # Loop β M6: surface per-source provenance (e.g. 'seed',
    # 'community_validated', 'live_unconfirmed') and the FalkorDB trust score
    # so the FE can flag provisional sources. Both optional/additive — null
    # when the underlying LegalSource carries no provenance signal.
    provenance: Optional[str] = None
    trust: Optional[float] = Field(None, ge=0.0, le=1.0)
    # Loop β F.0 (Option A): the LLM-cited source carries a readable formal
    # citation (e.g. "Art. 1453 c.c.") even when source_id is an opaque chunk id.
    citation: Optional[str] = None


class RetrievedSource(BaseModel):
    """
    A source the engine actually consulted during retrieval, carrying REAL
    FalkorDB provenance (Loop β F.0 Option A).

    Distinct from `SourceReference` (the LLM-cited basis, whose ids are LLM
    output and lose provenance): these come from the retrieval trace's
    `top_sources` and are enriched against the live graph. `node_id` is set
    when the node is provisional (`provenance == 'live_unconfirmed'`) so the
    UI can offer "remember in the graph" (confirm-source) on it.
    """
    urn: str
    provenance: Optional[str] = None
    trust: Optional[float] = Field(None, ge=0.0, le=1.0)
    node_id: Optional[str] = None
    # Loop β #3: for provisional (live) nodes the URN is an opaque `live:<hash>`;
    # the underlying Normattiva URL (when known) gives the UI a readable label
    # and a navigable /grafo target.
    source_url: Optional[str] = None


# ----------------------------------------------------------------------------
# Slice 4 P2a ("il dibattito visibile"): surface the deliberation that the
# synthesizer/orchestrator already compute but drop at the DTO (Decision D).
# All three models are ADDITIVE + nullable/empty — existing consumers unaffected.
# No new computation: every value is copied from `SynthesisResult` /
# `pipeline_trace` (see `_build_disagreement_analysis` /
# `_build_expert_contributions`). Embeddings are never touched here (the
# execution_trace embedding lives in a separate, stripped path).
# ----------------------------------------------------------------------------

class DisagreementConflict(BaseModel):
    """A single pairwise conflict between two canons (Slice 4 P2a).

    Copied verbatim from `ExpertPairConflict.to_dict()`
    (disagreement/types.py:212-221). `excerpt_a`/`excerpt_b` are excerpts from
    the experts' own responses (their legal reasoning), never the user query.
    """
    expert_a: str
    expert_b: str
    conflict_score: float
    contention_point: Optional[str] = None
    excerpt_a: Optional[str] = None
    excerpt_b: Optional[str] = None


class DisagreementAnalysisDTO(BaseModel):
    """The synthesis-stage disagreement (Slice 4 P2a, Decision D).

    Copied from `DisagreementAnalysis.to_dict()` (disagreement/types.py:249-260)
    as produced at synthesizer.py:313 / orchestrator.py:915-916. Nullable on the
    response: `null` when the collegio converges with no detected conflict.
    """
    has_disagreement: bool
    disagreement_type: Optional[str] = None
    disagreement_level: Optional[str] = None
    intensity: float = Field(0.0, description="Disagreement intensity [0-1]")
    resolvability: float = Field(
        0.5, description="P(resolvable via art. 12 preleggi ordering) [0-1]"
    )
    confidence: float = Field(0.0, description="Detector confidence [0-1]")
    conflicts: List[DisagreementConflict] = Field(
        default_factory=list,
        description="Pairwise canon conflicts (contrasti); empty when convergent.",
    )
    pairwise_matrix: Optional[List[List[float]]] = Field(
        None, description="Full expert×expert conflict matrix, when available."
    )


class DevilsAdvocateFlag(BaseModel):
    """Whether a deliberate devil's-advocate dissent was raised (Slice 4 P2a).

    `active` copies `SynthesisResult.devils_advocate_flag` (synthesizer.py:345).
    `expert` is the canon that played it WHEN the engine records it; today the
    synthesizer derives the flag from `has_disagreement` and does NOT attribute a
    canon, so `expert` stays null (no recompute — L2 attribution is deferred).
    """
    active: bool = False
    expert: Optional[str] = Field(
        None,
        description="Canon that played devil's advocate, when recorded; else null.",
    )


class ExpertContribution(BaseModel):
    """One canon's full thesis in the deliberation (Slice 4 P2a).

    Copied from `SynthesisResult.expert_contributions` (synthesizer.py:624-631
    convergent / 680-703 divergent), whose `weight` is the routing/gating weight
    (`weights_dict` at orchestrator.py:885, threaded into the synthesizer at :900).
    `thesis` is the FULL `interpretation` text, NOT the 300-char preview used in
    the pipeline trace.
    """
    expert: str = Field(
        ..., description="Canon: 'literal' | 'systemic' | 'principles' | 'precedent'"
    )
    thesis: str = Field(..., description="Full interpretation text (not a preview).")
    confidence: float = Field(..., description="Expert self-confidence [0-1].")
    weight: float = Field(..., description="Routing/gating weight [0-1].")


class ExpertQueryResponse(BaseModel):
    """Response from Expert Q&A system."""
    trace_id: str = Field(..., description="Unique trace ID for feedback")
    synthesis: str = Field(..., description="Final synthesis text")
    mode: str = Field(..., description="convergent or divergent")
    alternatives: Optional[List[Dict[str, Any]]] = Field(None, description="Alternative interpretations (divergent mode)")
    sources: List[SourceReference] = Field(default_factory=list, description="Legal sources cited")
    experts_used: List[str] = Field(default_factory=list, description="Experts that analyzed the query")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score")
    execution_time_ms: int = Field(..., description="Execution time in milliseconds")
    pipeline_trace: Optional[Dict[str, Any]] = Field(None, description="Full pipeline trace (when include_trace=True)")
    pipeline_metrics: Optional[Dict[str, Any]] = Field(None, description="Pipeline metrics (when include_trace=True)")
    retrieved_sources: List[RetrievedSource] = Field(
        default_factory=list,
        description="Sources the engine consulted, with real FalkorDB provenance/trust/node_id (Loop β F.0).",
    )
    # Slice 4 P2a ("il dibattito visibile", Decision D): surface the debate the
    # engine already computes. All three are additive + backward-compatible.
    disagreement_analysis: Optional[DisagreementAnalysisDTO] = Field(
        None,
        description=(
            "Synthesis-stage disagreement (intensity, resolvability, pairwise "
            "conflicts, matrix). null when the collegio converges without conflict."
        ),
    )
    devils_advocate_flag: Optional[DevilsAdvocateFlag] = Field(
        None,
        description=(
            "Whether a deliberate devil's-advocate dissent was raised (+ which "
            "canon, when recorded). null when no dissent was analysed."
        ),
    )
    expert_contributions: List[ExpertContribution] = Field(
        default_factory=list,
        description=(
            "Per-canon full theses with confidence + routing weight. Empty when "
            "the engine produced no per-expert contributions."
        ),
    )


def _build_disagreement_analysis(result: Any) -> Optional[DisagreementAnalysisDTO]:
    """Copy `SynthesisResult.disagreement_analysis` onto the DTO (Slice 4 P2a).

    Returns null when the synthesizer detected no disagreement object
    (convergent, no conflict). No recomputation — reads what
    synthesizer.py:313 already attached to `result`.
    """
    analysis = getattr(result, "disagreement_analysis", None)
    if analysis is None:
        return None
    data = analysis.to_dict()  # disagreement/types.py:249-260
    return DisagreementAnalysisDTO(
        has_disagreement=data.get("has_disagreement", False),
        disagreement_type=data.get("disagreement_type"),
        disagreement_level=data.get("disagreement_level"),
        intensity=data.get("intensity", 0.0),
        resolvability=data.get("resolvability", 0.5),
        confidence=data.get("confidence", 0.0),
        conflicts=[
            DisagreementConflict(**pair)
            for pair in data.get("conflicting_pairs", [])
        ],
        pairwise_matrix=data.get("pairwise_matrix"),
    )


def _build_devils_advocate_flag(result: Any) -> Optional[DevilsAdvocateFlag]:
    """Copy `SynthesisResult.devils_advocate_flag` onto the DTO (Slice 4 P2a).

    The synthesizer derives the bool from `has_disagreement` (synthesizer.py:345)
    and does NOT record which canon played it — `expert` stays null (no recompute).
    Returns null only when the attribute is entirely absent (defensive).
    """
    if not hasattr(result, "devils_advocate_flag"):
        return None
    return DevilsAdvocateFlag(
        active=bool(getattr(result, "devils_advocate_flag", False)),
        expert=None,
    )


# Canonical canon keys — the synthesizer keys `expert_contributions` by these.
_CANON_KEYS = ("literal", "systemic", "principles", "precedent")


def _build_expert_contributions(result: Any) -> List[ExpertContribution]:
    """Copy `SynthesisResult.expert_contributions` onto the DTO (Slice 4 P2a).

    Each entry carries the FULL `interpretation` thesis (not the 300-char trace
    preview) and the routing/gating `weight` threaded from orchestrator.py:885.
    Iterates the canonical canon order first, then any extra keys, so the FE gets
    a stable ordering. No recomputation — reads synthesizer.py:624-631/680-703.
    """
    raw = getattr(result, "expert_contributions", None) or {}
    if not isinstance(raw, dict):
        return []
    ordered_keys = [k for k in _CANON_KEYS if k in raw]
    ordered_keys += [k for k in raw if k not in _CANON_KEYS]
    contributions: List[ExpertContribution] = []
    for key in ordered_keys:
        entry = raw.get(key) or {}
        contributions.append(
            ExpertContribution(
                expert=key,
                thesis=str(entry.get("interpretation", "") or ""),
                confidence=float(entry.get("confidence", 0.0) or 0.0),
                weight=float(entry.get("weight", 0.0) or 0.0),
            )
        )
    return contributions


def _to_source_reference(legal_source: Any) -> SourceReference:
    """
    Map a `LegalSource` (experts/base.py) onto the API `SourceReference`,
    surfacing real relevance + provenance instead of hardcoded constants (M6).

    Field access is defensive (`getattr` with fallbacks) because:
      * the historical `LegalSource` dataclass exposes `source_id` / `excerpt`
        / `relevance_score`, while some result paths historically referenced
        `urn` / `text_excerpt` / `expert_type` — `getattr` tolerates both
        without an AttributeError on either path;
      * `provenance` / `expert` are NOT yet first-class fields on the
        `LegalSource` dataclass (it lives in experts/base.py, a CRITICAL
        interface this task is not permitted to change). We read them
        opportunistically: if a future/sibling change threads provenance onto
        LegalSource — the A.3 chunk dicts already carry a `provenance` key
        ('live_unconfirmed' for live sources) — it will surface automatically;
        until then provenance stays None and `expert` falls back to
        'combined'. See the limitation note in the deliverable.
    """
    # --- article URN ---------------------------------------------------------
    article_urn = (
        getattr(legal_source, "source_id", None)
        or getattr(legal_source, "urn", None)
        or ""
    )

    # --- contributing expert -------------------------------------------------
    # KNOWN LIMITATION (M6.3): the combined LegalSource does not reliably track
    # which expert produced it; default to 'combined' unless the source carries
    # an explicit `expert_type`.
    expert = getattr(legal_source, "expert_type", None) or "combined"

    # --- relevance -----------------------------------------------------------
    # M6.3: prefer the LegalSource's real normalized score over the old
    # hardcoded 0.9. `LegalSource.relevance` is a free-text rationale (str),
    # NOT a number — only `relevance_score` is numeric — so we read that.
    relevance = getattr(legal_source, "relevance_score", None)
    if not isinstance(relevance, (int, float)):
        # Some paths expose a numeric `relevance`; accept it only if numeric.
        candidate = getattr(legal_source, "relevance", None)
        relevance = candidate if isinstance(candidate, (int, float)) else 0.9
    relevance = max(0.0, min(1.0, float(relevance)))

    # --- excerpt -------------------------------------------------------------
    excerpt_raw = (
        getattr(legal_source, "excerpt", None)
        or getattr(legal_source, "text_excerpt", None)
    )
    excerpt = excerpt_raw[:200] if excerpt_raw else None

    # --- provenance / trust (M6.2) ------------------------------------------
    provenance = getattr(legal_source, "provenance", None)
    trust = getattr(legal_source, "trust", None)
    if not isinstance(trust, (int, float)):
        trust = None
    else:
        trust = max(0.0, min(1.0, float(trust)))

    # --- readable citation (F.0 Option A) -----------------------------------
    citation = getattr(legal_source, "citation", None) or None

    return SourceReference(
        article_urn=article_urn,
        expert=expert,
        relevance=relevance,
        excerpt=excerpt,
        provenance=provenance,
        trust=trust,
        citation=citation,
    )


# Cached FalkorDB client for provenance lookups. _get_graph_client(None) builds
# a NEW connected client per call and close() is a no-op (redis pool), so a
# per-query client would leak connections — keep one connected singleton.
_provenance_graph_client: Any = None


async def _get_provenance_graph_client() -> Any:
    global _provenance_graph_client
    if _provenance_graph_client is None:
        from merlt.pipeline.provisional_writer import _get_graph_client

        _provenance_graph_client = await _get_graph_client(None)
    return _provenance_graph_client


async def _lookup_provenance_batch(urns: List[str]) -> Dict[str, dict]:
    """
    Read ``{provenance, trust, node_id}`` for each URN from FalkorDB (Loop β
    F.0 Option A). Reuses the configured graph client so the graph name follows
    the environment (``merl_t_legal`` on the live stack). Best-effort: returns
    ``{}`` on any error — provenance enrichment must never break a query.
    """
    out: Dict[str, dict] = {}
    if not urns:
        return out
    try:
        client = await _get_provenance_graph_client()
        rows = await client.query(
            "UNWIND $urns AS u MATCH (n) WHERE n.URN = u OR n.node_id = u "
            "RETURN u AS urn, n.provenance AS provenance, n.trust AS trust, "
            "n.node_id AS node_id, n.source_url AS source_url",
            {"urns": urns},
        )
        for r in rows:
            urn = r.get("urn")
            if urn and urn not in out:
                out[urn] = {
                    "provenance": r.get("provenance"),
                    "trust": r.get("trust"),
                    "node_id": r.get("node_id"),
                    "source_url": r.get("source_url"),
                }
    except Exception as e:  # noqa: BLE001
        # Drop the cached client so a stale/broken connection is rebuilt next call.
        global _provenance_graph_client
        _provenance_graph_client = None
        log.warning("provenance batch lookup failed (non-blocking)", error=str(e))
    return out


async def _build_retrieved_sources(result: Any) -> List[RetrievedSource]:
    """
    Build the "sources the engine consulted" panel from the retrieval trace
    (``pipeline_trace.stages.expert_executions[*].retrieval_trace.top_sources``)
    enriched with real FalkorDB provenance. Best-effort, never raises.
    """
    try:
        pt = (getattr(result, "metadata", None) or {}).get("pipeline_trace") or {}
        execs = (pt.get("stages") or {}).get("expert_executions") or []
        urns: List[str] = []
        for ex in execs:
            for u in ((ex.get("retrieval_trace") or {}).get("top_sources") or []):
                urn = u if isinstance(u, str) else (u.get("urn") if isinstance(u, dict) else None)
                if urn and urn not in urns:
                    urns.append(urn)
        enr = await _lookup_provenance_batch(urns)
        return [
            RetrievedSource(
                urn=urn,
                provenance=(enr.get(urn) or {}).get("provenance"),
                trust=(enr.get(urn) or {}).get("trust"),
                node_id=(enr.get(urn) or {}).get("node_id"),
                source_url=(enr.get(urn) or {}).get("source_url"),
            )
            for urn in urns
        ]
    except Exception as e:  # noqa: BLE001
        log.warning("retrieved_sources build failed (non-blocking)", error=str(e))
        return []


class InlineFeedbackRequest(BaseModel):
    """Quick thumbs feedback."""
    trace_id: str
    user_id: str
    rating: int = Field(..., ge=1, le=5, description="1=thumbs down, 5=thumbs up")


class DetailedFeedbackRequest(BaseModel):
    """Detailed 3-dimension feedback."""
    trace_id: str
    user_id: str
    retrieval_score: float = Field(..., ge=0.0, le=1.0, description="Quality of retrieved sources")
    reasoning_score: float = Field(..., ge=0.0, le=1.0, description="Quality of reasoning")
    synthesis_score: float = Field(..., ge=0.0, le=1.0, description="Quality of synthesis")
    comment: Optional[str] = Field(None, description="Optional textual comment")
    user_authority: Optional[float] = None


class SourceFeedbackRequest(BaseModel):
    """Per-source rating feedback."""
    trace_id: str
    user_id: str
    source_id: str = Field(..., description="article URN")
    relevance: int = Field(..., ge=1, le=5, description="1-5 stars")
    user_authority: Optional[float] = None


class RefineFeedbackRequest(BaseModel):
    """Conversational refinement feedback."""
    trace_id: str
    user_id: str
    follow_up_query: str = Field(..., min_length=5)


class ExpertPreferenceFeedbackRequest(BaseModel):
    """
    Feedback for divergent interpretations.

    When mode=divergent, user can indicate which expert
    provided the most useful interpretation.
    """
    trace_id: str
    user_id: str
    preferred_expert: str = Field(..., description="Expert type (literal, systemic, principles, precedent)")
    comment: Optional[str] = Field(None, description="Optional comment explaining preference")


class RouterFeedbackRequest(BaseModel):
    """Router feedback from high-authority users (F2)."""
    trace_id: str
    user_id: str
    routing_correct: bool = Field(..., description="True if routing was appropriate")
    suggested_weights: Optional[Dict[str, float]] = Field(
        None, description="Suggested expert weights, e.g. {'literal': 0.4, 'systemic': 0.3}"
    )
    suggested_query_type: Optional[str] = Field(
        None, description="Alternative classification for the query"
    )
    comment: Optional[str] = None
    user_authority: Optional[float] = None


class FeedbackResponse(BaseModel):
    """Generic feedback response."""
    success: bool
    feedback_id: Optional[int] = None
    message: str


# ============================================================================
# DEPENDENCY INJECTION
# ============================================================================

# Global orchestrator instance (initialized on startup)
_orchestrator: Optional[MultiExpertOrchestrator] = None
_pii_service = PIIMaskingService()
_audit_service = AuditService()


def get_orchestrator() -> MultiExpertOrchestrator:
    """
    Get MultiExpertOrchestrator instance.

    This should be initialized in the app startup event.
    For now, returns None and will be injected via dependency.
    """
    global _orchestrator
    if _orchestrator is None:
        raise HTTPException(
            status_code=503,
            detail="Expert System not initialized. Call initialize_expert_system() on startup."
        )
    return _orchestrator


def initialize_expert_system(orchestrator: MultiExpertOrchestrator):
    """
    Initialize expert system with orchestrator.

    Should be called in FastAPI startup event:

    @app.on_event("startup")
    async def startup():
        orchestrator = create_orchestrator()
        initialize_expert_system(orchestrator)
    """
    global _orchestrator
    _orchestrator = orchestrator
    log.info("Expert System initialized")


# ============================================================================
# AUDIT LOGGING
# ============================================================================

async def _audit_feedback(
    session: AsyncSession,
    feedback: QAFeedback,
    feedback_type: str,
) -> None:
    """Log feedback creation to audit trail. Non-blocking."""
    try:
        await _audit_service.log_event(
            session,
            action="CREATE",
            actor_id=feedback.user_id,
            resource_type="feedback",
            resource_id=str(feedback.id),
            details={"feedback_type": feedback_type, "trace_id": feedback.trace_id},
        )
    except Exception as e:
        log.warning("Audit logging failed (non-blocking)", error=str(e))


# ============================================================================
# TRAINING BUFFER WIRING
# ============================================================================

def _wire_feedback_to_training(
    trace: QATrace,
    feedback: QAFeedback,
    feedback_type: Literal["inline", "detailed", "source", "preference", "refine", "router"],
) -> None:
    """
    Wire a feedback submission to the RLCF training buffer.

    Computes reward, builds MultilevelFeedback, and pushes to scheduler.
    Wrapped in try/except so it never breaks the feedback submission.
    """
    try:
        # 1. Compute reward based on feedback type
        if feedback_type == "inline":
            reward = (feedback.inline_rating - 1) / 4  # 1→0, 5→1
        elif feedback_type == "detailed":
            reward = (
                0.3 * feedback.retrieval_score
                + 0.4 * feedback.reasoning_score
                + 0.3 * feedback.synthesis_score
            )
        elif feedback_type == "source":
            reward = (feedback.source_relevance - 1) / 4  # 1→0, 5→1
        elif feedback_type == "preference":
            reward = 0.5
        elif feedback_type == "refine":
            reward = 0.3
        elif feedback_type == "router":
            reward = 1.0 if feedback.inline_rating and feedback.inline_rating >= 4 else 0.0
        else:
            reward = 0.5

        # 2. Reconstruct the RLCF ExecutionTrace from storage (Loop β Bug-4 0.3).
        # full_trace nests the execution_trace (query_id + Actions carrying
        # query_embedding/log_prob) under 'execution_trace'. Older rows stored
        # only the flat pipeline trace (no actions) → fall back to it so legacy
        # feedback still no-ops gracefully instead of erroring.
        _stored_trace = trace.full_trace if trace.full_trace else {}
        trace_data = _stored_trace.get("execution_trace") or _stored_trace

        # 3. Build MultilevelFeedback
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

        # 4. Push to training buffer
        scheduler = get_scheduler()
        exp_id = scheduler.add_experience(
            trace=trace_data,
            feedback=ml_feedback,
            reward=reward,
            metadata={
                "feedback_type": feedback_type,
                "feedback_id": feedback.id,
                "trace_id": trace.trace_id,
            },
        )

        # 5. Log result
        log.debug(
            "Feedback wired to training buffer",
            feedback_type=feedback_type,
            reward=round(reward, 3),
            experience_id=exp_id,
            trace_id=trace.trace_id,
        )
    except Exception as e:
        log.warning(
            "Failed to wire feedback to training buffer (non-blocking)",
            error=str(e),
            feedback_type=feedback_type,
            trace_id=trace.trace_id,
        )


# ============================================================================
# AUTHORITY SCORING
# ============================================================================

async def _update_user_authority(
    user_id: str,
    feedback: QAFeedback,
    feedback_type: Literal["inline", "detailed", "source", "preference", "refine", "router"],
) -> Optional[float]:
    """
    Update user authority score after feedback submission.

    Computes quality_score from feedback, then updates track record
    and authority via RLCF authority module. Non-blocking.

    Returns:
        New authority score, or None if update failed.
    """
    try:
        # 1. Compute quality_score based on feedback type
        if feedback_type == "inline":
            quality_score = (feedback.inline_rating - 1) / 4  # 1→0, 5→1
        elif feedback_type == "detailed":
            quality_score = (
                (feedback.retrieval_score or 0)
                + (feedback.reasoning_score or 0)
                + (feedback.synthesis_score or 0)
            ) / 3
        elif feedback_type == "source":
            quality_score = ((feedback.source_relevance or 1) - 1) / 4
        elif feedback_type == "router":
            quality_score = 1.0 if (feedback.inline_rating or 0) >= 4 else 0.0
        else:
            # preference, refine → neutral
            quality_score = 0.5

        # 2. Open RLCF session and update authority
        async with get_async_session() as rlcf_session:
            # Find or create user in RLCF models
            result = await rlcf_session.execute(
                select(rlcf_models.User).where(
                    rlcf_models.User.username == user_id
                )
            )
            rlcf_user = result.scalar_one_or_none()

            if not rlcf_user:
                # Cold start: baseline_credential_score=0.3 for unknown users.
                # In production, load actual credentials from platform user profile.
                rlcf_user = rlcf_models.User(
                    username=user_id,
                    authority_score=0.5,
                    track_record_score=0.5,
                    baseline_credential_score=0.3,
                )
                rlcf_session.add(rlcf_user)
                await rlcf_session.flush()

            # 3. Update track record and authority
            await update_track_record(rlcf_session, rlcf_user.id, quality_score)
            new_authority = await update_authority_score(
                rlcf_session, rlcf_user.id, quality_score
            )

        log.debug(
            "User authority updated",
            user_id=user_id,
            feedback_type=feedback_type,
            quality_score=round(quality_score, 3),
            new_authority=round(new_authority, 3),
        )
        return new_authority
    except Exception as e:
        log.warning(
            "Authority update failed (non-blocking)",
            error=str(e),
            user_id=user_id,
            feedback_type=feedback_type,
        )
        return None


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.post("/query", response_model=ExpertQueryResponse)
async def query_experts(
    request: ExpertQueryRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    orchestrator: MultiExpertOrchestrator = Depends(get_orchestrator),
    api_key: ApiKey = Depends(verify_api_key),
    _rate_limit: None = Depends(check_rate_limit),
):
    """
    Submit query to MultiExpertOrchestrator and save trace.

    Flow:
    1. Run MultiExpertOrchestrator.process()
    2. Extract sources from SynthesisResult
    3. Save QATrace to database
    4. Return response with trace_id

    Example:
        POST /api/experts/query
        {
            "query": "Cos'è la legittima difesa?",
            "user_id": "user123"
        }

        Response:
        {
            "trace_id": "trace_abc123",
            "synthesis": "La legittima difesa è...",
            "mode": "convergent",
            "sources": [
                {"article_urn": "urn:...:art52", "expert": "literal", "relevance": 0.95}
            ],
            "experts_used": ["literal", "systemic"],
            "confidence": 0.85,
            "execution_time_ms": 2450
        }
    """
    start_time = time.time()

    log.info(
        "Expert query received",
        query=request.query[:50],
        user_id=request.user_id,
        max_experts=request.max_experts
    )

    try:
        # Run orchestrator
        result = await orchestrator.process(
            query=request.query,
            entities=request.context.get("entities") if request.context else None,
            retrieved_chunks=request.context.get("retrieved_chunks") if request.context else None,
            metadata={"user_id": request.user_id, "consent_level": request.consent_level},
            include_trace=request.include_trace
        )

        execution_time_ms = int((time.time() - start_time) * 1000)

        # Generate trace ID
        trace_id = f"trace_{uuid4().hex[:12]}"

        # Extract sources from combined_legal_basis
        sources = [_to_source_reference(ls) for ls in result.combined_legal_basis]

        # Loop β F.0 (Option A): the consulted sources, with real FalkorDB
        # provenance (the LLM-cited `sources` above lose it).
        retrieved_sources = await _build_retrieved_sources(result)

        # Extract experts used from expert_contributions
        experts_used = list(result.expert_contributions.keys())

        # Extract pipeline trace from result metadata
        pipeline_trace_data = result.metadata.get("pipeline_trace") if request.include_trace else None
        pipeline_metrics_data = result.metadata.get("pipeline_metrics") if request.include_trace else None
        # Loop β Bug-4 0.3: the orchestrator always attaches the ExecutionTrace
        # (query_id + RLCF actions w/ query_embedding) to metadata, regardless of
        # include_trace. Persist it (nested in full_trace) so feedback can feed
        # REINFORCE; it is stripped from the client-facing trace GET path.
        execution_trace_data = result.metadata.get("execution_trace")

        # Inject trace_id into pipeline_trace for correlation
        if pipeline_trace_data:
            pipeline_trace_data["trace_id"] = trace_id

        # Stored full_trace = pipeline trace (when requested) + nested RLCF
        # execution_trace (always, when present). dict() copy keeps the response's
        # pipeline_trace_data clean of the nested embedding payload.
        full_trace_data = dict(pipeline_trace_data) if pipeline_trace_data else {}
        if execution_trace_data:
            full_trace_data["execution_trace"] = execution_trace_data
        full_trace_data = full_trace_data or None

        # Extract routing metadata for new fields
        routing_method = None
        query_type = None
        if pipeline_trace_data:
            routing_info = pipeline_trace_data.get("routing", {})
            routing_method = routing_info.get("method")
            query_type = routing_info.get("query_type")

        # Save trace to database with new consent-aware fields
        trace = QATrace(
            trace_id=trace_id,
            user_id=request.user_id,
            query=request.query,
            selected_experts=experts_used,
            synthesis_mode=result.mode.value,
            synthesis_text=result.synthesis,
            sources=[s.model_dump() for s in sources],  # Store as JSONB
            execution_time_ms=execution_time_ms,
            full_trace=full_trace_data,
            # New consent-aware fields (Story 5-1)
            consent_level=request.consent_level,
            query_type=query_type,
            confidence=result.confidence,
            routing_method=routing_method,
        )
        session.add(trace)
        await session.commit()

        log.info(
            "Expert query completed",
            trace_id=trace_id,
            mode=result.mode.value,
            experts_count=len(experts_used),
            sources_count=len(sources),
            execution_time_ms=execution_time_ms,
            has_trace=pipeline_trace_data is not None
        )

        # Return response
        return ExpertQueryResponse(
            trace_id=trace_id,
            synthesis=result.synthesis,
            mode=result.mode.value,
            alternatives=result.alternatives if result.mode == SynthesisMode.DIVERGENT else None,
            sources=sources,
            experts_used=experts_used,
            confidence=result.confidence,
            execution_time_ms=execution_time_ms,
            pipeline_trace=pipeline_trace_data,
            pipeline_metrics=pipeline_metrics_data,
            retrieved_sources=retrieved_sources,
            # Slice 4 P2a: surface the deliberation (copied from `result`, no recompute).
            disagreement_analysis=_build_disagreement_analysis(result),
            devils_advocate_flag=_build_devils_advocate_flag(result),
            expert_contributions=_build_expert_contributions(result),
        )

    except Exception as e:
        log.error("Expert query failed", error=str(e), query=request.query[:50])
        raise HTTPException(status_code=500, detail=f"Expert query failed: {str(e)}")


@router.post("/feedback/inline", response_model=FeedbackResponse)
async def submit_inline_feedback(
    request: InlineFeedbackRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Submit quick thumbs up/down feedback.

    Example:
        POST /api/experts/feedback/inline
        {
            "trace_id": "trace_abc123",
            "user_id": "user456",
            "rating": 5  // thumbs up
        }
    """
    log.info(
        "Inline feedback received",
        trace_id=request.trace_id,
        user_id=request.user_id,
        rating=request.rating
    )

    try:
        # Verify trace exists
        result = await session.execute(
            select(QATrace).where(QATrace.trace_id == request.trace_id)
        )
        trace = result.scalar_one_or_none()

        if not trace:
            raise HTTPException(status_code=404, detail=f"Trace {request.trace_id} not found")

        # Create feedback
        feedback = QAFeedback(
            trace_id=request.trace_id,
            user_id=request.user_id,
            inline_rating=request.rating
        )
        session.add(feedback)
        await session.commit()

        _wire_feedback_to_training(trace, feedback, "inline")
        await _audit_feedback(session, feedback, "inline")
        new_authority = await _update_user_authority(request.user_id, feedback, "inline")
        if new_authority is not None:
            feedback.user_authority = new_authority
            await session.commit()

        # F8 implicit: positive inline feedback boosts source affinity
        try:
            from merlt.rlcf.affinity_service import AffinityUpdateService
            affinity_svc = AffinityUpdateService()
            for expert in (trace.selected_experts or []):
                await affinity_svc.update_implicit_from_expert_feedback(
                    session, trace, feedback, expert
                )
        except Exception as e:
            log.warning("Implicit affinity update failed (non-blocking)", error=str(e))

        log.info(
            "Inline feedback saved",
            feedback_id=feedback.id,
            trace_id=request.trace_id,
            rating=request.rating
        )

        return FeedbackResponse(
            success=True,
            feedback_id=feedback.id,
            message="Inline feedback saved successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to save inline feedback", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {str(e)}")


@router.post("/feedback/detailed", response_model=FeedbackResponse)
async def submit_detailed_feedback(
    request: DetailedFeedbackRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Submit detailed 3-dimension feedback.

    Example:
        POST /api/experts/feedback/detailed
        {
            "trace_id": "trace_abc123",
            "user_id": "user456",
            "retrieval_score": 0.8,
            "reasoning_score": 0.9,
            "synthesis_score": 0.7,
            "comment": "Buona risposta ma sintesi migliorabile"
        }
    """
    log.info(
        "Detailed feedback received",
        trace_id=request.trace_id,
        user_id=request.user_id,
        avg_score=(request.retrieval_score + request.reasoning_score + request.synthesis_score) / 3
    )

    try:
        # Verify trace exists
        result = await session.execute(
            select(QATrace).where(QATrace.trace_id == request.trace_id)
        )
        trace = result.scalar_one_or_none()

        if not trace:
            raise HTTPException(status_code=404, detail=f"Trace {request.trace_id} not found")

        # Create feedback (mask PII in comments)
        masked_comment = _pii_service.mask_text(request.comment) if request.comment else None
        feedback = QAFeedback(
            trace_id=request.trace_id,
            user_id=request.user_id,
            retrieval_score=request.retrieval_score,
            reasoning_score=request.reasoning_score,
            synthesis_score=request.synthesis_score,
            detailed_comment=masked_comment,
            user_authority=request.user_authority
        )
        session.add(feedback)
        await session.commit()

        _wire_feedback_to_training(trace, feedback, "detailed")
        await _audit_feedback(session, feedback, "detailed")
        new_authority = await _update_user_authority(request.user_id, feedback, "detailed")
        if new_authority is not None:
            feedback.user_authority = new_authority
            await session.commit()

        # F8 implicit: detailed feedback scores propagate to source affinity
        try:
            from merlt.rlcf.affinity_service import AffinityUpdateService
            affinity_svc = AffinityUpdateService()
            for expert in (trace.selected_experts or []):
                await affinity_svc.update_implicit_from_expert_feedback(
                    session, trace, feedback, expert
                )
        except Exception as e:
            log.warning("Implicit affinity update failed (non-blocking)", error=str(e))

        log.info(
            "Detailed feedback saved",
            feedback_id=feedback.id,
            trace_id=request.trace_id,
            retrieval=request.retrieval_score,
            reasoning=request.reasoning_score,
            synthesis=request.synthesis_score
        )

        return FeedbackResponse(
            success=True,
            feedback_id=feedback.id,
            message="Detailed feedback saved successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to save detailed feedback", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {str(e)}")


@router.post("/feedback/source", response_model=FeedbackResponse)
async def submit_source_feedback(
    request: SourceFeedbackRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Submit per-source rating feedback.

    Example:
        POST /api/experts/feedback/source
        {
            "trace_id": "trace_abc123",
            "user_id": "user456",
            "source_id": "urn:nir:stato:codice.civile:1942;art1453",
            "relevance": 5  // 5 stars
        }
    """
    log.info(
        "Source feedback received",
        trace_id=request.trace_id,
        source_id=request.source_id,
        relevance=request.relevance
    )

    try:
        # Verify trace exists
        result = await session.execute(
            select(QATrace).where(QATrace.trace_id == request.trace_id)
        )
        trace = result.scalar_one_or_none()

        if not trace:
            raise HTTPException(status_code=404, detail=f"Trace {request.trace_id} not found")

        # Create feedback
        feedback = QAFeedback(
            trace_id=request.trace_id,
            user_id=request.user_id,
            source_id=request.source_id,
            source_relevance=request.relevance,
            user_authority=request.user_authority
        )
        session.add(feedback)
        await session.commit()

        _wire_feedback_to_training(trace, feedback, "source")
        await _audit_feedback(session, feedback, "source")
        new_authority = await _update_user_authority(request.user_id, feedback, "source")
        if new_authority is not None:
            feedback.user_authority = new_authority
            await session.commit()

        # F8c: Update expert affinity
        try:
            from merlt.rlcf.affinity_service import AffinityUpdateService
            affinity_svc = AffinityUpdateService()
            await affinity_svc.update_from_source_feedback(session, trace, feedback)
        except Exception as e:
            log.warning("Affinity update failed (non-blocking)", error=str(e))

        log.info(
            "Source feedback saved",
            feedback_id=feedback.id,
            source_id=request.source_id,
            relevance=request.relevance
        )

        return FeedbackResponse(
            success=True,
            feedback_id=feedback.id,
            message="Source feedback saved successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to save source feedback", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {str(e)}")


@router.post("/feedback/preference", response_model=FeedbackResponse)
async def submit_expert_preference_feedback(
    request: ExpertPreferenceFeedbackRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Submit expert preference feedback for divergent interpretations.

    When mode=divergent, users can indicate which expert's interpretation
    was most useful. This feedback is used for:
    - RLCF training
    - Expert weight optimization
    - Response synthesis improvement

    Example:
        POST /api/experts/feedback/preference
        {
            "trace_id": "trace_abc123",
            "user_id": "user456",
            "preferred_expert": "systemic",
            "comment": "L'interpretazione sistematica e' piu' completa"
        }
    """
    log.info(
        "Expert preference feedback received",
        trace_id=request.trace_id,
        user_id=request.user_id,
        preferred_expert=request.preferred_expert
    )

    try:
        # Verify trace exists and was divergent
        result = await session.execute(
            select(QATrace).where(QATrace.trace_id == request.trace_id)
        )
        trace = result.scalar_one_or_none()

        if not trace:
            raise HTTPException(status_code=404, detail=f"Trace {request.trace_id} not found")

        if trace.synthesis_mode != "divergent":
            log.warning(
                "Preference feedback for non-divergent trace",
                trace_id=request.trace_id,
                mode=trace.synthesis_mode
            )
            # Still accept feedback but log warning

        # Validate expert type
        valid_experts = ["literal", "systemic", "principles", "precedent"]
        if request.preferred_expert not in valid_experts:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid expert type '{request.preferred_expert}'. Valid: {valid_experts}"
            )

        # Create feedback with expert preference (mask PII in comments)
        masked_comment = _pii_service.mask_text(request.comment) if request.comment else None
        feedback = QAFeedback(
            trace_id=request.trace_id,
            user_id=request.user_id,
            preferred_expert=request.preferred_expert,
            detailed_comment=masked_comment
        )
        session.add(feedback)
        await session.commit()

        _wire_feedback_to_training(trace, feedback, "preference")
        await _audit_feedback(session, feedback, "preference")
        new_authority = await _update_user_authority(request.user_id, feedback, "preference")
        if new_authority is not None:
            feedback.user_authority = new_authority
            await session.commit()

        # F8 implicit: preference feedback boosts the preferred expert's sources
        try:
            from merlt.rlcf.affinity_service import AffinityUpdateService
            affinity_svc = AffinityUpdateService()
            await affinity_svc.update_implicit_from_expert_feedback(
                session, trace, feedback, request.preferred_expert
            )
        except Exception as e:
            log.warning("Implicit affinity update failed (non-blocking)", error=str(e))

        log.info(
            "Expert preference feedback saved",
            feedback_id=feedback.id,
            trace_id=request.trace_id,
            preferred_expert=request.preferred_expert
        )

        return FeedbackResponse(
            success=True,
            feedback_id=feedback.id,
            message=f"Preference feedback saved: {request.preferred_expert}"
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to save expert preference feedback", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {str(e)}")


# Configurable authority threshold for router feedback
ROUTER_FEEDBACK_AUTHORITY_THRESHOLD = 0.7


@router.post("/feedback/router", response_model=FeedbackResponse)
async def submit_router_feedback(
    request: RouterFeedbackRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Submit router feedback from high-authority users (F2).

    Only users with authority >= 0.7 can evaluate routing decisions.

    Example:
        POST /api/experts/feedback/router
        {
            "trace_id": "trace_abc123",
            "user_id": "user456",
            "routing_correct": true,
            "comment": "Routing appropriato per la query"
        }
    """
    log.info(
        "Router feedback received",
        trace_id=request.trace_id,
        user_id=request.user_id,
        routing_correct=request.routing_correct,
    )

    try:
        # Always lookup authority from DB — never trust client-supplied value
        # for authorization decisions (client value is only a UI cache hint)
        authority = 0.0
        try:
            async with get_async_session() as rlcf_session:
                result = await rlcf_session.execute(
                    select(rlcf_models.User).where(
                        rlcf_models.User.username == request.user_id
                    )
                )
                rlcf_user = result.scalar_one_or_none()
                authority = rlcf_user.authority_score if rlcf_user else 0.0
        except Exception as e:
            log.debug("authority_lookup_failed", error=str(e))
            authority = 0.0

        if authority < ROUTER_FEEDBACK_AUTHORITY_THRESHOLD:
            raise HTTPException(
                status_code=403,
                detail=f"Authority {authority:.2f} below threshold "
                       f"{ROUTER_FEEDBACK_AUTHORITY_THRESHOLD}. "
                       f"Router feedback requires high authority."
            )

        # Verify trace exists
        result = await session.execute(
            select(QATrace).where(QATrace.trace_id == request.trace_id)
        )
        trace = result.scalar_one_or_none()

        if not trace:
            raise HTTPException(status_code=404, detail=f"Trace {request.trace_id} not found")

        # Build comment with routing metadata
        comment_parts = []
        if request.suggested_query_type:
            comment_parts.append(f"[router][{request.suggested_query_type}]")
        else:
            comment_parts.append("[router][unchanged]")
        if request.comment:
            comment_parts.append(request.comment)
        if request.suggested_weights:
            comment_parts.append(f"weights={json.dumps(request.suggested_weights)}")

        # Create feedback
        feedback = QAFeedback(
            trace_id=request.trace_id,
            user_id=request.user_id,
            inline_rating=5 if request.routing_correct else 1,
            detailed_comment=" ".join(comment_parts),
            user_authority=authority,
        )
        session.add(feedback)
        await session.commit()

        _wire_feedback_to_training(trace, feedback, "router")
        await _audit_feedback(session, feedback, "router")
        new_authority = await _update_user_authority(request.user_id, feedback, "router")
        if new_authority is not None:
            feedback.user_authority = new_authority
            await session.commit()

        log.info(
            "Router feedback saved",
            feedback_id=feedback.id,
            trace_id=request.trace_id,
            routing_correct=request.routing_correct,
        )

        return FeedbackResponse(
            success=True,
            feedback_id=feedback.id,
            message=f"Router feedback saved: {'correct' if request.routing_correct else 'improvable'}"
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to save router feedback", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {str(e)}")


@router.post("/feedback/refine", response_model=ExpertQueryResponse)
async def submit_refine_feedback(
    request: RefineFeedbackRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    orchestrator: MultiExpertOrchestrator = Depends(get_orchestrator),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Submit conversational refinement feedback and get new response.

    This endpoint:
    1. Saves follow-up query as feedback
    2. Re-runs orchestrator with context from original trace
    3. Links new trace to original via refined_trace_id

    Example:
        POST /api/experts/feedback/refine
        {
            "trace_id": "trace_abc123",
            "user_id": "user456",
            "follow_up_query": "Puoi spiegare meglio il requisito della proporzione?"
        }

        Returns: ExpertQueryResponse (same as /query)
    """
    start_time = time.time()

    log.info(
        "Refine feedback received",
        trace_id=request.trace_id,
        user_id=request.user_id,
        follow_up=request.follow_up_query[:50]
    )

    try:
        # Verify original trace exists
        result = await session.execute(
            select(QATrace).where(QATrace.trace_id == request.trace_id)
        )
        original_trace = result.scalar_one_or_none()

        if not original_trace:
            raise HTTPException(status_code=404, detail=f"Original trace {request.trace_id} not found")

        # Re-run orchestrator with follow-up query
        result = await orchestrator.process(
            query=request.follow_up_query,
            metadata={
                "user_id": request.user_id,
                "refine_from": request.trace_id,
                "original_query": original_trace.query
            }
        )

        execution_time_ms = int((time.time() - start_time) * 1000)

        # Generate new trace ID
        new_trace_id = f"trace_{uuid4().hex[:12]}"

        # Extract sources (same LegalSource shape as the main query path)
        sources = [_to_source_reference(ls) for ls in result.combined_legal_basis]
        retrieved_sources = await _build_retrieved_sources(result)

        experts_used = list(result.expert_contributions.keys())

        # Save new trace (inherit consent_level from original)
        new_trace = QATrace(
            trace_id=new_trace_id,
            user_id=request.user_id,
            query=request.follow_up_query,
            selected_experts=experts_used,
            synthesis_mode=result.mode.value,
            synthesis_text=result.synthesis,
            sources=[s.model_dump() for s in sources],
            execution_time_ms=execution_time_ms,
            consent_level=original_trace.consent_level,
            confidence=result.confidence,
        )
        session.add(new_trace)

        # Save refinement feedback with link to new trace
        feedback = QAFeedback(
            trace_id=request.trace_id,
            user_id=request.user_id,
            follow_up_query=request.follow_up_query,
            refined_trace_id=new_trace_id
        )
        session.add(feedback)

        await session.commit()

        _wire_feedback_to_training(original_trace, feedback, "refine")
        new_authority = await _update_user_authority(request.user_id, feedback, "refine")
        if new_authority is not None:
            feedback.user_authority = new_authority
            await session.commit()

        log.info(
            "Refine feedback processed",
            original_trace_id=request.trace_id,
            new_trace_id=new_trace_id,
            execution_time_ms=execution_time_ms
        )

        return ExpertQueryResponse(
            trace_id=new_trace_id,
            synthesis=result.synthesis,
            mode=result.mode.value,
            alternatives=result.alternatives if result.mode == SynthesisMode.DIVERGENT else None,
            sources=sources,
            experts_used=experts_used,
            confidence=result.confidence,
            execution_time_ms=execution_time_ms,
            retrieved_sources=retrieved_sources,
            # Slice 4 P2a: keep the debate visible on follow-ups too (same shape).
            disagreement_analysis=_build_disagreement_analysis(result),
            devils_advocate_flag=_build_devils_advocate_flag(result),
            expert_contributions=_build_expert_contributions(result),
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to process refine feedback", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to process refinement: {str(e)}")


class HistoryItem(BaseModel):
    """One past Q&A turn for the user's history list (Loop β #1 option B)."""
    trace_id: str
    query: str
    synthesis: str
    mode: str
    confidence: Optional[float] = None
    experts_used: List[str] = Field(default_factory=list)
    sources: List[SourceReference] = Field(default_factory=list)
    created_at: Optional[str] = None


@router.get("/history", response_model=List[HistoryItem])
async def list_history(
    user_id: str,
    limit: int = 20,
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    List the user's most recent Q&A turns (newest first) so the UI can show a
    server-backed history that survives reloads and is shared across devices.
    Read-only; cited `sources` are returned, the (live-only) retrieved_sources
    panel is not persisted.
    """
    limit = max(1, min(100, limit))
    result = await session.execute(
        select(QATrace)
        .where(QATrace.user_id == user_id)
        .order_by(QATrace.created_at.desc())
        .limit(limit)
    )
    items: List[HistoryItem] = []
    for t in result.scalars().all():
        raw_sources = t.sources if isinstance(t.sources, list) else []
        parsed_sources: List[SourceReference] = []
        for s in raw_sources:
            if not isinstance(s, dict):
                continue
            try:
                parsed_sources.append(SourceReference(**s))
            except Exception:
                # Tolerate legacy/malformed stored source dicts.
                continue
        items.append(
            HistoryItem(
                trace_id=t.trace_id,
                query=t.query or "",
                synthesis=t.synthesis_text or "",
                mode=t.synthesis_mode or "convergent",
                confidence=t.confidence,
                experts_used=t.selected_experts or [],
                sources=parsed_sources,
                created_at=t.created_at.isoformat() if t.created_at else None,
            )
        )
    return items


@router.get("/trace/{trace_id}")
async def get_trace(
    trace_id: str,
    caller_consent: Optional[str] = None,
    session: AsyncSession = Depends(get_async_session_dep),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Recupera il trace completo di una query precedente.

    Returns the full pipeline trace JSON stored during query execution.
    Only available for queries executed with include_trace=True.

    Consent filtering is applied based on:
    - The trace's stored consent_level
    - The caller's consent level (caller_consent param)

    The most restrictive level is applied:
    - anonymous: user_id and query are redacted
    - basic: query is redacted
    - full: no redaction

    Example:
        GET /api/experts/trace/trace_abc123def456
        GET /api/experts/trace/trace_abc123def456?caller_consent=basic
    """
    result = await session.execute(
        select(QATrace).where(QATrace.trace_id == trace_id)
    )
    qa_trace = result.scalar_one_or_none()

    if not qa_trace:
        raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")

    if not qa_trace.full_trace:
        raise HTTPException(
            status_code=404,
            detail=f"No pipeline trace available for {trace_id}. Was the query executed with include_trace=True?"
        )

    # Apply consent filtering
    import copy
    import json as _json
    full_trace = copy.deepcopy(qa_trace.full_trace) if qa_trace.full_trace else {}

    # Loop β Bug-4 0.3: the nested RLCF execution_trace (query_id + actions +
    # query_embedding) is server-internal — it feeds REINFORCE and must never be
    # returned to clients (leaks the embedding, bloats the payload). Strip it. If
    # nothing else remains, the query ran without include_trace=True.
    full_trace.pop("execution_trace", None)
    if not full_trace:
        raise HTTPException(
            status_code=404,
            detail=f"No pipeline trace available for {trace_id}. Was the query executed with include_trace=True?"
        )

    consent_levels = {"anonymous": 0, "basic": 1, "full": 2}
    stored_level = consent_levels.get(qa_trace.consent_level, 0)
    # None means no caller restriction; invalid value defaults to most restrictive
    if caller_consent is None:
        caller_level = 2
    else:
        caller_level = consent_levels.get(caller_consent, 0)
    effective_level = min(stored_level, caller_level)

    if effective_level < 2:  # basic or anonymous — redact query throughout
        # Redact all occurrences of the original query text from the trace JSON
        original_query = qa_trace.query
        if original_query:
            trace_str = _json.dumps(full_trace, ensure_ascii=False, default=str)
            trace_str = trace_str.replace(original_query, "[REDACTED]")
            full_trace = _json.loads(trace_str)
        # Also redact well-known keys
        for key in ("query", "query_text"):
            if key in full_trace:
                full_trace[key] = "[REDACTED]"
        if isinstance(full_trace.get("input"), dict) and "query" in full_trace["input"]:
            full_trace["input"]["query"] = "[REDACTED]"

    if effective_level == 0:  # anonymous — also redact user_id
        for key in ("user_id",):
            if key in full_trace:
                full_trace[key] = "[REDACTED]"
        if isinstance(full_trace.get("input"), dict) and "user_id" in full_trace["input"]:
            full_trace["input"]["user_id"] = "[REDACTED]"

    return full_trace
