from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d8e9f0123456"
down_revision: str | None = "c7d8e9f01234"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNS_TABLE = "data_quality_runs"
BREACH_STATES_TABLE = "data_quality_breach_states"


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if RUNS_TABLE not in tables:
        op.create_table(
            RUNS_TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_id", sa.String(length=128), nullable=False, unique=True),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("source", sa.String(length=64), nullable=False),
            sa.Column("dataset", sa.String(length=128), nullable=False),
            sa.Column("observed_market_date", sa.Date(), nullable=True),
            sa.Column("latest_market_date", sa.Date(), nullable=True),
            sa.Column("market_day_staleness", sa.Integer(), nullable=True),
            sa.Column("summary_counts", sa.JSON(), nullable=True),
            sa.Column("error_category", sa.String(length=64), nullable=True),
        )
        op.create_index("ix_data_quality_runs_started_at", RUNS_TABLE, ["started_at"])
        op.create_index("ix_data_quality_runs_completed_at", RUNS_TABLE, ["completed_at"])
        op.create_index("ix_data_quality_runs_status", RUNS_TABLE, ["status"])
        op.create_index("ix_data_quality_runs_source", RUNS_TABLE, ["source"])
        op.create_index("ix_data_quality_runs_dataset", RUNS_TABLE, ["dataset"])
        op.create_index(
            "ix_data_quality_runs_observed_market_date", RUNS_TABLE, ["observed_market_date"]
        )
        op.create_index(
            "ix_data_quality_runs_source_completed", RUNS_TABLE, ["source", "completed_at"]
        )
        op.create_index(
            "ix_data_quality_runs_observed_completed",
            RUNS_TABLE,
            ["observed_market_date", "completed_at"],
        )
    if BREACH_STATES_TABLE not in tables:
        op.create_table(
            BREACH_STATES_TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("breach_key", sa.String(length=192), nullable=False),
            sa.Column("source", sa.String(length=64), nullable=False),
            sa.Column("dataset", sa.String(length=128), nullable=False),
            sa.Column("category", sa.String(length=64), nullable=False),
            sa.Column("first_seen_at", sa.DateTime(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(), nullable=False),
            sa.Column("consecutive_runs", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("sustained_at", sa.DateTime(), nullable=True),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("breach_key", name="uq_data_quality_breach_states_key"),
        )
        op.create_index("ix_data_quality_breach_states_source", BREACH_STATES_TABLE, ["source"])
        op.create_index("ix_data_quality_breach_states_dataset", BREACH_STATES_TABLE, ["dataset"])
        op.create_index(
            "ix_data_quality_breach_states_active",
            BREACH_STATES_TABLE,
            ["source", "dataset", "resolved_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if BREACH_STATES_TABLE in tables:
        op.drop_table(BREACH_STATES_TABLE)
    if RUNS_TABLE in tables:
        op.drop_table(RUNS_TABLE)
