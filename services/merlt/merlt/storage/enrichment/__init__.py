"""
Live Enrichment Storage Module
===============================

Persistent storage for live enrichment with community validation.

Features:
- Entity & relation extraction with LLM
- User-uploaded documents (PDF, TXT)
- Amendment extraction (multivigenza)
- Community voting & consensus
- Domain authority tracking

Usage:
    from merlt.storage.enrichment import (
        init_db,
        get_db_session,
        PendingEntity,
        UserDocument,
        PendingAmendment,
    )

    # Initialize at startup
    await init_db()

    # Use in endpoints
    async with get_db_session() as session:
        entity = PendingEntity(
            entity_id="concetto:legittima_difesa",
            entity_type="concetto",
            entity_text="Legittima difesa",
            ...
        )
        session.add(entity)
        await session.commit()
"""

from merlt.storage.enrichment.models import (
    Base,
    PendingEntity,
    EntityVote,
    PendingRelation,
    RelationVote,
    UserDocument,
    PendingAmendment,
    AmendmentVote,
    UserDomainAuthority,
    # Issue Reporting (RLCF Feedback Loop)
    EntityIssueReport,
    EntityIssueVote,
    RelationIssueReport,
    RelationIssueVote,
)

from merlt.storage.enrichment.database import (
    init_db,
    close_db,
    create_tables,
    drop_tables,
    get_db_session,
    get_db_session_dependency,
    check_db_health,
    get_database_url,
)

from merlt.storage.enrichment.deduplication import (
    EntityDeduplicator,
    RelationDeduplicator,
    DeduplicationResult,
    DuplicateCandidate,
    DuplicateConfidence,
    RelationDeduplicationResult,
    check_entity_duplicate,
    check_relation_duplicate,
    normalize_text,
)

__all__ = [
    # Models
    "Base",
    "PendingEntity",
    "EntityVote",
    "PendingRelation",
    "RelationVote",
    "UserDocument",
    "PendingAmendment",
    "AmendmentVote",
    "UserDomainAuthority",
    # Issue Reporting
    "EntityIssueReport",
    "EntityIssueVote",
    "RelationIssueReport",
    "RelationIssueVote",
    # Database
    "init_db",
    "close_db",
    "create_tables",
    "drop_tables",
    "get_db_session",
    "get_db_session_dependency",
    "check_db_health",
    "get_database_url",
    # Deduplication
    "EntityDeduplicator",
    "RelationDeduplicator",
    "DeduplicationResult",
    "DuplicateCandidate",
    "DuplicateConfidence",
    "RelationDeduplicationResult",
    "check_entity_duplicate",
    "check_relation_duplicate",
    "normalize_text",
]
