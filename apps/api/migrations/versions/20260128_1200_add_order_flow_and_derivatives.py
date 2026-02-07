"""add_order_flow_and_derivatives

Revision ID: 5b2c7d8f3a10
Revises: 1aaa2a1cf198
Create Date: 2026-01-28 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5b2c7d8f3a10"
down_revision: Union[str, None] = "1aaa2a1cf198"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "order_flow_daily",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer, "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("symbol", sa.String(length=10), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("buy_volume", sa.BigInteger(), nullable=True),
        sa.Column("sell_volume", sa.BigInteger(), nullable=True),
        sa.Column("buy_value", sa.Float(), nullable=True),
        sa.Column("sell_value", sa.Float(), nullable=True),
        sa.Column("net_volume", sa.BigInteger(), nullable=True),
        sa.Column("net_value", sa.Float(), nullable=True),
        sa.Column("foreign_buy_volume", sa.BigInteger(), nullable=True),
        sa.Column("foreign_sell_volume", sa.BigInteger(), nullable=True),
        sa.Column("foreign_net_volume", sa.BigInteger(), nullable=True),
        sa.Column("proprietary_buy_volume", sa.BigInteger(), nullable=True),
        sa.Column("proprietary_sell_volume", sa.BigInteger(), nullable=True),
        sa.Column("proprietary_net_volume", sa.BigInteger(), nullable=True),
        sa.Column("big_order_count", sa.Integer(), nullable=True),
        sa.Column("block_trade_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_order_flow_daily")),
        sa.UniqueConstraint("symbol", "trade_date", name="uq_order_flow_symbol_date"),
    )
    with op.batch_alter_table("order_flow_daily", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_order_flow_daily_symbol"),
            ["symbol"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_order_flow_daily_trade_date"),
            ["trade_date"],
            unique=False,
        )
        batch_op.create_index(
            "ix_order_flow_symbol_date",
            ["symbol", "trade_date"],
            unique=False,
        )

    op.create_table(
        "derivative_prices",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer, "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("open", sa.Float(), nullable=True),
        sa.Column("high", sa.Float(), nullable=True),
        sa.Column("low", sa.Float(), nullable=True),
        sa.Column("close", sa.Float(), nullable=True),
        sa.Column("volume", sa.BigInteger(), nullable=True),
        sa.Column("open_interest", sa.BigInteger(), nullable=True),
        sa.Column("interval", sa.String(length=5), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_derivative_prices")),
        sa.UniqueConstraint(
            "symbol",
            "trade_date",
            "interval",
            name="uq_derivative_symbol_date_interval",
        ),
    )
    with op.batch_alter_table("derivative_prices", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_derivative_prices_symbol"),
            ["symbol"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_derivative_prices_trade_date"),
            ["trade_date"],
            unique=False,
        )
        batch_op.create_index(
            "ix_derivative_symbol_date",
            ["symbol", "trade_date"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("derivative_prices", schema=None) as batch_op:
        batch_op.drop_index("ix_derivative_symbol_date")
        batch_op.drop_index(batch_op.f("ix_derivative_prices_trade_date"))
        batch_op.drop_index(batch_op.f("ix_derivative_prices_symbol"))
    op.drop_table("derivative_prices")

    with op.batch_alter_table("order_flow_daily", schema=None) as batch_op:
        batch_op.drop_index("ix_order_flow_symbol_date")
        batch_op.drop_index(batch_op.f("ix_order_flow_daily_trade_date"))
        batch_op.drop_index(batch_op.f("ix_order_flow_daily_symbol"))
    op.drop_table("order_flow_daily")
