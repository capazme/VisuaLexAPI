"""
Gold Standard Suite Management.

Provides CRUD operations for managing validated query-response pairs.
"""

import json
import uuid
import structlog
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import (
    GoldStandardQuery,
    ExpectedResponse,
    ExpertFocus,
)

log = structlog.get_logger()


@dataclass
class SuiteConfig:
    """
    Configuration for gold standard suite.

    Attributes:
        name: Suite name
        description: Suite description
        version: Suite version
        pass_threshold: Score threshold for passing
        degradation_threshold: Score drop threshold for degradation alert
        created_at: Creation timestamp
    """

    name: str = "default"
    description: str = "Gold Standard Test Suite"
    version: str = "1.0.0"
    pass_threshold: float = 0.7
    degradation_threshold: float = 0.1  # 10% drop triggers degradation
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "pass_threshold": self.pass_threshold,
            "degradation_threshold": self.degradation_threshold,
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SuiteConfig":
        """Create from dictionary."""
        created_at = datetime.now()
        if data.get("created_at"):
            created_at = datetime.fromisoformat(data["created_at"])

        return cls(
            name=data.get("name", "default"),
            description=data.get("description", ""),
            version=data.get("version", "1.0.0"),
            pass_threshold=data.get("pass_threshold", 0.7),
            degradation_threshold=data.get("degradation_threshold", 0.1),
            created_at=created_at,
        )


class GoldStandardSuite:
    """
    Manager for gold standard query-response pairs.

    Provides CRUD operations and persistence for the test suite.

    Example:
        >>> suite = GoldStandardSuite("legal_tests")
        >>> suite.add_query(
        ...     query_text="Cos'è la risoluzione del contratto?",
        ...     expected=ExpectedResponse(main_answer="La risoluzione...", ...)
        ... )
        >>> suite.save("gold_standard.json")
    """

    def __init__(self, config: Optional[SuiteConfig] = None):
        """
        Initialize suite.

        Args:
            config: Suite configuration
        """
        self.config = config or SuiteConfig()
        self._queries: Dict[str, GoldStandardQuery] = {}
        self._baseline_scores: Dict[str, float] = {}

        log.info(
            "gold_standard_suite_initialized",
            name=self.config.name,
            version=self.config.version,
        )

    @property
    def queries(self) -> List[GoldStandardQuery]:
        """Get all queries."""
        return list(self._queries.values())

    @property
    def query_count(self) -> int:
        """Get number of queries."""
        return len(self._queries)

    def add_query(
        self,
        query_text: str,
        expected: ExpectedResponse,
        focus: ExpertFocus = ExpertFocus.MIXED,
        topic_tags: Optional[List[str]] = None,
        difficulty: int = 3,
        validated_by: str = "",
        notes: str = "",
        query_id: Optional[str] = None,
    ) -> GoldStandardQuery:
        """
        Add a new validated query.

        Args:
            query_text: The query text
            expected: Expected response
            focus: Expert focus area
            topic_tags: Topic tags
            difficulty: Difficulty level (1-5)
            validated_by: Validator name
            notes: Additional notes
            query_id: Custom query ID (auto-generated if not provided)

        Returns:
            The created query
        """
        query_id = query_id or str(uuid.uuid4())[:8]

        query = GoldStandardQuery(
            query_id=query_id,
            query_text=query_text,
            expected=expected,
            focus=focus,
            topic_tags=topic_tags or [],
            difficulty=difficulty,
            validated_by=validated_by,
            validated_at=datetime.now(),
            notes=notes,
        )

        self._queries[query_id] = query

        log.info(
            "gold_standard_query_added",
            query_id=query_id,
            focus=focus.value,
        )

        return query

    def get_query(self, query_id: str) -> Optional[GoldStandardQuery]:
        """Get query by ID."""
        return self._queries.get(query_id)

    def update_query(
        self,
        query_id: str,
        expected: Optional[ExpectedResponse] = None,
        topic_tags: Optional[List[str]] = None,
        notes: Optional[str] = None,
    ) -> Optional[GoldStandardQuery]:
        """
        Update an existing query.

        Args:
            query_id: Query ID to update
            expected: New expected response
            topic_tags: New topic tags
            notes: New notes

        Returns:
            Updated query or None if not found
        """
        query = self._queries.get(query_id)
        if not query:
            return None

        if expected is not None:
            query.expected = expected
        if topic_tags is not None:
            query.topic_tags = topic_tags
        if notes is not None:
            query.notes = notes

        query.validated_at = datetime.now()

        log.info("gold_standard_query_updated", query_id=query_id)
        return query

    def remove_query(self, query_id: str) -> bool:
        """
        Remove a query.

        Args:
            query_id: Query ID to remove

        Returns:
            True if removed, False if not found
        """
        if query_id in self._queries:
            del self._queries[query_id]
            if query_id in self._baseline_scores:
                del self._baseline_scores[query_id]
            log.info("gold_standard_query_removed", query_id=query_id)
            return True
        return False

    def get_by_focus(self, focus: ExpertFocus) -> List[GoldStandardQuery]:
        """Get queries by focus area."""
        return [q for q in self._queries.values() if q.focus == focus]

    def get_by_tag(self, tag: str) -> List[GoldStandardQuery]:
        """Get queries by topic tag."""
        return [q for q in self._queries.values() if tag in q.topic_tags]

    def get_by_difficulty(self, min_difficulty: int, max_difficulty: int) -> List[GoldStandardQuery]:
        """Get queries by difficulty range."""
        return [
            q for q in self._queries.values()
            if min_difficulty <= q.difficulty <= max_difficulty
        ]

    def set_baseline_score(self, query_id: str, score: float):
        """Set baseline score for a query."""
        self._baseline_scores[query_id] = score

    def get_baseline_score(self, query_id: str) -> Optional[float]:
        """Get baseline score for a query."""
        return self._baseline_scores.get(query_id)

    def save(self, path: str):
        """
        Save suite to JSON file.

        Args:
            path: File path
        """
        data = {
            "config": self.config.to_dict(),
            "queries": [q.to_dict() for q in self._queries.values()],
            "baseline_scores": self._baseline_scores,
        }

        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        log.info(
            "gold_standard_suite_saved",
            path=path,
            query_count=len(self._queries),
        )

    @classmethod
    def load(cls, path: str) -> "GoldStandardSuite":
        """
        Load suite from JSON file.

        Args:
            path: File path

        Returns:
            Loaded suite
        """
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        config = SuiteConfig.from_dict(data.get("config", {}))
        suite = cls(config=config)

        for q_data in data.get("queries", []):
            query = GoldStandardQuery.from_dict(q_data)
            suite._queries[query.query_id] = query

        suite._baseline_scores = data.get("baseline_scores", {})

        log.info(
            "gold_standard_suite_loaded",
            path=path,
            query_count=len(suite._queries),
        )

        return suite

    def export(self, path: str, format: str = "json"):
        """
        Export suite for backup.

        Args:
            path: Export file path
            format: Export format (json, csv)
        """
        if format == "json":
            self.save(path)
        elif format == "csv":
            import csv
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow([
                    "query_id", "query_text", "focus", "difficulty",
                    "expected_answer", "expected_experts", "topic_tags"
                ])
                for q in self._queries.values():
                    writer.writerow([
                        q.query_id,
                        q.query_text,
                        q.focus.value,
                        q.difficulty,
                        q.expected.main_answer[:200],
                        ",".join(q.expected.expected_experts),
                        ",".join(q.topic_tags),
                    ])
            log.info("gold_standard_suite_exported", path=path, format=format)
        else:
            raise ValueError(f"Unsupported export format: {format}")

    @classmethod
    def import_from(cls, path: str, format: str = "json") -> "GoldStandardSuite":
        """
        Import suite from backup.

        Args:
            path: Import file path
            format: Import format

        Returns:
            Imported suite
        """
        if format == "json":
            return cls.load(path)
        else:
            raise ValueError(f"Unsupported import format: {format}")

    def to_dict(self) -> Dict[str, Any]:
        """Convert entire suite to dictionary."""
        return {
            "config": self.config.to_dict(),
            "queries": [q.to_dict() for q in self._queries.values()],
            "baseline_scores": self._baseline_scores,
            "query_count": self.query_count,
        }
