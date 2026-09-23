"""Persist scheduler job outcomes and worker heartbeat for cross-process status."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6a9c2d41b83"
down_revision: str | None = "c4f8b2e17d30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scheduler_job_state",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("name", sa.String(256)),
        sa.Column("trigger", sa.String(256)),
        sa.Column("next_run", sa.DateTime()),
        sa.Column("last_outcome", sa.String(16)),
        sa.Column("last_detail", sa.String(128)),
        sa.Column("last_at", sa.DateTime()),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False),
    )
    op.create_table(
        "scheduler_worker_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=False),
        sa.Column("running", sa.Boolean(), nullable=False),
        sa.Column("missed_runs", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("scheduler_worker_state")
    op.drop_table("scheduler_job_state")
