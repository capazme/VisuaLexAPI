"""add_ingestion_schedule_and_feedback_quarantine

Epic 9: Admin & Monitoring
- Story 9-2: ingestion_schedules table
- Story 9-5: qa_feedback quarantine fields (status, quarantine_reason, flagged_*, reviewed_*)
- Also: aggregated_feedback table (pre-existing model, missing migration)

Revision ID: baafa63897a6
Revises: 002_add_audit_da_tables
Create Date: 2026-02-16 08:36:40.258463
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'baafa63897a6'
down_revision: Union[str, None] = '002_add_audit_da_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -- Story 9-2: ingestion_schedules table --
    op.create_table('ingestion_schedules',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('tipo_atto', sa.String(length=100), nullable=False),
        sa.Column('cron_expr', sa.String(length=100), nullable=False),
        sa.Column('enabled', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('last_run_at', sa.DateTime(), nullable=True),
        sa.Column('last_run_status', sa.String(length=20), nullable=True),
        sa.Column('next_run_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_ingestion_schedules_enabled', 'ingestion_schedules', ['enabled'], unique=False)
    op.create_index('idx_ingestion_schedules_tipo', 'ingestion_schedules', ['tipo_atto'], unique=False)

    # -- aggregated_feedback table (pre-existing model) --
    op.create_table('aggregated_feedback',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('component', sa.String(length=50), nullable=False),
        sa.Column('period_start', sa.DateTime(), nullable=False),
        sa.Column('period_end', sa.DateTime(), nullable=False),
        sa.Column('avg_rating', sa.Float(), nullable=True),
        sa.Column('authority_weighted_avg', sa.Float(), nullable=True),
        sa.Column('disagreement_score', sa.Float(), nullable=True),
        sa.Column('total_feedback', sa.Integer(), nullable=True),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_aggregated_feedback_component'), 'aggregated_feedback', ['component'], unique=False)

    # -- Story 9-5: qa_feedback quarantine fields --
    op.add_column('qa_feedback', sa.Column('status', sa.String(length=20), server_default='approved', nullable=False))
    op.add_column('qa_feedback', sa.Column('quarantine_reason', sa.Text(), nullable=True))
    op.add_column('qa_feedback', sa.Column('flagged_at', sa.DateTime(), nullable=True))
    op.add_column('qa_feedback', sa.Column('flagged_by', sa.String(length=50), nullable=True))
    op.add_column('qa_feedback', sa.Column('reviewed_at', sa.DateTime(), nullable=True))
    op.add_column('qa_feedback', sa.Column('reviewed_by', sa.String(length=50), nullable=True))
    op.create_index('idx_qa_feedback_status', 'qa_feedback', ['status'], unique=False)


def downgrade() -> None:
    # -- Story 9-5: remove quarantine fields --
    op.drop_index('idx_qa_feedback_status', table_name='qa_feedback')
    op.drop_column('qa_feedback', 'reviewed_by')
    op.drop_column('qa_feedback', 'reviewed_at')
    op.drop_column('qa_feedback', 'flagged_by')
    op.drop_column('qa_feedback', 'flagged_at')
    op.drop_column('qa_feedback', 'quarantine_reason')
    op.drop_column('qa_feedback', 'status')

    # -- aggregated_feedback --
    op.drop_index(op.f('ix_aggregated_feedback_component'), table_name='aggregated_feedback')
    op.drop_table('aggregated_feedback')

    # -- Story 9-2: ingestion_schedules --
    op.drop_index('idx_ingestion_schedules_tipo', table_name='ingestion_schedules')
    op.drop_index('idx_ingestion_schedules_enabled', table_name='ingestion_schedules')
    op.drop_table('ingestion_schedules')
