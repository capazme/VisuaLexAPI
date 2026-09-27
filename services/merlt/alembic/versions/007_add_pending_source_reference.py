"""add_pending_source_reference

Promotion provenance (Slice 2c / community validation). A community proposal
carries the contributor's bibliographic citation ("Torrente, p. 123") or, for a
Loop β confirm-source, the URL of the live source. `fonte` is a varchar(50)
pipeline tag and cannot hold free text, so the citation gets its own nullable
column on both pending tables.

Also relabels manual relation proposals: `propose-relation` never set `fonte`,
so every community relation was stored with the column default
'llm_extraction' and shown as an LLM extraction in the validation queue. Only
`propose-relation` writes `source_type='manual'` relations, so the backfill is
targeted and cannot touch a real LLM row.

Idempotent (`ADD COLUMN IF NOT EXISTS`, guarded UPDATE): safe on a database
bootstrapped by `create_tables()` that never ran Alembic. The same statements
live in `merlt/storage/migrations/003_pending_source_reference.sql` for psql.

Revision ID: 007_add_pending_source_reference
Revises: 006_add_merlt_users
Create Date: 2026-09-25 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '007_add_pending_source_reference'
down_revision: Union[str, None] = '006_add_merlt_users'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE pending_entities ADD COLUMN IF NOT EXISTS source_reference TEXT")
    op.execute("ALTER TABLE pending_relations ADD COLUMN IF NOT EXISTS source_reference TEXT")
    op.execute(
        "UPDATE pending_relations SET fonte = 'community' "
        "WHERE source_type = 'manual' AND (fonte IS NULL OR fonte = 'llm_extraction')"
    )


def downgrade() -> None:
    # The fonte relabel is a correction, not a schema change: it is not undone.
    op.execute("ALTER TABLE pending_relations DROP COLUMN IF EXISTS source_reference")
    op.execute("ALTER TABLE pending_entities DROP COLUMN IF EXISTS source_reference")
