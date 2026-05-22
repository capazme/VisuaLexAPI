"""
Response Comparators for Regression Testing.

Provides semantic and structural comparison between expected and actual responses.
"""

import re
import structlog
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol

from .models import ExpectedResponse, SimilarityScore

log = structlog.get_logger()


class EmbeddingService(Protocol):
    """Protocol for embedding service."""

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for texts."""
        ...


def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if not vec1 or not vec2:
        return 0.0

    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    norm1 = sum(a * a for a in vec1) ** 0.5
    norm2 = sum(b * b for b in vec2) ** 0.5

    if norm1 == 0 or norm2 == 0:
        return 0.0

    return dot_product / (norm1 * norm2)


class ResponseComparator(ABC):
    """Abstract base class for response comparators."""

    @abstractmethod
    async def compare(
        self,
        expected: ExpectedResponse,
        actual_response: str,
        actual_metadata: Optional[Dict[str, Any]] = None,
    ) -> float:
        """
        Compare expected and actual responses.

        Args:
            expected: Expected response
            actual_response: Actual response text
            actual_metadata: Actual response metadata

        Returns:
            Similarity score (0-1)
        """
        ...


class SemanticComparator(ResponseComparator):
    """
    Semantic comparator using embedding similarity.

    Computes cosine similarity between embeddings of expected
    and actual response texts.
    """

    def __init__(self, embedding_service: Optional[EmbeddingService] = None):
        """
        Initialize comparator.

        Args:
            embedding_service: Service for generating embeddings
        """
        self.embedding_service = embedding_service

    async def compare(
        self,
        expected: ExpectedResponse,
        actual_response: str,
        actual_metadata: Optional[Dict[str, Any]] = None,
    ) -> float:
        """Compute semantic similarity using embeddings."""
        if not self.embedding_service:
            # Fallback to simple word overlap
            return self._word_overlap_similarity(
                expected.main_answer,
                actual_response,
            )

        try:
            embeddings = await self.embedding_service.embed([
                expected.main_answer,
                actual_response,
            ])

            if len(embeddings) >= 2:
                return cosine_similarity(embeddings[0], embeddings[1])

        except Exception as e:
            log.warning(
                "semantic_comparison_failed",
                error=str(e),
            )
            # Fallback to word overlap
            return self._word_overlap_similarity(
                expected.main_answer,
                actual_response,
            )

        return 0.0

    def _word_overlap_similarity(self, text1: str, text2: str) -> float:
        """Compute simple word overlap similarity as fallback."""
        words1 = set(self._tokenize(text1))
        words2 = set(self._tokenize(text2))

        if not words1 or not words2:
            return 0.0

        intersection = words1 & words2
        union = words1 | words2

        return len(intersection) / len(union)

    def _tokenize(self, text: str) -> List[str]:
        """Simple tokenization."""
        # Remove punctuation and lowercase
        text = re.sub(r"[^\w\s]", "", text.lower())
        # Split into words
        words = text.split()
        # Filter short words
        return [w for w in words if len(w) > 2]


class StructuralComparator(ResponseComparator):
    """
    Structural comparator for response components.

    Checks for presence of expected experts, citations,
    and key concepts in the actual response.
    """

    def __init__(
        self,
        expert_weight: float = 0.3,
        citation_weight: float = 0.3,
        concept_weight: float = 0.4,
    ):
        """
        Initialize comparator.

        Args:
            expert_weight: Weight for expert match
            citation_weight: Weight for citation coverage
            concept_weight: Weight for concept coverage

        Raises:
            ValueError: If weights are not in valid range
        """
        self.expert_weight = self._validate_weight(expert_weight, "expert_weight")
        self.citation_weight = self._validate_weight(citation_weight, "citation_weight")
        self.concept_weight = self._validate_weight(concept_weight, "concept_weight")

    def _validate_weight(self, weight: float, name: str) -> float:
        """Validate weight is in range 0-1."""
        if weight < 0:
            log.warning(f"{name}_clamped", original=weight, clamped=0.0)
            return 0.0
        if weight > 1:
            log.warning(f"{name}_clamped", original=weight, clamped=1.0)
            return 1.0
        return weight

    async def compare(
        self,
        expected: ExpectedResponse,
        actual_response: str,
        actual_metadata: Optional[Dict[str, Any]] = None,
    ) -> float:
        """Compute structural similarity."""
        actual_metadata = actual_metadata or {}

        # Check expert match
        expert_score = self._check_expert_match(
            expected.expected_experts,
            actual_metadata.get("contributing_experts", []),
        )

        # Check citation coverage
        citation_score = self._check_citation_coverage(
            expected.expected_citations,
            actual_response,
            actual_metadata.get("citations", []),
        )

        # Check concept coverage
        concept_score = self._check_concept_coverage(
            expected.key_concepts,
            actual_response,
        )

        # Weighted combination
        total = (
            expert_score * self.expert_weight +
            citation_score * self.citation_weight +
            concept_score * self.concept_weight
        )

        return total

    def _check_expert_match(
        self,
        expected_experts: List[str],
        actual_experts: List[str],
    ) -> float:
        """Check if expected experts contributed."""
        if not expected_experts:
            return 1.0  # No experts expected

        actual_set = set(e.lower() for e in actual_experts)
        expected_set = set(e.lower() for e in expected_experts)

        matched = len(expected_set & actual_set)
        return matched / len(expected_set)

    def _check_citation_coverage(
        self,
        expected_citations: List[str],
        actual_response: str,
        actual_citations: List[str],
    ) -> float:
        """Check if expected citations are present."""
        if not expected_citations:
            return 1.0  # No citations expected

        response_lower = actual_response.lower()
        actual_set = set(c.lower() for c in actual_citations)

        found = 0
        for citation in expected_citations:
            citation_lower = citation.lower()
            if citation_lower in response_lower or citation_lower in actual_set:
                found += 1

        return found / len(expected_citations)

    def _check_concept_coverage(
        self,
        expected_concepts: List[str],
        actual_response: str,
    ) -> float:
        """Check if key concepts appear in response."""
        if not expected_concepts:
            return 1.0  # No concepts expected

        response_lower = actual_response.lower()

        found = 0
        for concept in expected_concepts:
            # Check if concept appears (allowing some flexibility)
            concept_words = concept.lower().split()
            if all(word in response_lower for word in concept_words):
                found += 1

        return found / len(expected_concepts)


@dataclass
class ComparatorConfig:
    """Configuration for the combined comparator."""

    semantic_weight: float = 0.5
    structural_weight: float = 0.5
    pass_threshold: float = 0.7

    def __post_init__(self):
        """Validate weights are in valid range."""
        self.semantic_weight = max(0.0, min(1.0, self.semantic_weight))
        self.structural_weight = max(0.0, min(1.0, self.structural_weight))
        self.pass_threshold = max(0.0, min(1.0, self.pass_threshold))


class CombinedComparator:
    """
    Combined comparator using both semantic and structural comparison.

    Produces a full SimilarityScore with all components.
    """

    def __init__(
        self,
        semantic: Optional[SemanticComparator] = None,
        structural: Optional[StructuralComparator] = None,
        config: Optional[ComparatorConfig] = None,
    ):
        """
        Initialize combined comparator.

        Args:
            semantic: Semantic comparator
            structural: Structural comparator
            config: Comparator configuration
        """
        self.semantic = semantic or SemanticComparator()
        self.structural = structural or StructuralComparator()
        self.config = config or ComparatorConfig()

    async def compare(
        self,
        expected: ExpectedResponse,
        actual_response: str,
        actual_metadata: Optional[Dict[str, Any]] = None,
    ) -> SimilarityScore:
        """
        Compute full similarity score.

        Args:
            expected: Expected response
            actual_response: Actual response text
            actual_metadata: Actual response metadata

        Returns:
            Complete similarity score
        """
        actual_metadata = actual_metadata or {}

        # Semantic comparison
        semantic_score = await self.semantic.compare(
            expected, actual_response, actual_metadata
        )

        # Structural comparison
        structural_score = await self.structural.compare(
            expected, actual_response, actual_metadata
        )

        # Component scores
        concept_coverage = self.structural._check_concept_coverage(
            expected.key_concepts,
            actual_response,
        )
        citation_coverage = self.structural._check_citation_coverage(
            expected.expected_citations,
            actual_response,
            actual_metadata.get("citations", []),
        )
        expert_match = self.structural._check_expert_match(
            expected.expected_experts,
            actual_metadata.get("contributing_experts", []),
        )

        # Overall score
        overall = (
            semantic_score * self.config.semantic_weight +
            structural_score * self.config.structural_weight
        )

        return SimilarityScore(
            semantic_score=semantic_score,
            structural_score=structural_score,
            concept_coverage=concept_coverage,
            citation_coverage=citation_coverage,
            expert_match=expert_match,
            overall_score=overall,
        )
