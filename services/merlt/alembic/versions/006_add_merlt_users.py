"""add_merlt_users

Wave 3 GAP 1 — persist user qualification, baseline B_u and notification
preferences (previously computed on the fly and never saved: `PATCH
/profile/qualification` and `PATCH /profile/notifications` both returned
"data not persisted - users table not yet implemented").

Revision ID: 006_add_merlt_users
Revises: 005_add_extraction_candidates
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '006_add_merlt_users'
down_revision: Union[str, None] = '005_add_extraction_candidates'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'merlt_users',
        sa.Column('user_id', sa.String(length=100), nullable=False),
        sa.Column('display_name', sa.String(length=200), nullable=True),
        sa.Column('qualification', sa.String(length=50), nullable=True),
        sa.Column('specializations', sa.JSON(), nullable=True),
        sa.Column('years_experience', sa.Integer(), nullable=True),
        sa.Column('baseline_bu', sa.Float(), server_default='0.3', nullable=True),
        sa.Column('email_on_validation', sa.Boolean(), server_default=sa.text('true'), nullable=True),
        sa.Column('email_on_authority_change', sa.Boolean(), server_default=sa.text('true'), nullable=True),
        sa.Column('email_weekly_summary', sa.Boolean(), server_default=sa.text('false'), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('user_id'),
    )


def downgrade() -> None:
    op.drop_table('merlt_users')
