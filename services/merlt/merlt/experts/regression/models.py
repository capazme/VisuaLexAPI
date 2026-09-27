"""
Data models for Gold Standard Regression Testing.

Provides structured representations for:
- Gold standard queries with expected responses
- Regression test results
- Similarity scores
- Regression reports
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class QueryStatus(str, Enum):
    """Status of a regression query."""

    PASSED = "passed"
    FAILED = "failed"
    DEGRADED = "degraded"  # Score dropped significantly
    IMPROVED = "improved"  # Score improved
    ERROR = "error"  # Pipeline error


class ExpertFocus(str, Enum):
    """Focus area for categorizing queries."""

    LITERAL = "literal"
    SYSTEMIC = "systemic"
    PRINCIPLES = "principles"
    PRECEDENT = "precedent"
    MIXED = "mixed"


@dataclass
class ExpectedResponse:
    """
    Expected response from the pipeline.

    Attributes:
        main_answer: Expected main answer text
        expected_experts: List of experts that should contribute
        expected_citations: Citations that should be present
        key_concepts: Key concepts that must appear
        confidence_range: Expected confidence range (min, max)
        metadata: Additional expected metadata
    """

    main_answer: str
    expected_experts: List[str] = field(default_factory=list)
    expected_citations: List[str] = field(default_factory=list)
    key_concepts: List[str] = field(default_factory=list)
    confidence_range: Tuple[float, float] = (0.5, 1.0)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "main_answer": self.main_answer,
            "expected_experts": self.expected_experts,
            "expected_citations": self.expected_citations,
            "key_concepts": self.key_concepts,
            "confidence_range": list(self.confidence_range),
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExpectedResponse":
        """Create from dictionary."""
        return cls(
            main_answer=data["main_answer"],
            expected_experts=data.get("expected_experts", []),
            expected_citations=data.get("expected_citations", []),
            key_concepts=data.get("key_concepts", []),
            confidence_range=tuple(data.get("confidence_range", [0.5, 1.0])),
            metadata=data.get("metadata", {}),
        )


@dataclass
class GoldStandardQuery:
    """
    A validated query-response pair.

    Attributes:
        query_id: Unique identifier
        query_text: The query text
        expected: Expected response
        focus: Expert focus area
        topic_tags: Topic tags for categorization
        difficulty: Difficulty level (1-5)
        validated_by: Who validated this pair
        validated_at: When it was validated
        notes: Additional notes
    """

    query_id: str
    query_text: str
    expected: ExpectedResponse
    focus: ExpertFocus = ExpertFocus.MIXED
    topic_tags: List[str] = field(default_factory=list)
    difficulty: int = 3
    validated_by: str = ""
    validated_at: Optional[datetime] = None
    notes: str = ""

    def __post_init__(self):
        """Validate difficulty is in range 1-5."""
        if self.difficulty < 1:
            self.difficulty = 1
        elif self.difficulty > 5:
            self.difficulty = 5

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "query_id": self.query_id,
            "query_text": self.query_text,
            "expected": self.expected.to_dict(),
            "focus": self.focus.value,
            "topic_tags": self.topic_tags,
            "difficulty": self.difficulty,
            "validated_by": self.validated_by,
            "validated_at": self.validated_at.isoformat() if self.validated_at else None,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "GoldStandardQuery":
        """Create from dictionary."""
        validated_at = None
        if data.get("validated_at"):
            validated_at = datetime.fromisoformat(data["validated_at"])

        return cls(
            query_id=data["query_id"],
            query_text=data["query_text"],
            expected=ExpectedResponse.from_dict(data["expected"]),
            focus=ExpertFocus(data.get("focus", "mixed")),
            topic_tags=data.get("topic_tags", []),
            difficulty=data.get("difficulty", 3),
            validated_by=data.get("validated_by", ""),
            validated_at=validated_at,
            notes=data.get("notes", ""),
        )


@dataclass
class SimilarityScore:
    """
    Similarity score between expected and actual response.

    Attributes:
        semantic_score: Cosine similarity on embeddings (0-1)
        structural_score: Structural comparison score (0-1)
        concept_coverage: Percentage of key concepts found
        citation_coverage: Percentage of expected citations found
        expert_match: Percentage of expected experts that contributed
        overall_score: Weighted combination of all scores
    """

    semantic_score: float = 0.0
    structural_score: float = 0.0
    concept_coverage: float = 0.0
    citation_coverage: float = 0.0
    expert_match: float = 0.0
    overall_score: float = 0.0

    def to_dict(self) -> Dict[str, float]:
        """Convert to dictionary."""
        return {
            "semantic_score": self.semantic_score,
            "structural_score": self.structural_score,
            "concept_coverage": self.concept_coverage,
            "citation_coverage": self.citation_coverage,
            "expert_match": self.expert_match,
            "overall_score": self.overall_score,
        }

    def is_passing(self, threshold: float = 0.7) -> bool:
        """Check if score passes threshold."""
        return self.overall_score >= threshold


@dataclass
class QueryResult:
    """
    Result of running a single regression query.

    Attributes:
        query_id: Query identifier
        status: Pass/fail/degraded status
        actual_response: Actual response from pipeline
        similarity: Similarity scores
        previous_score: Previous baseline score (if available)
        score_change: Change from previous score
        latency_ms: Pipeline latency
        error_message: Error message if status is ERROR
        timestamp: When the test was run
    """

    query_id: str
    status: QueryStatus
    actual_response: Optional[str] = None
    similarity: Optional[SimilarityScore] = None
    previous_score: Optional[float] = None
    score_change: float = 0.0
    latency_ms: float = 0.0
    error_message: str = ""
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "query_id": self.query_id,
            "status": self.status.value,
            "actual_response": self.actual_response,
            "similarity": self.similarity.to_dict() if self.similarity else None,
            "previous_score": self.previous_score,
            "score_change": self.score_change,
            "latency_ms": self.latency_ms,
            "error_message": self.error_message,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class RegressionResult:
    """
    Overall regression test result.

    Attributes:
        total_queries: Total queries tested
        passed: Number passed
        failed: Number failed
        degraded: Number that degraded significantly
        improved: Number that improved
        errors: Number with pipeline errors
        results: Individual query results
    """

    total_queries: int = 0
    passed: int = 0
    failed: int = 0
    degraded: int = 0
    improved: int = 0
    errors: int = 0
    results: List[QueryResult] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        """Calculate pass rate."""
        if self.total_queries == 0:
            return 0.0
        return self.passed / self.total_queries

    @property
    def is_successful(self) -> bool:
        """Check if regression is successful (>90% pass rate, no degradations)."""
        return self.pass_rate >= 0.9 and self.degraded == 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "total_queries": self.total_queries,
            "passed": self.passed,
            "failed": self.failed,
            "degraded": self.degraded,
            "improved": self.improved,
            "errors": self.errors,
            "pass_rate": self.pass_rate,
            "is_successful": self.is_successful,
            "results": [r.to_dict() for r in self.results],
        }


@dataclass
class RegressionReport:
    """
    Full regression test report.

    Attributes:
        run_id: Unique run identifier
        suite_name: Name of the gold standard suite
        result: Regression results
        baseline_version: Previous baseline version for comparison
        current_version: Current system version
        started_at: When the run started
        completed_at: When the run completed
        metadata: Additional run metadata
    """

    run_id: str
    suite_name: str
    result: RegressionResult
    baseline_version: Optional[str] = None
    current_version: Optional[str] = None
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def duration_seconds(self) -> float:
        """Calculate run duration."""
        if not self.completed_at:
            return 0.0
        return (self.completed_at - self.started_at).total_seconds()

    def summary(self) -> str:
        """Generate human-readable summary."""
        status = "PASS" if self.result.is_successful else "FAIL"
        return (
            f"Regression Report [{status}]\n"
            f"Suite: {self.suite_name}\n"
            f"Queries: {self.result.total_queries}\n"
            f"Pass Rate: {self.result.pass_rate:.1%}\n"
            f"  - Passed: {self.result.passed}\n"
            f"  - Failed: {self.result.failed}\n"
            f"  - Degraded: {self.result.degraded}\n"
            f"  - Improved: {self.result.improved}\n"
            f"  - Errors: {self.result.errors}\n"
            f"Duration: {self.duration_seconds:.2f}s"
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "run_id": self.run_id,
            "suite_name": self.suite_name,
            "result": self.result.to_dict(),
            "baseline_version": self.baseline_version,
            "current_version": self.current_version,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration_seconds": self.duration_seconds,
            "metadata": self.metadata,
        }
