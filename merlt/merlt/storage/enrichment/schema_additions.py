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
