"""add_extraction_candidates

Slice 2c — "Apprendi dai miei appunti". Ephemeral staging table for candidates
extracted from user documents, before per-item promotion to pending_*.

Revision ID: 005_add_extraction_candidates
Revises: 004_add_weight_versions_table
Create Date: 2026-05-26 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '005_add_extraction_candidates'
down_revision: Union[str, None] = '004_add_weight_versions_table'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'extraction_candidates',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('document_id', sa.Integer(), nullable=False),
        sa.Column('contributor_id', sa.String(length=100), nullable=False),
        sa.Column('candidate_type', sa.String(length=20), nullable=False),
        sa.Column('entity_text', sa.Text(), nullable=True),
        sa.Column('entity_type', sa.String(length=50), nullable=True),
        sa.Column('relation_type', sa.String(length=100), nullable=True),
        sa.Column('source_node_urn', sa.String(length=300), nullable=True),
        sa.Column('target_entity_id', sa.String(length=100), nullable=True),
        sa.Column('article_urn', sa.String(length=300), nullable=True),
        sa.Column('descrizione', sa.Text(), nullable=True),
        sa.Column('verbatim_excerpt', sa.Text(), nullable=True),
        sa.Column('llm_confidence', sa.Float(), nullable=True),
        sa.Column('llm_model', sa.String(length=100), nullable=True),
        sa.Column('potential_duplicate_of', sa.String(length=100), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='draft', nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['document_id'], ['user_documents.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_extraction_candidates_document', 'extraction_candidates', ['document_id'], unique=False
    )
    op.create_index(
        'idx_extraction_candidates_contributor',
        'extraction_candidates',
        ['contributor_id'],
        unique=False,
    )
    op.create_index(
        'idx_extraction_candidates_status', 'extraction_candidates', ['status'], unique=False
    )
    op.create_index(
        'idx_extraction_candidates_expires', 'extraction_candidates', ['expires_at'], unique=False
    )


def downgrade() -> None:
    op.drop_index('idx_extraction_candidates_expires', table_name='extraction_candidates')
    op.drop_index('idx_extraction_candidates_status', table_name='extraction_candidates')
    op.drop_index('idx_extraction_candidates_contributor', table_name='extraction_candidates')
    op.drop_index('idx_extraction_candidates_document', table_name='extraction_candidates')
    op.drop_table('extraction_candidates')
