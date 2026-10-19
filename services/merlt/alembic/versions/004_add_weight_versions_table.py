"""add_weight_versions_table

P1 R-017: Persist weight versions to database so they survive restarts.

Revision ID: 004_add_weight_versions_table
Revises: 003_add_api_keys_table
Create Date: 2026-02-17 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '004_add_weight_versions_table'
down_revision: Union[str, None] = '003_add_api_keys_table'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('weight_versions',
        sa.Column('id', sa.String(length=50), nullable=False),
        sa.Column('experiment_id', sa.String(length=100), nullable=False),
        sa.Column('version_tag', sa.String(length=50), nullable=True),
        sa.Column('config_json', sa.JSON(), nullable=True),
        sa.Column('metrics_json', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.Column('created_by', sa.String(length=100), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_weight_versions_experiment', 'weight_versions', ['experiment_id'], unique=False)
    op.create_index('idx_weight_versions_active', 'weight_versions', ['is_active'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_weight_versions_active', table_name='weight_versions')
    op.drop_index('idx_weight_versions_experiment', table_name='weight_versions')
    op.drop_table('weight_versions')
