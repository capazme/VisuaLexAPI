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
    op.execute(
        "DO $$ BEGIN "
        "IF to_regclass('bridge_table') IS NOT NULL THEN "
        "ALTER TABLE bridge_table ADD COLUMN IF NOT EXISTS expert_affinity JSONB; "
        "IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indrelid = 'bridge_table'::regclass AND indisunique "
        "AND pg_get_indexdef(indexrelid) LIKE '%(chunk_id, graph_node_urn)') THEN "
        "CREATE UNIQUE INDEX uq_bridge_chunk_node ON bridge_table (chunk_id, graph_node_urn); "
        "END IF; "
        "CREATE INDEX IF NOT EXISTS idx_bridge_source ON bridge_table (source); "
        "END IF; END $$"
    )


def downgrade() -> None:
    # expert_affinity stays: the ORM model expects it
    op.execute("DROP INDEX IF EXISTS uq_bridge_chunk_node")
    op.execute("DROP INDEX IF EXISTS idx_bridge_source")
    op.execute("ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source")
    op.execute(
        "ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source "
        "CHECK (source IN ('visualex_tree','italia_corpus'))"
    )
    op.execute("ALTER TABLE merlt_ingestion_batches DROP COLUMN IF EXISTS extras")
