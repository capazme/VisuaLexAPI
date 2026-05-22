"""
Bridge Table Service
=====================

Service class for managing vector-to-graph mappings.

Features:
- Insert/update/delete mappings
- Query by chunk_id or graph_node_urn
- Batch operations for ingestion
- Async/await for performance
- Supporta separazione test/prod con tabelle diverse
"""

import json
import structlog
from typing import List, Optional, Dict, Any, Type
from uuid import UUID
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from .models import Base, get_bridge_table_model

log = structlog.get_logger()


@dataclass
class BridgeTableConfig:
    """
    Configuration for Bridge Table connection.

    Supporta tabelle separate per ambiente:
    - bridge_table_test per test/development
    - bridge_table_prod per production
    """
    host: str = "localhost"
    port: int = 5433  # Dev container port (avoiding conflict with native PostgreSQL)
    database: str = "rlcf_dev"
    user: str = "dev"
    password: str = "devpassword"
    pool_size: int = 10
    max_overflow: int = 20
    table_name: str = "bridge_table"  # Nome tabella (bridge_table_test, bridge_table_prod)

    def get_connection_string(self) -> str:
        """Get async PostgreSQL connection string."""
        return f"postgresql+asyncpg://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"

    @classmethod
    def from_environment(cls, env_config: "EnvironmentConfig") -> "BridgeTableConfig":
        """
        Crea configurazione da ambiente corrente.

        Args:
            env_config: Configurazione ambiente da merlt.config.environments

        Returns:
            BridgeTableConfig con table_name appropriato

        Example:
            >>> from merlt.config import get_current_environment
            >>> config = BridgeTableConfig.from_environment(get_current_environment())
            >>> print(config.table_name)  # "bridge_table_test" o "bridge_table_prod"
        """
        return cls(
            table_name=f"bridge_table{env_config.bridge_table_suffix}"
        )

    @classmethod
    def for_test(cls) -> "BridgeTableConfig":
        """Configurazione per ambiente test."""
        return cls(table_name="bridge_table_test")

    @classmethod
    def for_prod(cls) -> "BridgeTableConfig":
        """Configurazione per ambiente prod."""
        return cls(table_name="bridge_table_prod")


class BridgeTable:
    """
    Service for managing chunk-to-graph mappings.

    Supporta tabelle separate per ambiente (test/prod).

    Example:
        # Uso con ambiente corrente
        from merlt.config import get_current_environment
        config = BridgeTableConfig.from_environment(get_current_environment())
        bridge = BridgeTable(config)
        await bridge.connect()

        # Uso esplicito per test
        bridge = BridgeTable(BridgeTableConfig.for_test())

        # Add mapping
        await bridge.add_mapping(
            chunk_id=uuid4(),
            graph_node_urn="https://www.normattiva.it/...",
            node_type="Norma",
            relation_type="contained_in",
            confidence=1.0
        )

        # Query by chunk
        nodes = await bridge.get_nodes_for_chunk(chunk_id)

        await bridge.close()
    """

    def __init__(self, config: Optional[BridgeTableConfig] = None):
        self.config = config or BridgeTableConfig()
        self._engine = None
        self._session_maker = None
        self._connected = False

        # Modello specifico per la tabella configurata
        self._model_class = get_bridge_table_model(self.config.table_name)

        log.info(
            f"BridgeTable initialized - "
            f"host={self.config.host}:{self.config.port}, "
            f"database={self.config.database}, "
            f"table={self.config.table_name}"
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
            echo=False  # Set to True for SQL debugging
        )

        self._session_maker = async_sessionmaker(
            self._engine,
            class_=AsyncSession,
            expire_on_commit=False
        )

        self._connected = True
        log.info(f"Connected to PostgreSQL at {self.config.host}:{self.config.port}, table={self.config.table_name}")

    async def ensure_table_exists(self):
        """
        Crea la tabella se non esiste.

        Utile per inizializzazione ambiente.
        """
        if not self._connected:
            await self.connect()

        create_sql = f"""
        CREATE TABLE IF NOT EXISTS {self.config.table_name} (
            id SERIAL PRIMARY KEY,
            chunk_id UUID NOT NULL,
            chunk_text TEXT,
            graph_node_urn VARCHAR(500) NOT NULL,
            node_type VARCHAR(50) NOT NULL,
            relation_type VARCHAR(50),
            confidence FLOAT,
            source VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            metadata JSONB,
            CONSTRAINT {self.config.table_name}_chunk_id_graph_node_urn_key UNIQUE (chunk_id, graph_node_urn),
            CONSTRAINT {self.config.table_name}_confidence_check CHECK (confidence >= 0 AND confidence <= 1)
        );
        CREATE INDEX IF NOT EXISTS {self.config.table_name}_chunk_id_idx ON {self.config.table_name}(chunk_id);
        CREATE INDEX IF NOT EXISTS {self.config.table_name}_graph_node_urn_idx ON {self.config.table_name}(graph_node_urn);
        CREATE INDEX IF NOT EXISTS {self.config.table_name}_node_type_idx ON {self.config.table_name}(node_type);
        """

        async with self._engine.begin() as conn:
            for statement in create_sql.strip().split(';'):
                if statement.strip():
                    await conn.execute(text(statement))

        log.info(f"Table {self.config.table_name} ensured to exist")

    async def drop_table(self):
        """
        Elimina la tabella (ATTENZIONE: operazione distruttiva).

        Utile per reset ambiente.
        """
        if not self._connected:
            await self.connect()

        async with self._engine.begin() as conn:
            await conn.execute(text(f"DROP TABLE IF EXISTS {self.config.table_name} CASCADE"))

        log.warning(f"Table {self.config.table_name} dropped")

    async def truncate_table(self):
        """
        Svuota la tabella mantenendo la struttura.

        Utile per reset dati senza perdere schema.
        """
        if not self._connected:
            await self.connect()

        async with self._engine.begin() as conn:
            await conn.execute(text(f"TRUNCATE TABLE {self.config.table_name}"))

        log.warning(f"Table {self.config.table_name} truncated")

    async def count(self) -> int:
        """
        Conta le righe nella tabella.

        Returns:
            Numero di mapping nella tabella
        """
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")

        async with self._session_maker() as session:
            result = await session.execute(
                text(f"SELECT COUNT(*) FROM {self.config.table_name}")
            )
            return result.scalar()

    async def close(self):
        """Close connection pool."""
        if not self._connected:
            return

        await self._engine.dispose()
        self._connected = False
        log.info("Disconnected from PostgreSQL")

    async def add_mapping(
        self,
        chunk_id: UUID,
        graph_node_urn: str,
        node_type: str,
        relation_type: Optional[str] = None,
        confidence: Optional[float] = None,
        chunk_text: Optional[str] = None,
        source: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> int:
        """
        Add a single chunk-to-node mapping.

        Args:
            chunk_id: UUID of the text chunk in Qdrant
            graph_node_urn: URN of the graph node in FalkorDB
            node_type: Type of node (Norma, ConcettoGiuridico, etc.)
            relation_type: Semantic relation (contained_in, references, etc.)
            confidence: Confidence score [0-1]
            chunk_text: Optional cached text for debugging
            source: Data source (visualex, manual, etc.)
            metadata: Additional metadata as JSON

        Returns:
            ID of the created entry

        Raises:
            IntegrityError: If mapping already exists (unique constraint violation)
        """
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")

        metadata_json = json.dumps(metadata) if metadata else None

        insert_sql = text(f"""
            INSERT INTO {self.config.table_name}
            (chunk_id, graph_node_urn, node_type, relation_type, confidence, chunk_text, source, metadata)
            VALUES (:chunk_id, :graph_node_urn, :node_type, :relation_type, :confidence, :chunk_text, :source, CAST(:metadata AS jsonb))
            RETURNING id
        """)

        async with self._session_maker() as session:
            result = await session.execute(
                insert_sql,
                {
                    "chunk_id": str(chunk_id),
                    "graph_node_urn": graph_node_urn,
                    "node_type": node_type,
                    "relation_type": relation_type,
                    "confidence": confidence,
                    "chunk_text": chunk_text,
                    "source": source,
                    "metadata": metadata_json
                }
            )
            await session.commit()
            entry_id = result.scalar()

            log.debug(
                f"Added mapping: chunk_id={chunk_id} -> "
                f"node_urn={graph_node_urn[:50]}..."
            )

            return entry_id

    async def add_mappings_batch(
        self,
        mappings: List[Dict[str, Any]]
    ) -> int:
        """
        Add multiple mappings in a batch (faster for ingestion).

        Args:
            mappings: List of mapping dicts with keys:
                - chunk_id (required)
                - graph_node_urn (required)
                - node_type (required)
                - relation_type (optional)
                - confidence (optional)
                - chunk_text (optional)
                - source (optional)
                - metadata (optional)

        Returns:
            Number of mappings inserted

        Example:
            await bridge.add_mappings_batch([
                {
                    "chunk_id": uuid4(),
                    "graph_node_urn": "urn:...",
                    "node_type": "Norma",
                    "confidence": 1.0
                },
                ...
            ])
        """
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")

        if not mappings:
            return 0

        insert_sql = text(f"""
            INSERT INTO {self.config.table_name}
            (chunk_id, graph_node_urn, node_type, relation_type, confidence, chunk_text, source, metadata)
            VALUES (:chunk_id, :graph_node_urn, :node_type, :relation_type, :confidence, :chunk_text, :source, CAST(:metadata AS jsonb))
        """)

        # Prepara i parametri per ogni mapping
        params = []
        for m in mappings:
            metadata_json = json.dumps(m.get("metadata") or m.get("extra_metadata")) if (m.get("metadata") or m.get("extra_metadata")) else None
            params.append({
                "chunk_id": str(m["chunk_id"]),
                "graph_node_urn": m["graph_node_urn"],
                "node_type": m["node_type"],
                "relation_type": m.get("relation_type"),
                "confidence": m.get("confidence"),
                "chunk_text": m.get("chunk_text"),
                "source": m.get("source"),
                "metadata": metadata_json
            })

        async with self._session_maker() as session:
            for p in params:
                await session.execute(insert_sql, p)
            await session.commit()

            log.info(f"Batch inserted {len(params)} mappings into {self.config.table_name}")
            return len(params)

    async def get_nodes_for_chunk(
        self,
        chunk_id: UUID,
        node_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get all graph nodes linked to a chunk.

        Args:
            chunk_id: UUID of the chunk
            node_type: Optional filter by node type

        Returns:
            List of node dicts with fields:
                - graph_node_urn
                - node_type
                - relation_type
                - confidence
                - metadata
        """
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")

        query_sql = f"""
            SELECT graph_node_urn, node_type, relation_type, confidence, metadata
            FROM {self.config.table_name}
            WHERE chunk_id = :chunk_id
        """
        params = {"chunk_id": str(chunk_id)}

        if node_type:
            query_sql += " AND node_type = :node_type"
            params["node_type"] = node_type

        async with self._session_maker() as session:
            result = await session.execute(text(query_sql), params)
            rows = result.fetchall()

            log.debug(f"Found {len(rows)} nodes for chunk_id={chunk_id}")

            return [
                {
                    "graph_node_urn": row[0],
                    "node_type": row[1],
                    "relation_type": row[2],
                    "confidence": row[3],
                    "metadata": row[4]
                }
                for row in rows
            ]

    async def get_chunks_for_node(
        self,
        graph_node_urn: str
    ) -> List[Dict[str, Any]]:
        """
        Get all chunks linked to a graph node.

        Args:
            graph_node_urn: URN of the graph node

        Returns:
            List of chunk dicts with fields:
                - chunk_id
                - chunk_text
                - relation_type
                - confidence
        """
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")

        query_sql = f"""
            SELECT chunk_id, chunk_text, relation_type, confidence
            FROM {self.config.table_name}
            WHERE graph_node_urn = :graph_node_urn
        """

        async with self._session_maker() as session:
            result = await session.execute(
                text(query_sql),
                {"graph_node_urn": graph_node_urn}
            )
            rows = result.fetchall()

            log.debug(f"Found {len(rows)} chunks for node_urn={graph_node_urn[:50]}...")

            return [
                {
                    "chunk_id": str(row[0]),
                    "chunk_text": row[1],
                    "relation_type": row[2],
                    "confidence": row[3]
                }
                for row in rows
            ]

    async def delete_mappings_for_chunk(self, chunk_id: UUID) -> int:
        """
        Delete all mappings for a chunk.

        Args:
            chunk_id: UUID of the chunk

        Returns:
            Number of mappings deleted
        """
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")

        delete_sql = f"""
            DELETE FROM {self.config.table_name}
            WHERE chunk_id = :chunk_id
        """

        async with self._session_maker() as session:
            result = await session.execute(
                text(delete_sql),
                {"chunk_id": str(chunk_id)}
            )
            await session.commit()

            count = result.rowcount
            log.debug(f"Deleted {count} mappings for chunk_id={chunk_id}")
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
