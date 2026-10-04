"""Idempotent column additions applied at every boot.

The live stack bootstraps its schema with ``create_tables()`` (Base.metadata,
tables only) and never runs Alembic, so a column added to an ORM model after
the first boot is selected by the ORM but missing in Postgres: every
``pending_*`` read failed until someone ran the SQL by hand. Mirror of
``ensure_consensus_triggers``: each statement is ``ADD COLUMN IF NOT EXISTS``
and safe to re-run. Keep this list in step with the SQL files under
``storage/migrations/`` and the Alembic versions (which remain the record for
databases that do track history).
"""

from __future__ import annotations

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from merlt.storage.enrichment import database as _db

log = structlog.get_logger()

_STATEMENTS = (
    # 003_pending_source_reference.sql: promotion provenance (Slice 2c).
    "ALTER TABLE pending_entities ADD COLUMN IF NOT EXISTS source_reference TEXT",
    "ALTER TABLE pending_relations ADD COLUMN IF NOT EXISTS source_reference TEXT",
    # propose-relation never set `fonte`; community relations carried the
    # column default. Only propose-relation writes source_type='manual'.
    "UPDATE pending_relations SET fonte = 'community' "
    "WHERE source_type = 'manual' AND (fonte IS NULL OR fonte = 'llm_extraction')",
    # 004_relation_endpoints.sql (B1): the LLM's endpoint names stay readable
    # once the parser resolved the endpoint to a graph identifier.
    "ALTER TABLE extraction_candidates ADD COLUMN IF NOT EXISTS source_text TEXT",
    "ALTER TABLE extraction_candidates ADD COLUMN IF NOT EXISTS target_text TEXT",
    # A Normattiva URL target overflowed varchar(100); widen to the source's
    # 300. Guarded so a re-run on an already-wide column is a no-op.
    *(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM information_schema.columns "
        f"WHERE table_schema = current_schema() AND table_name = '{table}' "
        "AND column_name = 'target_entity_id' AND character_maximum_length < 300) THEN "
        f"ALTER TABLE {table} ALTER COLUMN target_entity_id TYPE VARCHAR(300); "
        "END IF; END $$"
        for table in ("extraction_candidates", "pending_relations")
    ),
    # 005_user_documents_owner_dedup.sql: dedup uploads per user. The global
    # unique on file_hash gave user B user A's document id for a byte-identical
    # file. On a database created with the new model the composite constraint
    # already backs an index of the same name, so the CREATE is a no-op.
    # unique=True + index=True made SQLAlchemy emit a UNIQUE INDEX named
    # ix_user_documents_file_hash: demote it to a plain index (guarded on its
    # definition, so a database created with the new model is untouched).
    "DO $$ BEGIN "
    "IF EXISTS (SELECT 1 FROM pg_indexes "
    "WHERE schemaname = current_schema() AND indexname = 'ix_user_documents_file_hash' "
    "AND indexdef LIKE 'CREATE UNIQUE INDEX%') THEN "
    "DROP INDEX ix_user_documents_file_hash; "
    "CREATE INDEX ix_user_documents_file_hash ON user_documents (file_hash); "
    "END IF; END $$",
    "ALTER TABLE user_documents DROP CONSTRAINT IF EXISTS user_documents_file_hash_key",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_documents_hash_owner "
    "ON user_documents (file_hash, uploaded_by)",
    # 006_massimario_ingestion.sql: Massimario batches stage chunks next to
    # nodes/edges, and `massimario` is a batch source.
    "ALTER TABLE merlt_ingestion_batches ADD COLUMN IF NOT EXISTS extras JSON",
    "DO $$ BEGIN "
    "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_batch_source' "
    "AND pg_get_constraintdef(oid) LIKE '%massimario%') THEN "
    "ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source; "
    "ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source "
    "CHECK (source IN ('visualex_tree','italia_corpus','massimario')); "
    "END IF; END $$",
    # The bridge lives in the same database; guarded because a fresh database
    # gets it from the seed DDL, not from create_tables(). The DDL and the ORM
    # already declare UNIQUE (chunk_id, graph_node_urn), which ON CONFLICT needs:
    # a unique index is added only to a table that lacks one.
    "DO $$ BEGIN "
    "IF to_regclass('bridge_table') IS NOT NULL THEN "
    "ALTER TABLE bridge_table ADD COLUMN IF NOT EXISTS expert_affinity JSONB; "
    "IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indrelid = 'bridge_table'::regclass AND indisunique "
    "AND pg_get_indexdef(indexrelid) LIKE '%(chunk_id, graph_node_urn)') THEN "
    "CREATE UNIQUE INDEX uq_bridge_chunk_node ON bridge_table (chunk_id, graph_node_urn); "
    "END IF; "
    "CREATE INDEX IF NOT EXISTS idx_bridge_source ON bridge_table (source); "
    "END IF; END $$",
)


async def ensure_schema_additions(engine: AsyncEngine | None = None) -> None:
    """Apply the additive column migrations (idempotent)."""
    eng = engine or _db._engine
    if eng is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    async with eng.begin() as conn:
        for stmt in _STATEMENTS:
            await conn.execute(text(stmt))
    log.info("Schema additions ensured", statements=len(_STATEMENTS))
