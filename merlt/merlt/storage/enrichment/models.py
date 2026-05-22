"""
SQLAlchemy Models for Live Enrichment
======================================

Models for persistent storage of:
- Pending entities & relations (live enrichment)
- User-uploaded documents
- Amendments (multivigenza)
- Community votes & consensus
- Domain authority tracking

Usage:
    from merlt.storage.enrichment.models import PendingEntity, EntityVote
    from merlt.storage.enrichment.database import get_db_session

    async with get_db_session() as session:
        entity = PendingEntity(
            entity_id="concetto:legittima_difesa",
            article_urn="urn:nir:stato:codice.penale:...",
            entity_type="concetto",
            entity_text="Legittima difesa",
            ...
        )
        session.add(entity)
        await session.commit()
"""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    CheckConstraint,
    UniqueConstraint,
    ARRAY,
    Date,
    BigInteger,
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


# ====================================================
# 1. PENDING ENTITIES
# ====================================================
class PendingEntity(Base):
    """
    Pending legal entity awaiting community validation.

    Lifecycle:
        1. LLM extracts entity from article
        2. Saved as 'pending'
        3. Community votes (entity_votes)
        4. Consensus reached → approved/rejected
        5. If approved → written to FalkorDB
    """

    __tablename__ = "pending_entities"

    # Identity
    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_id = Column(String(100), unique=True, nullable=False)

    # Source
    article_urn = Column(String(300), nullable=False, index=True)
    source_type = Column(String(50), default="article")
    source_document_id = Column(Integer, ForeignKey("user_documents.id", ondelete="SET NULL"))

    # Entity data
    entity_type = Column(String(50), nullable=False, index=True)
    entity_text = Column(Text, nullable=False)
    descrizione = Column(Text)
    ambito = Column(String(50))
    fonte = Column(String(50), default="llm_extraction")

    # LLM metadata
    llm_confidence = Column(Float)
    llm_model = Column(String(100))
    llm_reasoning = Column(Text)

    # Validation status
    validation_status = Column(String(20), default="pending", index=True)
    approval_score = Column(Float, default=0.0)
    rejection_score = Column(Float, default=0.0)
    net_score = Column(Float, default=0.0, index=True)  # approval - rejection, can be negative
    votes_count = Column(Integer, default=0)
    consensus_reached = Column(Boolean, default=False, index=True)
    consensus_type = Column(String(20))  # 'approved' (net >= +2.0) or 'rejected' (net <= -2.0)

    # Contributor
    contributed_by = Column(String(100), index=True)
    contributor_authority = Column(Float)

    # Deduplication
    duplicate_check_mechanical = Column(Boolean, default=False)
    duplicate_check_llm = Column(Boolean, default=False)
    potential_duplicate_of = Column(String(100))

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    approved_at = Column(DateTime)
    written_to_graph_at = Column(DateTime)

    # Relationships
    votes = relationship("EntityVote", back_populates="entity", cascade="all, delete-orphan")
    source_document = relationship("UserDocument", back_populates="extracted_entities")

    __table_args__ = (
        CheckConstraint("llm_confidence >= 0 AND llm_confidence <= 1", name="check_llm_confidence"),
    )

    def __repr__(self):
        return f"<PendingEntity(id={self.entity_id}, type={self.entity_type}, status={self.validation_status})>"


# ====================================================
# 2. ENTITY VOTES
# ====================================================
class EntityVote(Base):
    """Community vote on a pending entity."""

    __tablename__ = "entity_votes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_id = Column(String(100), ForeignKey("pending_entities.entity_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(100), nullable=False, index=True)

    # Vote data
    vote_value = Column(Integer, nullable=False)  # -1 or 1
    vote_type = Column(String(20), nullable=False)  # 'accuracy' | 'utility' | 'duplicate'

    # Voter context
    voter_authority = Column(Float)
    voter_domain_authority = Column(Float)
    legal_domain = Column(String(50), index=True)

    # Reasoning
    comment = Column(Text)
    suggested_revision = Column(Text)
    duplicate_of_node_id = Column(String(100))

    # Timestamp
    created_at = Column(DateTime, default=func.now())

    # Relationships
    entity = relationship("PendingEntity", back_populates="votes")

    __table_args__ = (
        CheckConstraint("vote_value IN (-1, 1)", name="check_vote_value"),
        UniqueConstraint("entity_id", "user_id", "vote_type", name="unique_entity_user_vote"),
    )

    def __repr__(self):
        return f"<EntityVote(entity={self.entity_id}, user={self.user_id}, vote={self.vote_value})>"


# ====================================================
# 3. PENDING RELATIONS
# ====================================================
class PendingRelation(Base):
    """Pending semantic relation awaiting validation."""

    __tablename__ = "pending_relations"

    # Identity
    id = Column(Integer, primary_key=True, autoincrement=True)
    relation_id = Column(String(150), unique=True, nullable=False)

    # Source
    article_urn = Column(String(300), nullable=False, index=True)
    source_type = Column(String(50), default="article")
    source_document_id = Column(Integer, ForeignKey("user_documents.id", ondelete="SET NULL"))

    # Relation data
    relation_type = Column(String(100), nullable=False, index=True)
    source_node_urn = Column(String(300), nullable=False, index=True)
    target_entity_id = Column(String(100), nullable=False, index=True)

    # Target status tracking (for cascade logic)
    # If target is a pending entity, this is True. When target is rejected,
    # this relation goes back to pending status.
    target_is_pending = Column(Boolean, default=False, index=True)

    # Metadata
    relation_description = Column(Text)
    certezza = Column(Float)
    fonte = Column(String(50), default="llm_extraction")  # Source: llm_extraction, community, mechanistic
    llm_confidence = Column(Float)
    llm_model = Column(String(100))
    llm_reasoning = Column(Text)

    # Validation
    validation_status = Column(String(20), default="pending", index=True)
    approval_score = Column(Float, default=0.0)
    rejection_score = Column(Float, default=0.0)
    net_score = Column(Float, default=0.0, index=True)  # approval - rejection, can be negative
    votes_count = Column(Integer, default=0)
    consensus_reached = Column(Boolean, default=False)
    consensus_type = Column(String(20))  # 'approved' (net >= +2.0) or 'rejected' (net <= -2.0)

    # Contributor
    contributed_by = Column(String(100))
    contributor_authority = Column(Float)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    approved_at = Column(DateTime)
    written_to_graph_at = Column(DateTime)

    # Relationships
    votes = relationship("RelationVote", back_populates="relation", cascade="all, delete-orphan")
    source_document = relationship("UserDocument", back_populates="extracted_relations")

    __table_args__ = (
        CheckConstraint("certezza >= 0 AND certezza <= 1", name="check_certezza"),
    )

    def __repr__(self):
        return f"<PendingRelation(id={self.relation_id}, type={self.relation_type}, status={self.validation_status})>"


# ====================================================
# 4. RELATION VOTES
# ====================================================
class RelationVote(Base):
    """Community vote on a pending relation."""

    __tablename__ = "relation_votes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    relation_id = Column(String(150), ForeignKey("pending_relations.relation_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(100), nullable=False, index=True)

    vote_value = Column(Integer, nullable=False)
    vote_type = Column(String(20), nullable=False)

    voter_authority = Column(Float)
    voter_domain_authority = Column(Float)
    legal_domain = Column(String(50))

    comment = Column(Text)
    suggested_revision = Column(Text)

    created_at = Column(DateTime, default=func.now())

    # Relationships
    relation = relationship("PendingRelation", back_populates="votes")

    __table_args__ = (
        CheckConstraint("vote_value IN (-1, 1)", name="check_rel_vote_value"),
        UniqueConstraint("relation_id", "user_id", "vote_type", name="unique_relation_user_vote"),
    )

    def __repr__(self):
        return f"<RelationVote(relation={self.relation_id}, user={self.user_id}, vote={self.vote_value})>"


# ====================================================
# 5. USER DOCUMENTS
# ====================================================
class UserDocument(Base):
    """
    User-uploaded document for enrichment.

    Use cases:
    - Upload "Manuale Torrente" PDF → extract doctrine
    - Upload legal commentary → extract interpretations
    - Upload legislative text → extract amendments
    """

    __tablename__ = "user_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # File metadata
    filename = Column(String(500), nullable=False)
    original_filename = Column(String(500), nullable=False)
    file_type = Column(String(50), nullable=False)
    file_size_bytes = Column(BigInteger)
    file_hash = Column(String(64), unique=True, index=True)

    # Storage
    storage_path = Column(Text, nullable=False)

    # Classification
    document_type = Column(String(100), index=True)  # 'dottrina', 'manuale', 'sentenza', 'altro'
    legal_domain = Column(String(50))
    title = Column(Text)
    author = Column(Text)
    publication_year = Column(Integer)

    # Processing
    processing_status = Column(String(50), default="uploaded", index=True)
    processing_error = Column(Text)

    # Extraction results (cached)
    entities_extracted = Column(Integer, default=0)
    relations_extracted = Column(Integer, default=0)
    amendments_extracted = Column(Integer, default=0)

    # Contributor
    uploaded_by = Column(String(100), nullable=False, index=True)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    processing_started_at = Column(DateTime)
    processing_completed_at = Column(DateTime)

    # Relationships
    extracted_entities = relationship("PendingEntity", back_populates="source_document")
    extracted_relations = relationship("PendingRelation", back_populates="source_document")
    extracted_amendments = relationship("PendingAmendment", back_populates="source_document")

    def __repr__(self):
        return f"<UserDocument(id={self.id}, filename={self.filename}, status={self.processing_status})>"


# ====================================================
# 6. PENDING AMENDMENTS (Multivigenza)
# ====================================================
class PendingAmendment(Base):
    """
    Pending amendment (multivigenza) awaiting validation.

    Represents a modification to an existing article by another act.
    """

    __tablename__ = "pending_amendments"

    # Identity
    id = Column(Integer, primary_key=True, autoincrement=True)
    amendment_id = Column(String(150), unique=True, nullable=False)

    # Target
    target_article_urn = Column(String(300), nullable=False, index=True)

    # Modifying act
    atto_modificante_urn = Column(String(300), index=True)
    atto_modificante_estremi = Column(Text, nullable=False)

    # Parsed atto (from parse_estremi)
    tipo_atto = Column(String(100))
    tipo_documento = Column(String(100))
    data_atto = Column(Date)
    numero_atto = Column(String(50))

    # Disposizione
    disposizione = Column(Text, nullable=False)

    # Parsed disposizione (from parse_disposizione)
    numero_articolo_disposizione = Column(String(50))
    commi_disposizione = Column(ARRAY(Text))
    lettere_disposizione = Column(ARRAY(Text))
    numeri_disposizione = Column(ARRAY(Text))

    # Amendment type
    tipo_modifica = Column(String(50), nullable=False, index=True)  # 'ABROGA' | 'SOSTITUISCE' | etc.

    # Dates
    data_pubblicazione_gu = Column(Date)
    data_efficacia = Column(Date)

    # Source
    source_type = Column(String(50), default="manual")
    source_document_id = Column(Integer, ForeignKey("user_documents.id", ondelete="SET NULL"))

    # LLM extraction
    llm_confidence = Column(Float)
    llm_model = Column(String(100))
    llm_reasoning = Column(Text)

    # Validation
    validation_status = Column(String(20), default="pending", index=True)
    approval_score = Column(Float, default=0.0)
    rejection_score = Column(Float, default=0.0)
    net_score = Column(Float, default=0.0, index=True)  # approval - rejection, can be negative
    votes_count = Column(Integer, default=0)
    consensus_reached = Column(Boolean, default=False)
    consensus_type = Column(String(20))  # 'approved' (net >= +2.0) or 'rejected' (net <= -2.0)

    # Contributor
    contributed_by = Column(String(100), nullable=False)
    contributor_authority = Column(Float)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    approved_at = Column(DateTime)
    written_to_graph_at = Column(DateTime)

    # Relationships
    votes = relationship("AmendmentVote", back_populates="amendment", cascade="all, delete-orphan")
    source_document = relationship("UserDocument", back_populates="extracted_amendments")

    def __repr__(self):
        return f"<PendingAmendment(id={self.amendment_id}, type={self.tipo_modifica}, status={self.validation_status})>"


# ====================================================
# 7. AMENDMENT VOTES
# ====================================================
class AmendmentVote(Base):
    """Community vote on a pending amendment."""

    __tablename__ = "amendment_votes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    amendment_id = Column(String(150), ForeignKey("pending_amendments.amendment_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(100), nullable=False, index=True)

    vote_value = Column(Integer, nullable=False)
    vote_type = Column(String(20), nullable=False)

    voter_authority = Column(Float)
    voter_domain_authority = Column(Float)
    legal_domain = Column(String(50))

    comment = Column(Text)
    suggested_revision = Column(Text)

    created_at = Column(DateTime, default=func.now())

    # Relationships
    amendment = relationship("PendingAmendment", back_populates="votes")

    __table_args__ = (
        CheckConstraint("vote_value IN (-1, 1)", name="check_amend_vote_value"),
        UniqueConstraint("amendment_id", "user_id", "vote_type", name="unique_amendment_user_vote"),
    )

    def __repr__(self):
        return f"<AmendmentVote(amendment={self.amendment_id}, user={self.user_id}, vote={self.vote_value})>"


# ====================================================
# 8. USER DOMAIN AUTHORITY
# ====================================================
class UserDomainAuthority(Base):
    """
    User's domain-specific authority based on accuracy.

    Authority calculation:
        domain_authority = correct_feedbacks / total_feedbacks
        (with peer validation quorum)
    """

    __tablename__ = "user_domain_authority"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(100), nullable=False, index=True)
    legal_domain = Column(String(50), nullable=False, index=True)

    # Accuracy metrics
    total_feedbacks = Column(Integer, default=0)
    correct_feedbacks = Column(Integer, default=0)
    accuracy_score = Column(Float, default=0.0)

    # Authority
    domain_authority = Column(Float, default=0.5)  # Starts at 0.5

    # Timestamps
    last_calculated_at = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (UniqueConstraint("user_id", "legal_domain", name="unique_user_domain"),)

    def __repr__(self):
        return f"<UserDomainAuthority(user={self.user_id}, domain={self.legal_domain}, authority={self.domain_authority:.2f})>"


# ====================================================
# 9. ENTITY ISSUE REPORTS (RLCF Feedback Loop)
# ====================================================
class EntityIssueReport(Base):
    """
    Issue report on an entity (pending or approved) or a graph relation.

    Enables RLCF feedback loop:
        1. User spots issue in Knowledge Graph (node or relation)
        2. Creates issue report
        3. Community votes on issue validity
        4. If threshold reached → entity returns to 'needs_revision'

    Note:
        entity_id can be either:
        - A pending entity ID (e.g., "concetto:legittima_difesa")
        - A graph node_id (e.g., "urn:nir:stato:codice.penale~art52")
        - A relation ID (e.g., "rel_{source}_{type}_{target}")

        No FK constraint because relations and graph nodes don't exist in pending_entities.
    """

    __tablename__ = "entity_issue_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(String(100), unique=True, nullable=False, index=True)

    # Target entity or relation (no FK - can be pending entity, graph node, or relation)
    entity_id = Column(Text, nullable=False, index=True)
    entity_type = Column(String(50))

    # Reporter
    reported_by = Column(String(100), nullable=False, index=True)
    reporter_authority = Column(Float, default=0.0)

    # Issue classification
    issue_type = Column(String(50), nullable=False, index=True)
    # Types: factual_error, wrong_relation, wrong_type, duplicate, outdated,
    #        missing_relation, incomplete, improve_label, other
    severity = Column(String(20), default="medium")  # low, medium, high
    description = Column(Text)

    # Voting scores (weighted by authority)
    upvote_score = Column(Float, default=0.0)
    downvote_score = Column(Float, default=0.0)
    votes_count = Column(Integer, default=0)

    # Status
    status = Column(String(20), default="open", index=True)
    # Status: open, threshold_reached, dismissed, resolved

    # Resolution
    resolved_at = Column(DateTime)
    resolved_by = Column(String(100))
    resolution_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    votes = relationship("EntityIssueVote", back_populates="issue", cascade="all, delete-orphan")
    # Note: No relationship to PendingEntity - entity_id can reference pending entities,
    # graph nodes, or relations. Use entity_id to look up the target as needed.

    def __repr__(self):
        return f"<EntityIssueReport(id={self.issue_id}, entity={self.entity_id}, type={self.issue_type}, status={self.status})>"


class EntityIssueVote(Base):
    """Community vote on an entity issue report."""

    __tablename__ = "entity_issue_votes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(String(100), ForeignKey("entity_issue_reports.issue_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(100), nullable=False, index=True)

    # Vote: 1 = issue is valid, -1 = issue is not valid
    vote_value = Column(Integer, nullable=False)
    voter_authority = Column(Float, default=0.0)

    # Optional comment
    comment = Column(Text)

    # Timestamp
    created_at = Column(DateTime, default=func.now())

    # Relationships
    issue = relationship("EntityIssueReport", back_populates="votes")

    __table_args__ = (
        CheckConstraint("vote_value IN (-1, 1)", name="check_issue_vote_value"),
        UniqueConstraint("issue_id", "user_id", name="unique_issue_user_vote"),
    )

    def __repr__(self):
        return f"<EntityIssueVote(issue={self.issue_id}, user={self.user_id}, vote={self.vote_value})>"


# ====================================================
# 10. RELATION ISSUE REPORTS (RLCF Feedback Loop)
# ====================================================
class RelationIssueReport(Base):
    """Issue report on a relation (pending or approved)."""

    __tablename__ = "relation_issue_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(String(100), unique=True, nullable=False, index=True)

    # Target relation
    relation_id = Column(String(150), ForeignKey("pending_relations.relation_id", ondelete="CASCADE"), nullable=False, index=True)
    relation_type = Column(String(100))

    # Reporter
    reported_by = Column(String(100), nullable=False, index=True)
    reporter_authority = Column(Float, default=0.0)

    # Issue classification
    issue_type = Column(String(50), nullable=False, index=True)
    severity = Column(String(20), default="medium")
    description = Column(Text)

    # Voting scores
    upvote_score = Column(Float, default=0.0)
    downvote_score = Column(Float, default=0.0)
    votes_count = Column(Integer, default=0)

    # Status
    status = Column(String(20), default="open", index=True)

    # Resolution
    resolved_at = Column(DateTime)
    resolved_by = Column(String(100))
    resolution_notes = Column(Text)

    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    votes = relationship("RelationIssueVote", back_populates="issue", cascade="all, delete-orphan")
    relation = relationship("PendingRelation", backref="issues")

    def __repr__(self):
        return f"<RelationIssueReport(id={self.issue_id}, relation={self.relation_id}, type={self.issue_type})>"


class RelationIssueVote(Base):
    """Community vote on a relation issue report."""

    __tablename__ = "relation_issue_votes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    issue_id = Column(String(100), ForeignKey("relation_issue_reports.issue_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(100), nullable=False, index=True)

    vote_value = Column(Integer, nullable=False)
    voter_authority = Column(Float, default=0.0)
    comment = Column(Text)

    created_at = Column(DateTime, default=func.now())

    # Relationships
    issue = relationship("RelationIssueReport", back_populates="votes")

    __table_args__ = (
        CheckConstraint("vote_value IN (-1, 1)", name="check_rel_issue_vote_value"),
        UniqueConstraint("issue_id", "user_id", name="unique_rel_issue_user_vote"),
    )

    def __repr__(self):
        return f"<RelationIssueVote(issue={self.issue_id}, user={self.user_id}, vote={self.vote_value})>"


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "Base",
    "PendingEntity",
    "EntityVote",
    "PendingRelation",
    "RelationVote",
    "UserDocument",
    "PendingAmendment",
    "AmendmentVote",
    "UserDomainAuthority",
    "EntityIssueReport",
    "EntityIssueVote",
    "RelationIssueReport",
    "RelationIssueVote",
]
