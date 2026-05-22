"""add_api_keys_table

Epic 10: API & External Integration (FR45)
- Story 10-1: api_keys table for API credential management

Revision ID: 003_add_api_keys_table
Revises: baafa63897a6
Create Date: 2026-02-16 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '003_add_api_keys_table'
down_revision: Union[str, None] = 'baafa63897a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('api_keys',
        sa.Column('key_id', sa.String(length=50), nullable=False),
        sa.Column('api_key_hash', sa.String(length=64), nullable=False),
        sa.Column('role', sa.String(length=20), server_default='user', nullable=True),
        sa.Column('rate_limit_tier', sa.String(length=20), server_default='standard', nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('user_id', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('key_id'),
        sa.UniqueConstraint('api_key_hash'),
        sa.CheckConstraint("role IN ('admin', 'user', 'guest')", name='chk_api_key_role'),
        sa.CheckConstraint(
            "rate_limit_tier IN ('unlimited', 'premium', 'standard', 'limited')",
            name='chk_api_key_tier',
        ),
    )
    op.create_index('idx_api_keys_hash', 'api_keys', ['api_key_hash'], unique=True)
    op.create_index('idx_api_keys_user', 'api_keys', ['user_id'], unique=False)
    op.create_index('idx_api_keys_active', 'api_keys', ['is_active'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_api_keys_active', table_name='api_keys')
    op.drop_index('idx_api_keys_user', table_name='api_keys')
    op.drop_index('idx_api_keys_hash', table_name='api_keys')
    op.drop_table('api_keys')
