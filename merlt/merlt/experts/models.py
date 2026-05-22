"""
SQLAlchemy Models for Expert System Q&A.
=========================================

Database models for storing Q&A traces, feedback, and API keys.

Tables:
- qa_traces: Query execution traces
- qa_feedback: Multi-level feedback (inline, detailed, source-specific, refinement)
- api_keys: API key credentials for external access (FR45)

Usage:
    from merlt.experts.models import QATrace, QAFeedback, ApiKey
    from merlt.rlcf.database import get_async_session

    async with get_async_session() as session:
        trace = QATrace(user_id="user123", query="Cos'è la legittima difesa?")
        session.add(trace)
        await session.commit()
"""

import hashlib
from datetime import datetime
from typing import Optional, List
from uuid import uuid4

from sqlalchemy import (
    Column, String, Text, Integer, Float, DateTime, ForeignKey, Boolean,
    CheckConstraint, Index,
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from merlt.rlcf.database import Base


class AggregatedFeedback(Base):
    """
    Aggregated feedback results per component over a time period.

    Stores periodic aggregation output from FeedbackAggregationService.
    """
    __tablename__ = "aggregated_feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    component = Column(String(50), nullable=False, index=True)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    avg_rating = Column(Float, nullable=True)
    authority_weighted_avg = Column(Float, nullable=True)
    disagreement_score = Column(Float, nullable=True)
    total_feedback = Column(Integer, nullable=True)
    details = Column(JSONB, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class QATrace(Base):
    """
    Trace di esecuzione query Q&A.

    Registra ogni query sottomessa al MultiExpertOrchestrator,
    gli expert selezionati, la modalità di sintesi, e i risultati.

    Attributes:
        trace_id: UUID unico per il trace
        user_id: ID utente che ha fatto la query
        query: Testo della query originale
        selected_experts: Lista expert utilizzati (es: ['literal', 'systemic'])
        synthesis_mode: convergent | divergent
        synthesis_text: Testo della sintesi finale
        sources: Array JSONB delle fonti citate con metadata
        execution_time_ms: Tempo di esecuzione in millisecondi
        created_at: Timestamp creazione
        consent_level: Livello consenso storage (anonymous, basic, full)
        query_type: Tipo query (definitional, interpretive, etc.)
        confidence: Punteggio confidenza finale [0-1]
        routing_method: Metodo routing (neural, llm_fallback)
        is_archived: Flag per archiviazione trace
        archived_at: Timestamp archiviazione

    Example:
        >>> trace = QATrace(
        ...     user_id="user123",
        ...     query="Cos'è la responsabilità contrattuale?",
        ...     selected_experts=["literal", "systemic"],
        ...     synthesis_mode="convergent",
        ...     synthesis_text="La responsabilità contrattuale...",
        ...     sources=[{"article_urn": "...", "expert": "literal", "relevance": 0.95}],
        ...     execution_time_ms=2450,
        ...     consent_level="basic",
        ...     query_type="definitional",
        ...     confidence=0.85,
        ...     routing_method="neural"
        ... )
    """
    __tablename__ = "qa_traces"

    # Primary key
    trace_id = Column(
        String(50),
        primary_key=True,
        default=lambda: f"trace_{uuid4().hex[:12]}"
    )

    # User (indexed via idx_qa_traces_user in __table_args__)
    user_id = Column(String(50), nullable=False)

    # Query details
    query = Column(Text, nullable=False)
    selected_experts = Column(ARRAY(String(100)), nullable=True)  # ['literal', 'systemic', ...]

    # Synthesis results
    synthesis_mode = Column(String(20), nullable=True)  # convergent | divergent
    synthesis_text = Column(Text, nullable=True)
    sources = Column(JSONB, nullable=True)  # [{"article_urn": "...", "expert": "...", "relevance": ...}]

    # Performance
    execution_time_ms = Column(Integer, nullable=True)

    # Full scientific pipeline trace (JSON)
    full_trace = Column(JSONB, nullable=True)

    # Consent-aware storage (Story 5-1, indexed via idx_qa_traces_consent)
    consent_level = Column(
        String(20),
        nullable=False,
        server_default="basic"
    )
    query_type = Column(String(50), nullable=True)  # definitional, interpretive, comparative, etc.
    confidence = Column(Float, nullable=True)  # Final confidence score [0-1]
    routing_method = Column(String(30), nullable=True)  # neural, llm_fallback, regex

    # Archival (Story 5-1)
    is_archived = Column(Boolean, nullable=False, server_default="false")
    archived_at = Column(DateTime, nullable=True)

    # Timestamps
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    # Relationships
    feedbacks = relationship("QAFeedback", back_populates="trace", cascade="all, delete-orphan")

    # Constraints
    __table_args__ = (
        CheckConstraint(
            "synthesis_mode IS NULL OR synthesis_mode IN ('convergent', 'divergent')",
            name="chk_synthesis_mode"
        ),
        CheckConstraint(
            "consent_level IN ('anonymous', 'basic', 'full')",
            name="chk_consent_level"
        ),
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="chk_confidence"
        ),
        Index("idx_qa_traces_user", "user_id"),
        Index("idx_qa_traces_created", "created_at"),
        Index("idx_qa_traces_user_created", "user_id", "created_at"),
        Index("idx_qa_traces_query_type", "query_type"),
        Index("idx_qa_traces_archived", "is_archived"),
        Index("idx_qa_traces_consent", "consent_level"),
    )

    def __repr__(self) -> str:
        return f"<QATrace(trace_id={self.trace_id}, query={self.query[:50]}...)>"


class QAFeedback(Base):
    """
    Feedback multi-livello per query Q&A.

    Supporta 5 tipi di feedback:
    1. Inline rating (quick thumbs up/down): inline_rating
    2. Detailed form (3 dimensions): retrieval_score, reasoning_score, synthesis_score
    3. Per-source rating: source_id + source_relevance
    4. Conversational refinement: follow_up_query + refined_trace_id
    5. Expert preference (for divergent mode): preferred_expert

    Un singolo record può contenere uno o più tipi di feedback.

    Attributes:
        id: Primary key auto-increment
        trace_id: FK to qa_traces
        user_id: ID utente che fornisce feedback

        # Type 1: Inline
        inline_rating: 1-5 (1=thumbs down, 5=thumbs up)

        # Type 2: Detailed
        retrieval_score: 0-1 (qualità retrieval)
        reasoning_score: 0-1 (qualità reasoning)
        synthesis_score: 0-1 (qualità sintesi)
        detailed_comment: Commento testuale opzionale

        # Type 3: Per-source
        source_id: URN dell'articolo citato
        source_relevance: 1-5 stars

        # Type 4: Refinement
        follow_up_query: Nuova query di approfondimento
        refined_trace_id: Link al trace generato dal follow-up

        user_authority: Authority dell'utente (per weighted feedback)
        created_at: Timestamp feedback

    Example Type 1 (Inline):
        >>> feedback = QAFeedback(
        ...     trace_id="trace_abc123",
        ...     user_id="user456",
        ...     inline_rating=5  # thumbs up
        ... )

    Example Type 2 (Detailed):
        >>> feedback = QAFeedback(
        ...     trace_id="trace_abc123",
        ...     user_id="user456",
        ...     retrieval_score=0.8,
        ...     reasoning_score=0.9,
        ...     synthesis_score=0.7,
        ...     detailed_comment="Buona risposta ma sintesi migliorabile"
        ... )

    Example Type 3 (Per-source):
        >>> feedback = QAFeedback(
        ...     trace_id="trace_abc123",
        ...     user_id="user456",
        ...     source_id="urn:nir:stato:codice.civile:1942;art1453",
        ...     source_relevance=5  # 5 stars
        ... )

    Example Type 4 (Refinement):
        >>> feedback = QAFeedback(
        ...     trace_id="trace_abc123",
        ...     user_id="user456",
        ...     follow_up_query="Puoi spiegare meglio il requisito della proporzione?",
        ...     refined_trace_id="trace_def456"
        ... )

    Example Type 5 (Expert Preference):
        >>> feedback = QAFeedback(
        ...     trace_id="trace_abc123",
        ...     user_id="user456",
        ...     preferred_expert="systemic",
        ...     detailed_comment="L'interpretazione sistematica e' piu' completa"
        ... )
    """
    __tablename__ = "qa_feedback"

    # Primary key
    id = Column(Integer, primary_key=True, autoincrement=True)

    # Foreign keys
    trace_id = Column(
        String(50),
        ForeignKey("qa_traces.trace_id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    user_id = Column(String(50), nullable=False, index=True)

    # Type 1: Inline rating (quick thumbs)
    inline_rating = Column(Integer, nullable=True)  # 1-5

    # Type 2: Detailed form (3 dimensions)
    retrieval_score = Column(Float, nullable=True)  # 0-1
    reasoning_score = Column(Float, nullable=True)  # 0-1
    synthesis_score = Column(Float, nullable=True)  # 0-1
    detailed_comment = Column(Text, nullable=True)

    # Type 3: Per-source rating
    source_id = Column(String(200), nullable=True)  # article URN
    source_relevance = Column(Integer, nullable=True)  # 1-5 stars

    # Type 4: Conversational refinement
    follow_up_query = Column(Text, nullable=True)
    refined_trace_id = Column(String(50), nullable=True)  # Link to new trace

    # Type 5: Expert preference (for divergent mode)
    preferred_expert = Column(String(50), nullable=True)  # literal, systemic, principles, precedent

    # User authority (for weighted feedback)
    user_authority = Column(Float, nullable=True)

    # Quarantine/moderation (Story 9-5)
    status = Column(String(20), nullable=False, server_default="approved")  # approved/flagged/quarantined/deleted
    quarantine_reason = Column(Text, nullable=True)
    flagged_at = Column(DateTime, nullable=True)
    flagged_by = Column(String(50), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by = Column(String(50), nullable=True)

    # Timestamp
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    # Relationships
    trace = relationship("QATrace", back_populates="feedbacks")

    # Constraints
    __table_args__ = (
        CheckConstraint(
            "inline_rating IS NULL OR (inline_rating >= 1 AND inline_rating <= 5)",
            name="chk_inline_rating"
        ),
        CheckConstraint(
            "retrieval_score IS NULL OR (retrieval_score >= 0 AND retrieval_score <= 1)",
            name="chk_retrieval_score"
        ),
        CheckConstraint(
            "reasoning_score IS NULL OR (reasoning_score >= 0 AND reasoning_score <= 1)",
            name="chk_reasoning_score"
        ),
        CheckConstraint(
            "synthesis_score IS NULL OR (synthesis_score >= 0 AND synthesis_score <= 1)",
            name="chk_synthesis_score"
        ),
        CheckConstraint(
            "source_relevance IS NULL OR (source_relevance >= 1 AND source_relevance <= 5)",
            name="chk_source_relevance"
        ),
        CheckConstraint(
            "status IN ('approved', 'flagged', 'quarantined', 'deleted')",
            name="chk_feedback_status"
        ),
        Index("idx_qa_feedback_trace", "trace_id"),
        Index("idx_qa_feedback_user", "user_id"),
        Index("idx_qa_feedback_type", "inline_rating", "retrieval_score", "source_relevance"),
        Index("idx_qa_feedback_status", "status"),
    )

    def __repr__(self) -> str:
        feedback_type = "unknown"
        if self.inline_rating is not None:
            feedback_type = f"inline_{self.inline_rating}"
        elif self.retrieval_score is not None:
            feedback_type = "detailed"
        elif self.source_id is not None:
            feedback_type = "per_source"
        elif self.follow_up_query is not None:
            feedback_type = "refinement"
        elif self.preferred_expert is not None:
            feedback_type = f"preference_{self.preferred_expert}"

        return f"<QAFeedback(id={self.id}, trace_id={self.trace_id}, type={feedback_type})>"


class AuditLogEntry(Base):
    """
    Immutable audit log for RLCF feedback operations.

    Hash chain: each entry includes prev_hash for tamper detection.
    Actor IDs are SHA-256 hashed for privacy.
    """
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, nullable=False, server_default=func.now())
    action = Column(String(20), nullable=False)  # CREATE, UPDATE, DELETE
    actor_hash = Column(String(64), nullable=False)  # SHA-256 of user_id
    resource_type = Column(String(50), nullable=False)  # feedback, trace, etc.
    resource_id = Column(String(100), nullable=False)
    content_hash = Column(String(64), nullable=True)  # SHA-256 of payload
    consent_level = Column(String(20), nullable=True)
    prev_hash = Column(String(64), nullable=True)  # hash chain link
    details = Column(JSONB, nullable=True)

    __table_args__ = (
        Index("idx_audit_log_timestamp", "timestamp"),
        Index("idx_audit_log_action", "action"),
        Index("idx_audit_log_resource", "resource_type", "resource_id"),
    )

    def __repr__(self) -> str:
        return f"<AuditLogEntry(id={self.id}, action={self.action}, resource={self.resource_type})>"


class DevilsAdvocateLog(Base):
    """
    Persistent log of Devil's Advocate triggers and feedback.

    Replaces in-memory deque for durability across restarts.
    """
    __tablename__ = "devils_advocate_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    trace_id = Column(String(50), nullable=False, index=True)
    triggered_at = Column(DateTime, nullable=False, server_default=func.now())
    critical_prompt = Column(Text, nullable=True)
    feedback_text = Column(Text, nullable=True)
    assessment = Column(String(20), nullable=True)  # valid, weak, interesting
    engagement_score = Column(Float, nullable=True)
    keywords_found = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_da_log_trace", "trace_id"),
        Index("idx_da_log_created", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<DevilsAdvocateLog(id={self.id}, trace_id={self.trace_id})>"


class IngestionSchedule(Base):
    """
    Scheduled ingestion job configuration.

    Stores cron-based or interval-based schedules for automatic
    norm ingestion from external sources.
    """
    __tablename__ = "ingestion_schedules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tipo_atto = Column(String(100), nullable=False)
    cron_expr = Column(String(100), nullable=False)  # cron expression e.g. "0 3 * * *"
    enabled = Column(Boolean, nullable=False, server_default="true")
    description = Column(Text, nullable=True)
    last_run_at = Column(DateTime, nullable=True)
    last_run_status = Column(String(20), nullable=True)  # success, failed, running
    next_run_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=True, onupdate=func.now())

    __table_args__ = (
        Index("idx_ingestion_schedules_tipo", "tipo_atto"),
        Index("idx_ingestion_schedules_enabled", "enabled"),
    )

    def __repr__(self) -> str:
        return f"<IngestionSchedule(id={self.id}, tipo_atto={self.tipo_atto}, enabled={self.enabled})>"


class ApiKey(Base):
    """
    API key for external access (FR45).

    Stores hashed API keys with role-based access control and rate limit tiers.
    Raw key is returned only once on creation (never stored).
    """
    __tablename__ = "api_keys"

    key_id = Column(String(50), primary_key=True)
    api_key_hash = Column(String(64), nullable=False, unique=True, index=True)
    role = Column(String(20), server_default="user")  # admin / user / guest
    rate_limit_tier = Column(String(20), server_default="standard")  # unlimited / premium / standard / limited
    is_active = Column(Boolean, server_default="true")
    expires_at = Column(DateTime, nullable=True)
    user_id = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    last_used_at = Column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "role IN ('admin', 'user', 'guest')",
            name="chk_api_key_role"
        ),
        CheckConstraint(
            "rate_limit_tier IN ('unlimited', 'premium', 'standard', 'limited')",
            name="chk_api_key_tier"
        ),
        Index("idx_api_keys_user", "user_id"),
        Index("idx_api_keys_active", "is_active"),
    )

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return datetime.utcnow() > self.expires_at

    def __repr__(self) -> str:
        return f"<ApiKey(key_id={self.key_id}, role={self.role}, active={self.is_active})>"
