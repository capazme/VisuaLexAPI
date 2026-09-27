"""
Trace Storage Service
======================

Service class for persisting and querying MERL-T pipeline traces.

Features:
- Save/retrieve traces with full metadata
- Consent-aware data filtering (anonymous, basic, full)
- Pagination and filtering for list queries
- Source resolution via bridge_table integration
- Archival and GDPR-compliant deletion

Pattern follows BridgeTable service architecture.
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import text, select, func, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from merlt.experts.models import QATrace, QAFeedback

log = structlog.get_logger()


@dataclass
class TraceStorageConfig:
    """
    Configuration for Trace Storage connection.

    Uses same PostgreSQL dev instance as bridge_table.
    """
    host: str = "localhost"
    port: int = 5433
    database: str = "rlcf_dev"
    user: str = "dev"
    password: str = "devpassword"
    pool_size: int = 10
    max_overflow: int = 20

    def get_connection_string(self) -> str:
        """Get async PostgreSQL connection string."""
        return f"postgresql+asyncpg://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"


@dataclass
class TraceFilter:
    """Filter criteria for listing traces."""
    user_id: Optional[str] = None
    query_type: Optional[str] = None
    consent_level: Optional[str] = None
    is_archived: Optional[bool] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None


@dataclass
class TraceSummary:
    """Lightweight trace summary for list responses."""
    trace_id: str
    user_id: str
    query_preview: str
    query_type: Optional[str]
    synthesis_mode: Optional[str]
    confidence: Optional[float]
    execution_time_ms: Optional[int]
    created_at: datetime
    is_archived: bool


@dataclass
class SourceResolution:
    """Resolved source information from chunk_id."""
    chunk_id: str
    graph_node_urn: str
    node_type: str
    chunk_text: Optional[str]
    confidence: Optional[float]


class TraceStorageService:
    """
    Service for managing pipeline trace persistence.

    Follows BridgeTable pattern with async session management.

    Example:
        service = TraceStorageService(TraceStorageConfig())
        await service.connect()

        # Save trace
        trace_id = await service.save_trace(qa_trace)

        # Get trace with consent filtering
        trace = await service.get_trace(trace_id, consent_level="basic")

        # List traces with filters
        traces = await service.list_traces(
            filters=TraceFilter(user_id="user123"),
            limit=20,
            offset=0
        )

        await service.close()
    """

    def __init__(self, config: Optional[TraceStorageConfig] = None):
        self.config = config or TraceStorageConfig()
        self._engine = None
        self._session_maker = None
        self._connected = False

        log.info(
            "TraceStorageService initialized",
            host=self.config.host,
            port=self.config.port,
            database=self.config.database
        )

    async def connect(self):
        """Establish connection pool to PostgreSQL."""
        if self._connected:
            log.debug("Already connected to PostgreSQL")
            return

        connection_string = self.config.get_connection_string()
        self._engine = create_async_engine(
            connection_string,
            pool_size=self.config.pool_size,
            max_overflow=self.config.max_overflow,
            echo=False
        )

        self._session_maker = async_sessionmaker(
            self._engine,
            class_=AsyncSession,
            expire_on_commit=False
        )

        self._connected = True
        log.info(f"TraceStorageService connected to PostgreSQL at {self.config.host}:{self.config.port}")

    async def ensure_tables_exist(self):
        """
        Create qa_traces and qa_feedback tables if they don't exist.

        Uses raw SQL for explicit control over schema.
        """
        if not self._connected:
            await self.connect()

        # DDL for qa_traces
        create_traces_sql = """
        CREATE TABLE IF NOT EXISTS qa_traces (
            trace_id VARCHAR(50) PRIMARY KEY,
            user_id VARCHAR(50) NOT NULL,
            query TEXT NOT NULL,
            selected_experts VARCHAR(100)[],
            synthesis_mode VARCHAR(20),
            synthesis_text TEXT,
            sources JSONB,
            execution_time_ms INTEGER,
            full_trace JSONB,
            consent_level VARCHAR(20) NOT NULL DEFAULT 'basic',
            query_type VARCHAR(50),
            confidence FLOAT,
            routing_method VARCHAR(30),
            is_archived BOOLEAN NOT NULL DEFAULT false,
            archived_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT chk_synthesis_mode CHECK (synthesis_mode IS NULL OR synthesis_mode IN ('convergent', 'divergent')),
            CONSTRAINT chk_consent_level CHECK (consent_level IN ('anonymous', 'basic', 'full')),
            CONSTRAINT chk_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
        );

        CREATE INDEX IF NOT EXISTS idx_qa_traces_user ON qa_traces(user_id);
        CREATE INDEX IF NOT EXISTS idx_qa_traces_created ON qa_traces(created_at);
        CREATE INDEX IF NOT EXISTS idx_qa_traces_user_created ON qa_traces(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_qa_traces_query_type ON qa_traces(query_type);
        CREATE INDEX IF NOT EXISTS idx_qa_traces_archived ON qa_traces(is_archived);
        CREATE INDEX IF NOT EXISTS idx_qa_traces_consent ON qa_traces(consent_level);
        """

        # DDL for qa_feedback
        create_feedback_sql = """
        CREATE TABLE IF NOT EXISTS qa_feedback (
            id SERIAL PRIMARY KEY,
            trace_id VARCHAR(50) NOT NULL REFERENCES qa_traces(trace_id) ON DELETE CASCADE,
            user_id VARCHAR(50) NOT NULL,
            inline_rating INTEGER,
            retrieval_score FLOAT,
            reasoning_score FLOAT,
            synthesis_score FLOAT,
            detailed_comment TEXT,
            source_id VARCHAR(200),
            source_relevance INTEGER,
            follow_up_query TEXT,
            refined_trace_id VARCHAR(50),
            preferred_expert VARCHAR(50),
            user_authority FLOAT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT chk_inline_rating CHECK (inline_rating IS NULL OR (inline_rating >= 1 AND inline_rating <= 5)),
            CONSTRAINT chk_retrieval_score CHECK (retrieval_score IS NULL OR (retrieval_score >= 0 AND retrieval_score <= 1)),
            CONSTRAINT chk_reasoning_score CHECK (reasoning_score IS NULL OR (reasoning_score >= 0 AND reasoning_score <= 1)),
            CONSTRAINT chk_synthesis_score CHECK (synthesis_score IS NULL OR (synthesis_score >= 0 AND synthesis_score <= 1)),
            CONSTRAINT chk_source_relevance CHECK (source_relevance IS NULL OR (source_relevance >= 1 AND source_relevance <= 5))
        );

        CREATE INDEX IF NOT EXISTS idx_qa_feedback_trace ON qa_feedback(trace_id);
        CREATE INDEX IF NOT EXISTS idx_qa_feedback_user ON qa_feedback(user_id);
        """

        async with self._engine.begin() as conn:
            for statement in create_traces_sql.strip().split(';'):
                if statement.strip():
                    await conn.execute(text(statement))
            for statement in create_feedback_sql.strip().split(';'):
                if statement.strip():
                    await conn.execute(text(statement))

        log.info("Tables qa_traces and qa_feedback ensured to exist")

    async def close(self):
        """Close connection pool."""
        if not self._connected:
            return

        await self._engine.dispose()
        self._connected = False
        log.info("TraceStorageService disconnected from PostgreSQL")

    async def save_trace(self, trace: QATrace) -> str:
        """
        Save a QATrace to the database.

        Args:
            trace: QATrace ORM instance

        Returns:
            trace_id of the saved trace
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        async with self._session_maker() as session:
            session.add(trace)
            await session.commit()

            log.info(
                "Trace saved",
                trace_id=trace.trace_id,
                user_id=trace.user_id,
                consent_level=trace.consent_level
            )

            return trace.trace_id

    async def get_trace(
        self,
        trace_id: str,
        consent_level: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Get a trace by ID with consent filtering.

        Args:
            trace_id: Unique trace identifier
            consent_level: Caller's consent level for filtering

        Returns:
            Trace dict with fields redacted based on consent level,
            or None if not found
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        async with self._session_maker() as session:
            result = await session.execute(
                select(QATrace).where(QATrace.trace_id == trace_id)
            )
            trace = result.scalar_one_or_none()

            if not trace:
                return None

            # Apply consent filtering
            return self._apply_consent_filter(trace, consent_level)

    def _apply_consent_filter(
        self,
        trace: QATrace,
        caller_consent: Optional[str]
    ) -> Dict[str, Any]:
        """
        Apply consent-based data filtering.

        Filtering rules:
        - anonymous: redact query + user_id
        - basic: redact query
        - full: no redaction

        Caller consent determines max visibility:
        - If caller_consent is lower than trace.consent_level, apply caller's restrictions
        """
        # Build base dict
        data = {
            "trace_id": trace.trace_id,
            "user_id": trace.user_id,
            "query": trace.query,
            "selected_experts": trace.selected_experts,
            "synthesis_mode": trace.synthesis_mode,
            "synthesis_text": trace.synthesis_text,
            "sources": trace.sources,
            "execution_time_ms": trace.execution_time_ms,
            "full_trace": trace.full_trace,
            "consent_level": trace.consent_level,
            "query_type": trace.query_type,
            "confidence": trace.confidence,
            "routing_method": trace.routing_method,
            "is_archived": trace.is_archived,
            "archived_at": trace.archived_at.isoformat() if trace.archived_at else None,
            "created_at": trace.created_at.isoformat() if trace.created_at else None,
        }

        # Determine effective consent level (most restrictive)
        consent_levels = {"anonymous": 0, "basic": 1, "full": 2}
        stored_level = consent_levels.get(trace.consent_level, 0)
        # None means no caller restriction; invalid value defaults to most restrictive
        if caller_consent is None:
            caller_level = 2
        else:
            caller_level = consent_levels.get(caller_consent, 0)
        effective_level = min(stored_level, caller_level)

        # Apply redaction
        if effective_level == 0:  # anonymous
            data["user_id"] = "[REDACTED]"
            data["query"] = "[REDACTED]"
        elif effective_level == 1:  # basic
            data["query"] = "[REDACTED]"
        # full: no redaction

        return data

    async def list_traces(
        self,
        filters: Optional[TraceFilter] = None,
        limit: int = 20,
        offset: int = 0,
        consent_level: Optional[str] = None
    ) -> List[TraceSummary]:
        """
        List traces with pagination and filtering.

        Args:
            filters: Filter criteria
            limit: Max results to return
            offset: Pagination offset
            consent_level: Caller consent for filtering

        Returns:
            List of TraceSummary objects
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        filters = filters or TraceFilter()

        # Build query
        query = select(QATrace)

        if filters.user_id:
            query = query.where(QATrace.user_id == filters.user_id)
        if filters.query_type:
            query = query.where(QATrace.query_type == filters.query_type)
        if filters.consent_level:
            query = query.where(QATrace.consent_level == filters.consent_level)
        if filters.is_archived is not None:
            query = query.where(QATrace.is_archived == filters.is_archived)
        if filters.date_from:
            query = query.where(QATrace.created_at >= filters.date_from)
        if filters.date_to:
            query = query.where(QATrace.created_at <= filters.date_to)

        query = query.order_by(QATrace.created_at.desc())
        query = query.limit(limit).offset(offset)

        async with self._session_maker() as session:
            result = await session.execute(query)
            traces = result.scalars().all()

            summaries = []
            for trace in traces:
                # Apply consent filtering for preview
                consent_levels = {"anonymous": 0, "basic": 1, "full": 2}
                stored_level = consent_levels.get(trace.consent_level, 1)
                caller_level = consent_levels.get(consent_level, 2) if consent_level else 2
                effective_level = min(stored_level, caller_level)

                user_id = trace.user_id if effective_level > 0 else "[REDACTED]"
                query_preview = (
                    trace.query[:100] + "..." if len(trace.query) > 100 else trace.query
                ) if effective_level == 2 else "[REDACTED]"

                summaries.append(TraceSummary(
                    trace_id=trace.trace_id,
                    user_id=user_id,
                    query_preview=query_preview,
                    query_type=trace.query_type,
                    synthesis_mode=trace.synthesis_mode,
                    confidence=trace.confidence,
                    execution_time_ms=trace.execution_time_ms,
                    created_at=trace.created_at,
                    is_archived=trace.is_archived
                ))

            log.debug(f"Listed {len(summaries)} traces", filters=filters)
            return summaries

    async def count_traces(self, filters: Optional[TraceFilter] = None) -> int:
        """Count traces matching filters."""
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        filters = filters or TraceFilter()

        query = select(func.count(QATrace.trace_id))

        if filters.user_id:
            query = query.where(QATrace.user_id == filters.user_id)
        if filters.query_type:
            query = query.where(QATrace.query_type == filters.query_type)
        if filters.consent_level:
            query = query.where(QATrace.consent_level == filters.consent_level)
        if filters.is_archived is not None:
            query = query.where(QATrace.is_archived == filters.is_archived)
        if filters.date_from:
            query = query.where(QATrace.created_at >= filters.date_from)
        if filters.date_to:
            query = query.where(QATrace.created_at <= filters.date_to)

        async with self._session_maker() as session:
            result = await session.execute(query)
            return result.scalar()

    async def get_trace_sources(
        self,
        trace_id: str,
        bridge_table: "BridgeTable"
    ) -> List[SourceResolution]:
        """
        Resolve chunk_ids from trace sources to graph URNs via bridge_table.

        Args:
            trace_id: Trace to resolve sources for
            bridge_table: BridgeTable instance for resolution

        Returns:
            List of SourceResolution with URN, node_type, chunk_text
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        # Get trace
        async with self._session_maker() as session:
            result = await session.execute(
                select(QATrace).where(QATrace.trace_id == trace_id)
            )
            trace = result.scalar_one_or_none()

            if not trace or not trace.sources:
                return []

        # Resolve each source
        resolutions = []
        for source in trace.sources:
            chunk_id = source.get("chunk_id")
            if not chunk_id:
                continue

            # Query bridge_table
            nodes = await bridge_table.get_nodes_for_chunk(chunk_id)
            for node in nodes:
                resolutions.append(SourceResolution(
                    chunk_id=chunk_id,
                    graph_node_urn=node["graph_node_urn"],
                    node_type=node["node_type"],
                    chunk_text=node.get("chunk_text"),
                    confidence=node.get("confidence")
                ))

        log.debug(f"Resolved {len(resolutions)} sources for trace {trace_id}")
        return resolutions

    async def delete_trace(self, trace_id: str) -> bool:
        """
        Hard delete a trace and all associated feedback (GDPR compliance).

        Args:
            trace_id: Trace to delete

        Returns:
            True if deleted, False if not found
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        async with self._session_maker() as session:
            # Check if exists
            result = await session.execute(
                select(QATrace).where(QATrace.trace_id == trace_id)
            )
            trace = result.scalar_one_or_none()

            if not trace:
                return False

            # Delete (cascade will handle feedback)
            await session.delete(trace)
            await session.commit()

            log.info(f"Deleted trace {trace_id} (GDPR)")
            return True

    async def archive_old_traces(self, days: int = 90) -> int:
        """
        Archive traces older than specified days.

        Args:
            days: Traces older than this will be archived

        Returns:
            Number of traces archived
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC for TIMESTAMP WITHOUT TIME ZONE
        cutoff = now - timedelta(days=days)

        async with self._session_maker() as session:
            result = await session.execute(
                update(QATrace)
                .where(QATrace.created_at < cutoff)
                .where(QATrace.is_archived == False)  # noqa: E712
                .values(is_archived=True, archived_at=now)
            )
            await session.commit()

            count = result.rowcount
            log.info(f"Archived {count} traces older than {days} days")
            return count

    async def health_check(self) -> bool:
        """
        Check if PostgreSQL connection is healthy.

        Returns:
            True if healthy, False otherwise
        """
        try:
            if not self._connected:
                await self.connect()

            async with self._session_maker() as session:
                result = await session.execute(text("SELECT 1"))
                result.scalar()

            return True

        except Exception as e:
            log.error(f"Health check failed: {e}")
            return False
