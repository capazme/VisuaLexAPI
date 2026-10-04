"""massimario_ingestion

Massimario batches stage chunks next to nodes/edges (`extras`), and
`massimario` is a batch source. The same statements live in
``merlt/storage/migrations/006_massimario_ingestion.sql`` and in
``merlt/storage/enrichment/schema_additions.py`` (applied at boot).

Revision ID: 010_massimario_ingestion
Revises: 009_user_documents_owner_dedup
Create Date: 2026-10-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = '010_massimario_ingestion'
down_revision: Union[str, None] = '009_user_documents_owner_dedup'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE merlt_ingestion_batches ADD COLUMN IF NOT EXISTS extras JSON")
    op.execute("ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source")
    op.execute(
        "ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source "
        "CHECK (source IN ('visualex_tree','italia_corpus','massimario'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source")
    op.execute(
        "ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source "
        "CHECK (source IN ('visualex_tree','italia_corpus'))"
    )
    op.execute("ALTER TABLE merlt_ingestion_batches DROP COLUMN IF EXISTS extras")
