"""
RLCF Persistence Layer
======================

Storage persistente per ExecutionTrace, MultilevelFeedback e Policy checkpoints.

Questo modulo fornisce:
1. Modelli SQLAlchemy per storage PostgreSQL
2. Service per CRUD operations
3. Query per training data retrieval

Flusso dati tipico:
    Query → Expert → ExecutionTrace (saved) → User Feedback → MultilevelFeedback (saved)
                                                                    ↓
                                                            Training Loop (reads traces + feedback)
                                                                    ↓
                                                            PolicyCheckpoint (saved)

Esempio:
    >>> from merlt.rlcf.persistence import RLCFPersistence
    >>>
    >>> async with RLCFPersistence() as persistence:
    ...     # Salva trace
    ...     trace_id = await persistence.save_trace(execution_trace)
    ...
    ...     # Salva feedback associato
    ...     await persistence.save_feedback(trace_id, multilevel_feedback)
    ...
    ...     # Recupera dati per training
    ...     training_data = await persistence.get_training_data(
    ...         min_feedback_count=10,
    ...         policy_version="v1.0.0"
    ...     )
"""

import structlog
from datetime import datetime, UTC
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import asdict
import json
import uuid

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
    Index,
    select,
    func,
    JSON as GenericJSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator

from .database import Base, get_async_session, init_async_db
from .execution_trace import ExecutionTrace, Action
from .multilevel_feedback import MultilevelFeedback

log = structlog.get_logger()


# =============================================================================
# JSON TYPE COMPATIBLE WITH SQLITE AND POSTGRESQL
# =============================================================================

class JSONType(TypeDecorator):
    """
    JSON type che funziona sia con SQLite che PostgreSQL.

    Usa JSONB su PostgreSQL per performance, JSON su SQLite per compatibilità.
    """
    impl = GenericJSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            from sqlalchemy.dialects.postgresql import JSONB
            return dialect.type_descriptor(JSONB())
        else:
            return dialect.type_descriptor(GenericJSON())

    def process_bind_param(self, value, dialect):
        if value is not None:
            return value
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            return value
        return value


class RLCFTrace(Base):
    """
    Persistenza di ExecutionTrace.

    Traccia tutte le azioni (expert_selection, graph_traversal, tool_use)
    eseguite durante l'elaborazione di una query, con log_probs per REINFORCE.

    Attributes:
        id: UUID del trace
        query_id: ID della query originale
        query_text: Testo della query (per debug)
        policy_version: Versione della policy che ha generato il trace
        expert_type: Expert principale usato
        actions_json: Lista di azioni serializzate
        total_log_prob: Somma log probabilities
        metadata_json: Metadati aggiuntivi
        created_at: Timestamp creazione
        has_feedback: True se esiste feedback associato
    """
    __tablename__ = "rlcf_traces"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    query_id = Column(String(100), nullable=False, index=True)
    query_text = Column(Text, nullable=True)
    policy_version = Column(String(50), nullable=True, index=True)
    expert_type = Column(String(50), nullable=True, index=True)

    # Actions stored as JSON array
    actions_json = Column(JSONType, nullable=False, default=list)
    total_log_prob = Column(Float, default=0.0)
    num_actions = Column(Integer, default=0)

    # Metadata
    metadata_json = Column(JSONType, nullable=True, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    has_feedback = Column(Boolean, default=False, index=True)

    # Relationships
    feedbacks = relationship("RLCFFeedback", back_populates="trace")

    # Indices for efficient queries
    __table_args__ = (
        Index('ix_rlcf_traces_policy_created', 'policy_version', 'created_at'),
        Index('ix_rlcf_traces_feedback_status', 'has_feedback', 'created_at'),
    )

    def to_execution_trace(self) -> ExecutionTrace:
        """Converti in ExecutionTrace dataclass."""
        actions = [
            Action.from_dict(a) for a in (self.actions_json or [])
        ]

        trace = ExecutionTrace(
            query_id=self.query_id,
            actions=actions,
            total_log_prob=self.total_log_prob,
            metadata=self.metadata_json or {},
            created_at=self.created_at.isoformat() if self.created_at else None
        )

        return trace

    @classmethod
    def from_execution_trace(
        cls,
        trace: ExecutionTrace,
        policy_version: Optional[str] = None,
        query_text: Optional[str] = None,
        expert_type: Optional[str] = None
    ) -> "RLCFTrace":
        """Crea da ExecutionTrace dataclass."""
        return cls(
            query_id=trace.query_id,
            query_text=query_text,
            policy_version=policy_version,
            expert_type=expert_type,
            actions_json=[a.to_dict() for a in trace.actions],
            total_log_prob=trace.total_log_prob,
            num_actions=len(trace.actions),
            metadata_json=trace.metadata
        )


class RLCFFeedback(Base):
    """
    Persistenza di MultilevelFeedback.

    Feedback strutturato su 3 livelli collegato a un trace specifico.

    Attributes:
        id: UUID del feedback
        trace_id: FK al trace associato
        user_id: ID utente che ha dato feedback (da VisuaLex SSO)
        user_authority: Authority score dell'utente al momento del feedback

        # Retrieval level
        retrieval_precision: Precision [0-1]
        retrieval_recall: Recall [0-1]
        retrieval_ranking: Ranking quality [0-1]

        # Reasoning level
        reasoning_coherence: Logical coherence [0-1]
        reasoning_soundness: Legal soundness [0-1]
        reasoning_citation: Citation quality [0-1]

        # Synthesis level
        synthesis_clarity: Clarity [0-1]
        synthesis_completeness: Completeness [0-1]
        synthesis_usefulness: Usefulness [0-1]

        overall_score: Score complessivo calcolato
        feedback_json: Feedback completo serializzato
    """
    __tablename__ = "rlcf_feedback"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    trace_id = Column(String(36), ForeignKey("rlcf_traces.id"), nullable=False, index=True)
    user_id = Column(String(100), nullable=True, index=True)
    user_authority = Column(Float, default=0.5)

    # Retrieval metrics (denormalized for query efficiency)
    retrieval_precision = Column(Float, nullable=True)
    retrieval_recall = Column(Float, nullable=True)
    retrieval_ranking = Column(Float, nullable=True)

    # Reasoning metrics
    reasoning_coherence = Column(Float, nullable=True)
    reasoning_soundness = Column(Float, nullable=True)
    reasoning_citation = Column(Float, nullable=True)

    # Synthesis metrics
    synthesis_clarity = Column(Float, nullable=True)
    synthesis_completeness = Column(Float, nullable=True)
    synthesis_usefulness = Column(Float, nullable=True)

    # Computed score
    overall_score = Column(Float, nullable=True)

    # Full feedback JSON for complete data
    feedback_json = Column(JSONType, nullable=False)

    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    source = Column(String(50), default="visualex")  # visualex, manual, simulation

    # Relationships
    trace = relationship("RLCFTrace", back_populates="feedbacks")

    __table_args__ = (
        Index('ix_rlcf_feedback_user_created', 'user_id', 'created_at'),
        Index('ix_rlcf_feedback_score', 'overall_score'),
    )

    def to_multilevel_feedback(self) -> MultilevelFeedback:
        """Converti in MultilevelFeedback dataclass."""
        return MultilevelFeedback.from_dict(self.feedback_json)

    @classmethod
    def from_multilevel_feedback(
        cls,
        trace_id: str,
        feedback: MultilevelFeedback,
        user_id: Optional[str] = None,
        user_authority: float = 0.5,
        source: str = "visualex"
    ) -> "RLCFFeedback":
        """Crea da MultilevelFeedback dataclass."""
        obj = cls(
            trace_id=trace_id,
            user_id=user_id or feedback.user_id,
            user_authority=user_authority,
            feedback_json=feedback.to_dict(),
            overall_score=feedback.overall_score(),
            source=source
        )

        # Denormalize metrics for efficient queries
        if feedback.retrieval_feedback:
            obj.retrieval_precision = feedback.retrieval_feedback.precision
            obj.retrieval_recall = feedback.retrieval_feedback.recall
            obj.retrieval_ranking = feedback.retrieval_feedback.ranking_quality

        if feedback.reasoning_feedback:
            obj.reasoning_coherence = feedback.reasoning_feedback.logical_coherence
            obj.reasoning_soundness = feedback.reasoning_feedback.legal_soundness
            obj.reasoning_citation = feedback.reasoning_feedback.citation_quality

        if feedback.synthesis_feedback:
            obj.synthesis_clarity = feedback.synthesis_feedback.clarity
            obj.synthesis_completeness = feedback.synthesis_feedback.completeness
            obj.synthesis_usefulness = feedback.synthesis_feedback.usefulness

        return obj


class PolicyCheckpoint(Base):
    """
    Checkpoint di una policy trainata.

    Salva lo stato della policy (weights) per versioning e rollback.

    Attributes:
        id: UUID del checkpoint
        version: Version string (es. "v1.0.0", "v1.0.1")
        policy_type: Tipo di policy (gating, traversal, react)
        state_dict_json: Weights serializzati
        config_json: Config della policy
        training_metrics: Metriche del training
        is_active: True se è la policy attualmente in uso
    """
    __tablename__ = "rlcf_policy_checkpoints"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    version = Column(String(50), nullable=False, unique=True, index=True)
    policy_type = Column(String(50), nullable=False, index=True)  # gating, traversal, react

    # Policy state (weights)
    state_dict_path = Column(String(500), nullable=True)  # Path to .pt file
    state_dict_json = Column(JSONType, nullable=True)  # Fallback: JSON serialized

    # Configuration
    config_json = Column(JSONType, nullable=True)

    # Training info
    training_session_id = Column(String(36), nullable=True)
    training_episodes = Column(Integer, default=0)
    training_metrics = Column(JSONType, nullable=True)

    # Status
    is_active = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    activated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index('ix_policy_type_active', 'policy_type', 'is_active'),
    )


class TrainingSession(Base):
    """
    Sessione di training RLCF.

    Traccia un run di training con metriche e configurazione.

    Attributes:
        id: UUID della sessione
        started_at: Timestamp inizio
        ended_at: Timestamp fine
        policy_type: Tipo di policy trainata
        num_traces: Numero di trace usati
        num_feedback: Numero di feedback usati
        metrics_json: Metriche finali
        config_json: Configurazione training
    """
    __tablename__ = "rlcf_training_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Timing
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)

    # Training info
    policy_type = Column(String(50), nullable=False)
    policy_version_from = Column(String(50), nullable=True)  # Starting version
    policy_version_to = Column(String(50), nullable=True)    # Resulting version

    # Data used
    num_traces = Column(Integer, default=0)
    num_feedback = Column(Integer, default=0)
    trace_ids_json = Column(JSONType, nullable=True)  # List of trace IDs used

    # Results
    metrics_json = Column(JSONType, nullable=True)
    config_json = Column(JSONType, nullable=True)
    status = Column(String(20), default="running")  # running, completed, failed
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class WeightVersion(Base):
    """
    Versioned weight configuration for experiment tracking.

    Maps to the `weight_versions` table created by Alembic migration 004.
    Stores serialized WeightConfig JSON with experiment_id for A/B testing
    and is_active flag for latest-version lookup.
    """
    __tablename__ = "weight_versions"

    id = Column(String(50), primary_key=True)
    experiment_id = Column(String(100), nullable=False, index=True)
    version_tag = Column(String(50), nullable=True)
    config_json = Column(GenericJSON, nullable=True)
    metrics_json = Column(GenericJSON, nullable=True)
    is_active = Column(Boolean, server_default="false", nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), default=datetime.utcnow)
    created_by = Column(String(100), nullable=True)


# =============================================================================
# PERSISTENCE SERVICE
# =============================================================================

class RLCFPersistence:
    """
    Service per CRUD operations su RLCF data.

    Uso tipico:
        >>> async with RLCFPersistence() as p:
        ...     trace_id = await p.save_trace(trace)
        ...     await p.save_feedback(trace_id, feedback)
    """

    def __init__(self, database_url: Optional[str] = None):
        """
        Inizializza il service.

        Args:
            database_url: URL database (default: da env)
        """
        self._database_url = database_url
        self._initialized = False

    async def __aenter__(self):
        """Context manager entry - inizializza DB."""
        if not self._initialized:
            await init_async_db(self._database_url)
            self._initialized = True
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        pass

    async def initialize(self):
        """Inizializza il database (crea tabelle se non esistono)."""
        await init_async_db(self._database_url)
        self._initialized = True
        log.info("RLCF persistence initialized")

    # =========================================================================
    # TRACE OPERATIONS
    # =========================================================================

    async def save_trace(
        self,
        trace: ExecutionTrace,
        policy_version: Optional[str] = None,
        query_text: Optional[str] = None,
        expert_type: Optional[str] = None
    ) -> str:
        """
        Salva un ExecutionTrace nel database.

        Args:
            trace: ExecutionTrace da salvare
            policy_version: Versione della policy
            query_text: Testo della query (per debug)
            expert_type: Expert principale

        Returns:
            ID del trace salvato
        """
        async with get_async_session() as session:
            db_trace = RLCFTrace.from_execution_trace(
                trace,
                policy_version=policy_version,
                query_text=query_text,
                expert_type=expert_type
            )

            session.add(db_trace)
            await session.flush()
            trace_id = db_trace.id

            log.info(
                "Trace saved",
                trace_id=trace_id,
                query_id=trace.query_id,
                num_actions=len(trace.actions),
                policy_version=policy_version
            )

            return trace_id

    async def get_trace(self, trace_id: str) -> Optional[ExecutionTrace]:
        """
        Recupera un trace per ID.

        Args:
            trace_id: ID del trace

        Returns:
            ExecutionTrace o None se non trovato
        """
        async with get_async_session() as session:
            result = await session.execute(
                select(RLCFTrace).where(RLCFTrace.id == trace_id)
            )
            db_trace = result.scalar_one_or_none()

            if db_trace:
                return db_trace.to_execution_trace()
            return None

    async def get_traces_without_feedback(
        self,
        limit: int = 100
    ) -> List[Tuple[str, ExecutionTrace]]:
        """
        Recupera trace senza feedback (per pending feedback queue).

        Args:
            limit: Numero massimo di trace

        Returns:
            Lista di (trace_id, ExecutionTrace)
        """
        async with get_async_session() as session:
            result = await session.execute(
                select(RLCFTrace)
                .where(RLCFTrace.has_feedback == False)
                .order_by(RLCFTrace.created_at.desc())
                .limit(limit)
            )

            traces = []
            for db_trace in result.scalars():
                traces.append((db_trace.id, db_trace.to_execution_trace()))

            return traces

    # =========================================================================
    # FEEDBACK OPERATIONS
    # =========================================================================

    async def save_feedback(
        self,
        trace_id: str,
        feedback: MultilevelFeedback,
        user_id: Optional[str] = None,
        user_authority: float = 0.5,
        source: str = "visualex"
    ) -> str:
        """
        Salva feedback associato a un trace.

        Args:
            trace_id: ID del trace
            feedback: MultilevelFeedback da salvare
            user_id: ID utente (da SSO)
            user_authority: Authority score utente
            source: Fonte del feedback

        Returns:
            ID del feedback salvato
        """
        async with get_async_session() as session:
            # Create feedback
            db_feedback = RLCFFeedback.from_multilevel_feedback(
                trace_id=trace_id,
                feedback=feedback,
                user_id=user_id,
                user_authority=user_authority,
                source=source
            )

            session.add(db_feedback)

            # Update trace has_feedback flag
            result = await session.execute(
                select(RLCFTrace).where(RLCFTrace.id == trace_id)
            )
            db_trace = result.scalar_one_or_none()
            if db_trace:
                db_trace.has_feedback = True

            await session.flush()
            feedback_id = db_feedback.id

            log.info(
                "Feedback saved",
                feedback_id=feedback_id,
                trace_id=trace_id,
                user_id=user_id,
                overall_score=feedback.overall_score()
            )

            return feedback_id

    async def get_feedback_for_trace(
        self,
        trace_id: str
    ) -> List[MultilevelFeedback]:
        """
        Recupera tutti i feedback per un trace.

        Args:
            trace_id: ID del trace

        Returns:
            Lista di MultilevelFeedback
        """
        async with get_async_session() as session:
            result = await session.execute(
                select(RLCFFeedback)
                .where(RLCFFeedback.trace_id == trace_id)
                .order_by(RLCFFeedback.created_at)
            )

            return [f.to_multilevel_feedback() for f in result.scalars()]

    # =========================================================================
    # TRAINING DATA
    # =========================================================================

    async def get_training_data(
        self,
        policy_version: Optional[str] = None,
        min_date: Optional[datetime] = None,
        max_date: Optional[datetime] = None,
        limit: int = 1000
    ) -> List[Tuple[ExecutionTrace, MultilevelFeedback]]:
        """
        Recupera dati per training (trace + feedback associato).

        Args:
            policy_version: Filtra per versione policy
            min_date: Data minima
            max_date: Data massima
            limit: Numero massimo di record

        Returns:
            Lista di (ExecutionTrace, MultilevelFeedback)
        """
        async with get_async_session() as session:
            query = (
                select(RLCFTrace, RLCFFeedback)
                .join(RLCFFeedback, RLCFTrace.id == RLCFFeedback.trace_id)
                .where(RLCFTrace.has_feedback == True)
            )

            if policy_version:
                query = query.where(RLCFTrace.policy_version == policy_version)

            if min_date:
                query = query.where(RLCFTrace.created_at >= min_date)

            if max_date:
                query = query.where(RLCFTrace.created_at <= max_date)

            query = query.order_by(RLCFTrace.created_at.desc()).limit(limit)

            result = await session.execute(query)

            training_data = []
            for db_trace, db_feedback in result.all():
                trace = db_trace.to_execution_trace()
                feedback = db_feedback.to_multilevel_feedback()
                training_data.append((trace, feedback))

            log.info(
                "Training data retrieved",
                count=len(training_data),
                policy_version=policy_version
            )

            return training_data

    async def get_training_stats(
        self,
        policy_version: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Statistiche sui dati di training disponibili.

        Returns:
            Dict con statistiche
        """
        async with get_async_session() as session:
            # Count traces
            trace_query = select(func.count()).select_from(RLCFTrace)
            if policy_version:
                trace_query = trace_query.where(RLCFTrace.policy_version == policy_version)
            trace_count = (await session.execute(trace_query)).scalar()

            # Count traces with feedback
            feedback_trace_query = (
                select(func.count())
                .select_from(RLCFTrace)
                .where(RLCFTrace.has_feedback == True)
            )
            if policy_version:
                feedback_trace_query = feedback_trace_query.where(
                    RLCFTrace.policy_version == policy_version
                )
            feedback_trace_count = (await session.execute(feedback_trace_query)).scalar()

            # Count total feedback
            feedback_query = select(func.count()).select_from(RLCFFeedback)
            feedback_count = (await session.execute(feedback_query)).scalar()

            # Average score
            avg_query = select(func.avg(RLCFFeedback.overall_score))
            avg_score = (await session.execute(avg_query)).scalar()

            return {
                "total_traces": trace_count,
                "traces_with_feedback": feedback_trace_count,
                "total_feedback": feedback_count,
                "avg_score": avg_score or 0.0,
                "policy_version": policy_version
            }

    # =========================================================================
    # POLICY CHECKPOINTS
    # =========================================================================

    async def save_policy_checkpoint(
        self,
        version: str,
        policy_type: str,
        state_dict_path: Optional[str] = None,
        config: Optional[Dict] = None,
        training_metrics: Optional[Dict] = None,
        training_session_id: Optional[str] = None,
        training_episodes: int = 0
    ) -> str:
        """
        Salva checkpoint di una policy.

        Args:
            version: Version string (es. "v1.0.0")
            policy_type: Tipo policy (gating, traversal, react)
            state_dict_path: Path al file .pt con weights
            config: Configurazione policy
            training_metrics: Metriche del training

        Returns:
            ID del checkpoint
        """
        async with get_async_session() as session:
            checkpoint = PolicyCheckpoint(
                version=version,
                policy_type=policy_type,
                state_dict_path=state_dict_path,
                config_json=config,
                training_metrics=training_metrics,
                training_session_id=training_session_id,
                training_episodes=training_episodes
            )

            session.add(checkpoint)
            await session.flush()
            checkpoint_id = checkpoint.id

            log.info(
                "Policy checkpoint saved",
                checkpoint_id=checkpoint_id,
                version=version,
                policy_type=policy_type
            )

            return checkpoint_id

    async def get_active_policy(
        self,
        policy_type: str
    ) -> Optional[PolicyCheckpoint]:
        """
        Recupera la policy attiva per un tipo.

        Args:
            policy_type: Tipo policy

        Returns:
            PolicyCheckpoint o None
        """
        async with get_async_session() as session:
            result = await session.execute(
                select(PolicyCheckpoint)
                .where(PolicyCheckpoint.policy_type == policy_type)
                .where(PolicyCheckpoint.is_active == True)
            )
            return result.scalar_one_or_none()

    async def activate_policy(
        self,
        version: str,
        policy_type: str
    ) -> bool:
        """
        Attiva una versione specifica della policy.

        Args:
            version: Version da attivare
            policy_type: Tipo policy

        Returns:
            True se attivata con successo
        """
        async with get_async_session() as session:
            # Deactivate all policies of this type
            deactivate = await session.execute(
                select(PolicyCheckpoint)
                .where(PolicyCheckpoint.policy_type == policy_type)
                .where(PolicyCheckpoint.is_active == True)
            )
            for checkpoint in deactivate.scalars():
                checkpoint.is_active = False

            # Activate target version
            result = await session.execute(
                select(PolicyCheckpoint)
                .where(PolicyCheckpoint.policy_type == policy_type)
                .where(PolicyCheckpoint.version == version)
            )
            target = result.scalar_one_or_none()

            if target:
                target.is_active = True
                target.activated_at = datetime.now(UTC).replace(tzinfo=None)
                log.info("Policy activated", version=version, policy_type=policy_type)
                return True

            return False

    # =========================================================================
    # TRAINING SESSIONS
    # =========================================================================

    async def start_training_session(
        self,
        policy_type: str,
        policy_version_from: Optional[str] = None,
        config: Optional[Dict] = None
    ) -> str:
        """
        Inizia una nuova sessione di training.

        Args:
            policy_type: Tipo policy
            policy_version_from: Versione di partenza
            config: Configurazione training

        Returns:
            ID della sessione
        """
        async with get_async_session() as session:
            training_session = TrainingSession(
                policy_type=policy_type,
                policy_version_from=policy_version_from,
                config_json=config,
                status="running"
            )

            session.add(training_session)
            await session.flush()
            session_id = training_session.id

            log.info(
                "Training session started",
                session_id=session_id,
                policy_type=policy_type
            )

            return session_id

    async def complete_training_session(
        self,
        session_id: str,
        policy_version_to: str,
        num_traces: int,
        num_feedback: int,
        metrics: Dict[str, Any],
        trace_ids: Optional[List[str]] = None
    ) -> None:
        """
        Completa una sessione di training.

        Args:
            session_id: ID sessione
            policy_version_to: Versione risultante
            num_traces: Numero trace usati
            num_feedback: Numero feedback usati
            metrics: Metriche finali
            trace_ids: Lista trace IDs usati
        """
        async with get_async_session() as session:
            result = await session.execute(
                select(TrainingSession)
                .where(TrainingSession.id == session_id)
            )
            training_session = result.scalar_one_or_none()

            if training_session:
                training_session.ended_at = datetime.now(UTC).replace(tzinfo=None)
                training_session.policy_version_to = policy_version_to
                training_session.num_traces = num_traces
                training_session.num_feedback = num_feedback
                training_session.metrics_json = metrics
                training_session.trace_ids_json = trace_ids
                training_session.status = "completed"

                log.info(
                    "Training session completed",
                    session_id=session_id,
                    policy_version_to=policy_version_to,
                    num_traces=num_traces
                )

    async def fail_training_session(
        self,
        session_id: str,
        error_message: str
    ) -> None:
        """
        Marca una sessione come fallita.

        Args:
            session_id: ID sessione
            error_message: Messaggio di errore
        """
        async with get_async_session() as session:
            result = await session.execute(
                select(TrainingSession)
                .where(TrainingSession.id == session_id)
            )
            training_session = result.scalar_one_or_none()

            if training_session:
                training_session.ended_at = datetime.now(UTC).replace(tzinfo=None)
                training_session.status = "failed"
                training_session.error_message = error_message

                log.error(
                    "Training session failed",
                    session_id=session_id,
                    error=error_message
                )


# =============================================================================
# FACTORY FUNCTION
# =============================================================================

async def create_persistence(database_url: Optional[str] = None) -> RLCFPersistence:
    """
    Factory function per creare RLCFPersistence inizializzato.

    Args:
        database_url: URL database

    Returns:
        RLCFPersistence pronto all'uso
    """
    persistence = RLCFPersistence(database_url)
    await persistence.initialize()
    return persistence
