"""Add audit_log and devils_advocate_log tables.

Story 6-9 (Audit Trail) + TD-6 (Devil's Advocate persistence).

Revision ID: 002_add_audit_da_tables
Revises: 001_initial_baseline
Create Date: 2026-02-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_add_audit_da_tables"
down_revision: Union[str, None] = "001_initial_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Audit log table (Story 6-9)
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("timestamp", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("actor_hash", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(100), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("consent_level", sa.String(20), nullable=True),
        sa.Column("prev_hash", sa.String(64), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_audit_log_timestamp", "audit_log", ["timestamp"])
    op.create_index("idx_audit_log_action", "audit_log", ["action"])
    op.create_index("idx_audit_log_resource", "audit_log", ["resource_type", "resource_id"])

    # Devil's Advocate log table (TD-6)
    op.create_table(
        "devils_advocate_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("trace_id", sa.String(50), nullable=False),
        sa.Column("triggered_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("critical_prompt", sa.Text(), nullable=True),
        sa.Column("feedback_text", sa.Text(), nullable=True),
        sa.Column("assessment", sa.String(20), nullable=True),
        sa.Column("engagement_score", sa.Float(), nullable=True),
        sa.Column("keywords_found", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_da_log_trace", "devils_advocate_log", ["trace_id"])
    op.create_index("idx_da_log_created", "devils_advocate_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_da_log_created", table_name="devils_advocate_log")
    op.drop_index("idx_da_log_trace", table_name="devils_advocate_log")
    op.drop_table("devils_advocate_log")

    op.drop_index("idx_audit_log_resource", table_name="audit_log")
    op.drop_index("idx_audit_log_action", table_name="audit_log")
    op.drop_index("idx_audit_log_timestamp", table_name="audit_log")
    op.drop_table("audit_log")
