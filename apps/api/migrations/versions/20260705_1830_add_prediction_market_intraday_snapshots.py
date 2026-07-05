"""add_prediction_market_intraday_snapshots

Revision ID: b6c7d8e9f012
Revises: a5d6e7f8c901
Create Date: 2026-07-05 18:30:00.000000

QA-v4 Phase 8: per-market intraday YES-price micro-snapshots powering
``/movers?window=1h``, ``/alerts`` and ``/history``.

Snapshot rows are written every 15 minutes by the new
``prediction_market_intraday_snapshot_service`` and retained for 7 days by
the same service. The composite index supports the (source, source_id,
captured_at) diff query used by the movers / alerts / history endpoints.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "b6c7d8e9f012"
down_revision: str | None = "a5d6e7f8c901"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE_NAME = "prediction_market_intraday_snapshots"
SOURCE_CAPTURED_INDEX = "ix_prediction_market_intraday_snapshots_source_captured_at"
CAPTURED_INDEX = "ix_prediction_market_intraday_snapshots_captured_at"
COMPOSITE_INDEX = (
    "ix_prediction_market_intraday_snapshots_source_pair_captured"
)
MARKET_INDEX = "ix_prediction_market_intraday_snapshots_market_id"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if TABLE_NAME in table_names:
        return

    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
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
    op.create_index(SOURCE_CAPTURED_INDEX, TABLE_NAME, ["source", "captured_at"], unique=False)
    op.create_index(CAPTURED_INDEX, TABLE_NAME, ["captured_at"], unique=False)
    op.create_index(MARKET_INDEX, TABLE_NAME, ["market_id"], unique=False)
    op.create_index(
        COMPOSITE_INDEX,
        TABLE_NAME,
        ["source", "source_id", "captured_at"],
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
        MARKET_INDEX,
        COMPOSITE_INDEX,
    ):
        try:
            op.drop_index(index, table_name=TABLE_NAME)
        except Exception:
            pass
    op.drop_table(TABLE_NAME)