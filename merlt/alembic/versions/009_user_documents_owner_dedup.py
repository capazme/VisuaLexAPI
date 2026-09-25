"""user_documents_owner_dedup

Upload dedup per user. The global UNIQUE on ``user_documents.file_hash`` gave
user B user A's document id for a byte-identical file (and let B probe which
files A had uploaded); uniqueness becomes ``(file_hash, uploaded_by)``.

Idempotent (``DROP CONSTRAINT IF EXISTS``, ``CREATE UNIQUE INDEX IF NOT
EXISTS``): safe on a database bootstrapped by ``create_tables()`` that never
ran Alembic. The same statements live in
``merlt/storage/migrations/005_user_documents_owner_dedup.sql`` and in
``merlt/storage/enrichment/schema_additions.py`` (applied at boot).

Revision ID: 009_user_documents_owner_dedup
Revises: 008_relation_endpoints
Create Date: 2026-09-25 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '009_user_documents_owner_dedup'
down_revision: Union[str, None] = '008_relation_endpoints'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # unique=True + index=True made SQLAlchemy emit a UNIQUE INDEX named
    # ix_user_documents_file_hash: demote it to a plain index.
    op.execute(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM pg_indexes "
        "WHERE schemaname = current_schema() AND indexname = 'ix_user_documents_file_hash' "
        "AND indexdef LIKE 'CREATE UNIQUE INDEX%') THEN "
        "DROP INDEX ix_user_documents_file_hash; "
        "CREATE INDEX ix_user_documents_file_hash ON user_documents (file_hash); "
        "END IF; END $$"
    )
    op.execute("ALTER TABLE user_documents DROP CONSTRAINT IF EXISTS user_documents_file_hash_key")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_documents_hash_owner "
        "ON user_documents (file_hash, uploaded_by)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_user_documents_hash_owner")
    op.execute("DROP INDEX IF EXISTS ix_user_documents_file_hash")
    op.execute("CREATE UNIQUE INDEX ix_user_documents_file_hash ON user_documents (file_hash)")
