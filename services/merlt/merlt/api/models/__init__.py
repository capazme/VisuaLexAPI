"""
MERL-T API Models
=================

Dataclass e modelli per API esterne.

Moduli:
- ingestion: Modelli per ingestion da fonti esterne

Esempio:
    >>> from merlt.api.models import ExternalIngestionRequest, IngestionResponse
    >>> from merlt.api.models.ingestion import IngestionTrigger, IngestionStatus
"""

from merlt.api.models.ingestion import (
    # Enums
    IngestionTrigger,
    IngestionStatus,
    RelationType,
    # Request models
    SuggestedRelation,
    ExternalIngestionRequest,
    # Response models
    GraphNodePreview,
    GraphRelationPreview,
    GraphPreview,
    IngestionResponse,
    # Constants
    CODICI_PRINCIPALI,
    AUTHORITY_AUTO_APPROVE_THRESHOLD,
    DEFAULT_REQUIRED_APPROVALS,
    PENDING_VALIDATION_TIMEOUT_DAYS,
)

__all__ = [
    # Enums
    "IngestionTrigger",
    "IngestionStatus",
    "RelationType",
    # Request models
    "SuggestedRelation",
    "ExternalIngestionRequest",
    # Response models
    "GraphNodePreview",
    "GraphRelationPreview",
    "GraphPreview",
    "IngestionResponse",
    # Constants
    "CODICI_PRINCIPALI",
    "AUTHORITY_AUTO_APPROVE_THRESHOLD",
    "DEFAULT_REQUIRED_APPROVALS",
    "PENDING_VALIDATION_TIMEOUT_DAYS",
]
