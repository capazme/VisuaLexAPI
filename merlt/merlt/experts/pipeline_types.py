"""
Pipeline Data Types for MERL-T Orchestrator.

Core data structures for the Pipeline Orchestrator that connects
all Epic 4 components into a cohesive analysis flow.

Story 5.0: Expert Pipeline Orchestrator
"""

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from .base import FeedbackHook


# ============================================================================
# TRACE DATACLASSES FOR SCIENTIFIC JSON TRACING
# ============================================================================

@dataclass
class LLMCallTrace:
    """Trace di una singola chiamata LLM."""
    call_id: str
    model: str
    prompt_summary: str        # primi 200 char del prompt
    started_at: str            # ISO timestamp
    completed_at: str
    duration_ms: float
    tokens_input: int
    tokens_output: int
    temperature: Optional[float] = None
    response_summary: str = ""
    success: bool = True
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "call_id": self.call_id,
            "model": self.model,
            "prompt_summary": self.prompt_summary,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": round(self.duration_ms, 2),
            "tokens_input": self.tokens_input,
            "tokens_output": self.tokens_output,
            "temperature": self.temperature,
            "response_summary": self.response_summary,
            "success": self.success,
            "error": self.error,
        }


@dataclass
class ToolCallTrace:
    """Trace di una singola chiamata tool."""
    call_id: str
    tool_name: str
    parameters: Dict[str, Any] = field(default_factory=dict)
    started_at: str = ""
    completed_at: str = ""
    duration_ms: float = 0.0
    success: bool = True
    result_summary: str = ""
    result_count: Optional[int] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "call_id": self.call_id,
            "tool_name": self.tool_name,
            "parameters": self.parameters,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": round(self.duration_ms, 2),
            "success": self.success,
            "result_summary": self.result_summary,
            "result_count": self.result_count,
            "error": self.error,
        }


@dataclass
class RetrievalTrace:
    """Trace del retrieval ibrido."""
    vector_search_time_ms: float = 0.0
    graph_enrichment_time_ms: float = 0.0
    total_chunks_retrieved: int = 0
    chunks_after_reranking: int = 0
    alpha_used: float = 0.5
    top_sources: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "vector_search_time_ms": round(self.vector_search_time_ms, 2),
            "graph_enrichment_time_ms": round(self.graph_enrichment_time_ms, 2),
            "total_chunks_retrieved": self.total_chunks_retrieved,
            "chunks_after_reranking": self.chunks_after_reranking,
            "alpha_used": round(self.alpha_used, 3),
            "top_sources": self.top_sources,
        }


# ============================================================================
# PIPELINE REQUEST / EXECUTION TYPES
# ============================================================================

@dataclass
class PipelineRequest:
    """
    Input to the Pipeline Orchestrator.

    Attributes:
        query: User query text
        user_profile: User profile for formatting (consulenza|ricerca|analisi|contributore)
        trace_id: Optional trace ID (auto-generated if not provided)
        user_id: Optional user ID for consent/audit
        override_weights: Optional expert weight overrides
        bypass_experts: Optional list of experts to skip
        context: Optional additional context
    """

    query: str
    user_profile: str = "ricerca"
    trace_id: Optional[str] = None
    user_id: Optional[str] = None
    override_weights: Optional[Dict[str, float]] = None
    bypass_experts: Optional[List[str]] = None
    context: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for logging/storage."""
        return {
            "query": self.query,
            "user_profile": self.user_profile,
            "trace_id": self.trace_id,
            "user_id": self.user_id,
            "override_weights": self.override_weights,
            "bypass_experts": self.bypass_experts,
            "context": self.context,
        }


@dataclass
class ExpertExecution:
    """
    Execution trace for a single Expert.

    Attributes:
        expert_type: Type of expert (literal, systemic, principles, precedent)
        started_at: When execution started
        completed_at: When execution completed
        duration_ms: Execution time in milliseconds
        success: Whether execution succeeded
        error: Error message if failed
        input_context: Input context provided
        output: Expert response (serialized)
        tokens_used: LLM tokens consumed
        confidence: Output confidence score
        circuit_breaker_state: Circuit breaker state at execution
        skipped: Whether expert was skipped
        skip_reason: Reason for skipping
    """

    expert_type: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: float = 0.0
    success: bool = False
    error: Optional[str] = None
    input_context: Optional[Dict[str, Any]] = None
    output: Optional[Dict[str, Any]] = None
    tokens_used: int = 0
    confidence: float = 0.0
    circuit_breaker_state: str = "closed"
    skipped: bool = False
    skip_reason: Optional[str] = None
    # Scientific trace fields
    llm_calls: List[Dict[str, Any]] = field(default_factory=list)
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    retrieval_trace: Optional[Dict[str, Any]] = None
    react_steps: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage."""
        result = {
            "expert_type": self.expert_type,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_ms": round(self.duration_ms, 2),
            "success": self.success,
            "error": self.error,
            "input_context": self.input_context,
            "output": self.output,
            "tokens_used": self.tokens_used,
            "confidence": round(self.confidence, 3),
            "circuit_breaker_state": self.circuit_breaker_state,
            "skipped": self.skipped,
            "skip_reason": self.skip_reason,
        }
        if self.llm_calls:
            result["llm_calls"] = self.llm_calls
        if self.tool_calls:
            result["tool_calls"] = self.tool_calls
        if self.retrieval_trace:
            result["retrieval_trace"] = self.retrieval_trace
        if self.react_steps:
            result["react_steps"] = self.react_steps
        return result


@dataclass
class PipelineTrace:
    """
    Complete execution trace for Epic 5.1 storage.

    Attributes:
        trace_id: UUID for correlation
        query_text: Original query
        timestamp: When pipeline started
        ner_result: Serialized NER extraction result
        routing_decision: Serialized routing decision
        expert_executions: Per-expert execution traces
        gating_result: Serialized gating aggregation result
        synthesis_result: Serialized synthesis result
        total_time_ms: End-to-end latency
        stage_times_ms: Per-stage timing
        total_tokens: Total LLM tokens used
    """

    trace_id: str
    query_text: str
    timestamp: datetime = field(default_factory=datetime.now)
    ner_result: Dict[str, Any] = field(default_factory=dict)
    routing_decision: Dict[str, Any] = field(default_factory=dict)
    expert_executions: List[Dict[str, Any]] = field(default_factory=list)
    gating_result: Dict[str, Any] = field(default_factory=dict)
    synthesis_result: Dict[str, Any] = field(default_factory=dict)
    total_time_ms: float = 0.0
    stage_times_ms: Dict[str, float] = field(default_factory=dict)
    total_tokens: int = 0
    # Scientific trace extensions
    query_embedding_time_ms: float = 0.0
    query_embedding: Optional[List[float]] = None
    disagreement_analysis: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        result = {
            "trace_id": self.trace_id,
            "query_text": self.query_text,
            "timestamp": self.timestamp.isoformat(),
            "total_time_ms": round(self.total_time_ms, 2),
            "total_tokens": self.total_tokens,
            "stages": {
                "ner": self.ner_result,
                "routing": self.routing_decision,
                "expert_executions": self.expert_executions,
                "gating": self.gating_result,
                "synthesis": self.synthesis_result,
            },
            "stage_times_ms": {k: round(v, 2) for k, v in self.stage_times_ms.items()},
        }
        if self.query_embedding_time_ms > 0:
            result["query_embedding_time_ms"] = round(self.query_embedding_time_ms, 2)
        if self.query_embedding is not None:
            result["query_embedding"] = self.query_embedding
        if self.disagreement_analysis:
            result["stages"]["synthesis"]["disagreement_analysis"] = self.disagreement_analysis
        return result

    def to_json(self) -> str:
        """Serialize to JSON for PostgreSQL JSONB storage."""
        return json.dumps(self.to_dict(), ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PipelineTrace":
        """Create PipelineTrace from dictionary."""
        # Support both old flat format and new stages format
        stages = data.get("stages", {})
        return cls(
            trace_id=data["trace_id"],
            query_text=data["query_text"],
            timestamp=datetime.fromisoformat(data["timestamp"]),
            ner_result=stages.get("ner", data.get("ner_result", {})),
            routing_decision=stages.get("routing", data.get("routing_decision", {})),
            expert_executions=stages.get("expert_executions", data.get("expert_executions", [])),
            gating_result=stages.get("gating", data.get("gating_result", {})),
            synthesis_result=stages.get("synthesis", data.get("synthesis_result", {})),
            total_time_ms=data.get("total_time_ms", 0.0),
            stage_times_ms=data.get("stage_times_ms", {}),
            total_tokens=data.get("total_tokens", 0),
            query_embedding_time_ms=data.get("query_embedding_time_ms", 0.0),
            query_embedding=data.get("query_embedding"),
            disagreement_analysis=data.get("disagreement_analysis"),
        )


@dataclass
class PipelineMetrics:
    """
    Performance and usage metrics for the pipeline.

    Attributes:
        total_time_ms: Total execution time
        ner_time_ms: NER extraction time
        routing_time_ms: Router execution time
        expert_times_ms: Per-expert timing
        gating_time_ms: Gating network time
        synthesis_time_ms: Synthesizer time
        total_tokens: Total LLM tokens used
        experts_activated: List of activated experts
        experts_failed: List of experts that failed
        experts_skipped: List of experts that were skipped
        circuit_breaker_events: Circuit breaker state changes
        degraded: Whether response is degraded
        degradation_reason: Reason for degradation
    """

    total_time_ms: float = 0.0
    ner_time_ms: float = 0.0
    routing_time_ms: float = 0.0
    expert_times_ms: Dict[str, float] = field(default_factory=dict)
    gating_time_ms: float = 0.0
    synthesis_time_ms: float = 0.0
    total_tokens: int = 0
    experts_activated: List[str] = field(default_factory=list)
    experts_failed: List[str] = field(default_factory=list)
    experts_skipped: List[str] = field(default_factory=list)
    circuit_breaker_events: List[Dict[str, Any]] = field(default_factory=list)
    degraded: bool = False
    degradation_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "total_time_ms": round(self.total_time_ms, 2),
            "ner_time_ms": round(self.ner_time_ms, 2),
            "routing_time_ms": round(self.routing_time_ms, 2),
            "expert_times_ms": {k: round(v, 2) for k, v in self.expert_times_ms.items()},
            "gating_time_ms": round(self.gating_time_ms, 2),
            "synthesis_time_ms": round(self.synthesis_time_ms, 2),
            "total_tokens": self.total_tokens,
            "experts_activated": self.experts_activated,
            "experts_failed": self.experts_failed,
            "experts_skipped": self.experts_skipped,
            "circuit_breaker_events": self.circuit_breaker_events,
            "degraded": self.degraded,
            "degradation_reason": self.degradation_reason,
        }


@dataclass
class PipelineResult:
    """
    Complete output from Pipeline Orchestrator.

    Attributes:
        response: SynthesizedResponse for UI display
        trace: Complete execution trace for Epic 5.1 storage
        metrics: Performance metrics
        feedback_hooks: F1-F7 feedback opportunities
        alternative_analysis: Devil's advocate analysis (optional)
        success: Whether pipeline completed successfully
        error: Error message if failed
    """

    response: Any  # SynthesizedResponse - avoid circular import
    trace: PipelineTrace
    metrics: PipelineMetrics
    feedback_hooks: List[FeedbackHook] = field(default_factory=list)
    alternative_analysis: Optional[Dict[str, Any]] = None
    success: bool = True
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "response": self.response.to_dict() if hasattr(self.response, "to_dict") else self.response,
            "trace": self.trace.to_dict(),
            "metrics": self.metrics.to_dict(),
            "feedback_hooks": [fh.to_dict() for fh in self.feedback_hooks],
            "alternative_analysis": self.alternative_analysis,
            "success": self.success,
            "error": self.error,
        }


@dataclass
class OrchestratorConfig:
    """
    Configuration for Pipeline Orchestrator.

    Attributes:
        expert_timeout_ms: Timeout per expert (default 30s)
        total_timeout_ms: Total pipeline timeout (default 120s)
        parallel_execution: Whether to run experts in parallel
        expert_weight_threshold: Skip expert if router weight below this (default 0.1)
        min_confidence_threshold: Filter response if confidence below this (default 0.2)
        enable_tracing: Whether to collect execution trace
        enable_metrics: Whether to collect metrics
        enable_feedback_hooks: Whether to collect feedback hooks
        degradation_confidence_penalty: Confidence penalty per failed expert
        max_degradation_penalty: Maximum confidence penalty
        llm_provider: Default LLM provider name
        llm_model: Default LLM model
    """

    expert_timeout_ms: float = 30000.0  # 30 seconds
    total_timeout_ms: float = 120000.0  # 2 minutes
    parallel_execution: bool = True
    expert_weight_threshold: float = 0.1  # Skip expert if router weight < this
    min_confidence_threshold: float = 0.2  # Filter response if confidence < this
    enable_tracing: bool = True
    enable_metrics: bool = True
    enable_feedback_hooks: bool = True
    degradation_confidence_penalty: float = 0.10  # -10% per failed expert
    max_degradation_penalty: float = 0.25  # Max -25%
    llm_provider: str = "openrouter"
    llm_model: Optional[str] = None  # Use provider default

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "expert_timeout_ms": self.expert_timeout_ms,
            "total_timeout_ms": self.total_timeout_ms,
            "parallel_execution": self.parallel_execution,
            "expert_weight_threshold": self.expert_weight_threshold,
            "min_confidence_threshold": self.min_confidence_threshold,
            "enable_tracing": self.enable_tracing,
            "enable_metrics": self.enable_metrics,
            "enable_feedback_hooks": self.enable_feedback_hooks,
            "degradation_confidence_penalty": self.degradation_confidence_penalty,
            "max_degradation_penalty": self.max_degradation_penalty,
            "llm_provider": self.llm_provider,
            "llm_model": self.llm_model,
        }


# Pipeline stage names for timing
class PipelineStage:
    """Constants for pipeline stage names."""

    NER = "ner"
    ROUTING = "routing"
    EXPERT_LITERAL = "expert_literal"
    EXPERT_SYSTEMIC = "expert_systemic"
    EXPERT_PRINCIPLES = "expert_principles"
    EXPERT_PRECEDENT = "expert_precedent"
    GATING = "gating"
    SYNTHESIS = "synthesis"


# Pipeline error types
class PipelineError(Exception):
    """Base exception for pipeline errors."""

    def __init__(self, message: str, stage: Optional[str] = None):
        self.stage = stage
        super().__init__(message)


class PipelineValidationError(PipelineError):
    """Invalid request parameters."""

    pass


class PipelineTimeoutError(PipelineError):
    """Pipeline exceeded total timeout."""

    pass


class ExpertExecutionError(PipelineError):
    """One or more experts failed."""

    def __init__(
        self,
        message: str,
        experts_failed: List[str],
        partial_results: Optional[List[Any]] = None,
    ):
        self.experts_failed = experts_failed
        self.partial_results = partial_results or []
        super().__init__(message, stage="expert_execution")


def generate_trace_id() -> str:
    """Generate a unique trace ID."""
    return str(uuid.uuid4())
