"""relation_endpoints

B1 (note-derived relations). The staging parser now resolves a relation's
endpoints to graph identifiers (norm URN, Entity id, pending entity id) and
keeps the names the LLM wrote in two new nullable columns on
``extraction_candidates``. ``target_entity_id`` is widened from varchar(100)
to varchar(300) on both endpoint tables: a Normattiva URL target overflowed it.

Idempotent (``ADD COLUMN IF NOT EXISTS``, guarded ALTER TYPE): safe on a
database bootstrapped by ``create_tables()`` that never ran Alembic. The same
statements live in ``merlt/storage/migrations/004_relation_endpoints.sql`` and
in ``merlt/storage/enrichment/schema_additions.py`` (applied at boot).

Revision ID: 008_relation_endpoints
Revises: 007_add_pending_source_reference
Create Date: 2026-09-25 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '008_relation_endpoints'
down_revision: Union[str, None] = '007_add_pending_source_reference'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _widen_target(table: str, length: int) -> str:
    return (
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM information_schema.columns "
        f"WHERE table_schema = current_schema() AND table_name = '{table}' "
        f"AND column_name = 'target_entity_id' AND character_maximum_length <> {length}) THEN "
        f"ALTER TABLE {table} ALTER COLUMN target_entity_id TYPE VARCHAR({length}); "
        "END IF; END $$"
    )


def upgrade() -> None:
    op.execute("ALTER TABLE extraction_candidates ADD COLUMN IF NOT EXISTS source_text TEXT")
    op.execute("ALTER TABLE extraction_candidates ADD COLUMN IF NOT EXISTS target_text TEXT")
    op.execute(_widen_target("extraction_candidates", 300))
    op.execute(_widen_target("pending_relations", 300))


def downgrade() -> None:
    # Narrowing fails if a longer value was stored since: that is intended,
    # the data would not fit.
    op.execute(_widen_target("pending_relations", 100))
    op.execute(_widen_target("extraction_candidates", 100))
    op.execute("ALTER TABLE extraction_candidates DROP COLUMN IF EXISTS target_text")
    op.execute("ALTER TABLE extraction_candidates DROP COLUMN IF EXISTS source_text")
