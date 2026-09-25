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
