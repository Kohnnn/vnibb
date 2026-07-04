"""add_prediction_market_snapshots

Revision ID: a5d6e7f8c901
Revises: 9b0f2c6d4e71
Create Date: 2026-07-05 05:00:00.000000

QA-v4 Phase 7.4: per-market YES-price snapshots used to power
`/api/v1/prediction-markets/movers` and any future trend endpoints.

A snapshot row is one (source, source_id) pair's YES probability at a point
in time. The nightly job in
`vnibb.services.prediction_market_snapshot_service` appends a fresh row per
active market; the movers endpoint diffs the latest snapshot against a
historical one captured ``window`` hours ago.

Retention is enforced by the snapshot job itself (30 days); this migration
only creates the table and indexes.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a5d6e7f8c901"
down_revision: str | None = "9b0f2c6d4e71"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE_NAME = "prediction_market_snapshots"
SOURCE_CAPTURED_INDEX = "ix_prediction_market_snapshots_source_captured_at"
CAPTURED_INDEX = "ix_prediction_market_snapshots_captured_at"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if TABLE_NAME in table_names:
        # Re-running the migration is a no-op (the snapshot job is
        # idempotent, the table may already exist from a previous run).
        return

    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # market_id is a soft FK (no constraint) so ingestion stays robust
        # if a contract is removed from the parent table.
        sa.Column("market_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("question", sa.String(length=512), nullable=False),
        sa.Column("url", sa.String(length=512), nullable=True),
        sa.Column("yes_price", sa.Float(), nullable=False),
        sa.Column("volume", sa.Float(), nullable=True),
        sa.Column("liquidity", sa.Float(), nullable=True),
        sa.Column("extra", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        SOURCE_CAPTURED_INDEX,
        TABLE_NAME,
        ["source", "captured_at"],
        unique=False,
    )
    op.create_index(
        CAPTURED_INDEX,
        TABLE_NAME,
        ["captured_at"],
        unique=False,
    )
    # Per-market reverse index supports the (rare) cleanup-by-market query.
    op.create_index(
        "ix_prediction_market_snapshots_market_id",
        TABLE_NAME,
        ["market_id"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if TABLE_NAME not in table_names:
        return

    for index in (
        SOURCE_CAPTURED_INDEX,
        CAPTURED_INDEX,
        "ix_prediction_market_snapshots_market_id",
    ):
        try:
            op.drop_index(index, table_name=TABLE_NAME)
        except Exception:
            # Indexes may have been dropped already; downgrade is best-effort.
            pass
    op.drop_table(TABLE_NAME)