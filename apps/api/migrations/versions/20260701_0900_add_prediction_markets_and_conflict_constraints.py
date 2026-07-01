"""add_prediction_markets_and_conflict_constraints

Revision ID: 9b0f2c6d4e71
Revises: 7f3a8d1e6b22
Create Date: 2026-07-01 09:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence
from typing import NamedTuple

import sqlalchemy as sa
from alembic import op

revision: str = "9b0f2c6d4e71"
down_revision: str | None = "7f3a8d1e6b22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


class UniqueConstraintSpec(NamedTuple):
    table_name: str
    name: str
    columns: tuple[str, ...]
    dedupe_order_by: str


REQUIRED_UNIQUE_CONSTRAINTS: tuple[UniqueConstraintSpec, ...] = (
    UniqueConstraintSpec(
        "foreign_trading",
        "uq_foreign_trading_symbol_date",
        ("symbol", "trade_date"),
        "updated_at DESC NULLS LAST, id DESC",
    ),
    UniqueConstraintSpec(
        "market_news",
        "uq_market_news_url",
        ("url",),
        "crawled_at DESC NULLS LAST, id DESC",
    ),
    UniqueConstraintSpec(
        "stock_prices",
        "uq_stock_price_symbol_time_interval",
        ("symbol", "time", "interval"),
        "id DESC",
    ),
    UniqueConstraintSpec(
        "prediction_markets",
        "uq_prediction_markets_source_id",
        ("source", "source_id"),
        "updated_at DESC NULLS LAST, id DESC",
    ),
)
PREDICTION_MARKETS_TABLE = "prediction_markets"
PREEXISTING_TABLE_CONSTRAINTS = REQUIRED_UNIQUE_CONSTRAINTS[:-1]
PREDICTION_MARKET_CONSTRAINT = REQUIRED_UNIQUE_CONSTRAINTS[-1]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    for spec in PREEXISTING_TABLE_CONSTRAINTS:
        _ensure_unique_constraint(inspector, table_names, spec)

    if PREDICTION_MARKETS_TABLE not in table_names:
        op.create_table(
            PREDICTION_MARKETS_TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source", sa.String(length=32), nullable=False),
            sa.Column("source_id", sa.String(length=128), nullable=False),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("slug", sa.String(length=255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("url", sa.Text(), nullable=True),
            sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("closed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("volume", sa.Float(), nullable=True),
            sa.Column("liquidity", sa.Float(), nullable=True),
            sa.Column("outcomes", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("outcome_prices", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint(
                "source",
                "source_id",
                name="uq_prediction_markets_source_id",
            ),
        )
        op.create_index(
            "ix_prediction_markets_source_active",
            PREDICTION_MARKETS_TABLE,
            ["source", "active"],
            unique=False,
        )
        op.create_index(
            "ix_prediction_markets_end_date",
            PREDICTION_MARKETS_TABLE,
            ["end_date"],
            unique=False,
        )
        return

    _ensure_unique_constraint(inspector, table_names, PREDICTION_MARKET_CONSTRAINT)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if PREDICTION_MARKETS_TABLE in table_names:
        op.drop_index("ix_prediction_markets_end_date", table_name=PREDICTION_MARKETS_TABLE)
        op.drop_index("ix_prediction_markets_source_active", table_name=PREDICTION_MARKETS_TABLE)
        op.drop_table(PREDICTION_MARKETS_TABLE)


def _ensure_unique_constraint(
    inspector: sa.Inspector,
    table_names: set[str],
    spec: UniqueConstraintSpec,
) -> None:
    if spec.table_name not in table_names or _has_unique_constraint(inspector, spec):
        return

    column_names = {column["name"] for column in inspector.get_columns(spec.table_name)}
    if not set(spec.columns).issubset(column_names):
        return

    _dedupe_rows(spec)
    with op.batch_alter_table(spec.table_name, schema=None) as batch_op:
        batch_op.create_unique_constraint(spec.name, list(spec.columns))


def _has_unique_constraint(inspector: sa.Inspector, spec: UniqueConstraintSpec) -> bool:
    constraint_names = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(spec.table_name)
    }
    unique_index_names = {
        index["name"]
        for index in inspector.get_indexes(spec.table_name)
        if index.get("unique")
    }
    return spec.name in constraint_names or spec.name in unique_index_names


def _dedupe_rows(spec: UniqueConstraintSpec) -> None:
    partition_columns = ", ".join(spec.columns)
    present_columns = " AND ".join(f"{column} IS NOT NULL" for column in spec.columns)
    op.execute(
        sa.text(
            f"""
            WITH ranked AS (
                SELECT id,
                       row_number() OVER (
                           PARTITION BY {partition_columns}
                           ORDER BY {spec.dedupe_order_by}
                       ) AS row_number
                FROM {spec.table_name}
                WHERE {present_columns}
            )
            DELETE FROM {spec.table_name}
            WHERE id IN (SELECT id FROM ranked WHERE row_number > 1)
            """
        )
    )
