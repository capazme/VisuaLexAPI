"""
RLCF Validation Module
======================

Modelli e utilities per validazione del knowledge graph.
Progettato per integrazione con frontend React/Vite via API JSON.

Esempio:
    from merlt.rlcf.validation import ValidationIssue, ValidationReport, IssueType

    issue = ValidationIssue(
        issue_id="dup-001",
        issue_type=IssueType.DUPLICATE,
        severity=IssueSeverity.HIGH,
        confidence=0.92,
        description="Nodi duplicati per 'buona fede'",
        affected_entities=["node-123", "node-456"]
    )

    # API-friendly JSON output
    response = issue.to_dict()
"""

from .models import (
    IssueSeverity,
    IssueType,
    ValidationIssue,
    ValidationReport,
    ValidationConfig,
    FixResult,
)

__all__ = [
    "IssueSeverity",
    "IssueType",
    "ValidationIssue",
    "ValidationReport",
    "ValidationConfig",
    "FixResult",
]
