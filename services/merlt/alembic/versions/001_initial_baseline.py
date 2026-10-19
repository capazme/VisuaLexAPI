"""Initial baseline — stamp existing schema.

This is a baseline migration that records the current schema state.
All tables already exist in the database (created by create_all()).
Running `alembic stamp head` marks this revision as applied without
executing any DDL.

Revision ID: 001_initial_baseline
Revises: None
Create Date: 2026-02-15
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "001_initial_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline migration: all tables already exist via create_all().
    # This revision is stamped (not executed) on existing databases.
    # Future migrations will build on this baseline.
    pass


def downgrade() -> None:
    # Cannot downgrade the initial baseline.
    pass
