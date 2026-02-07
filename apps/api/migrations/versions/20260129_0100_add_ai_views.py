"""add_ai_views

Revision ID: c4e9a2d1f7b3
Revises: 5d9f28a7e4c1
Create Date: 2026-01-29 01:00:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c4e9a2d1f7b3"
down_revision: Union[str, None] = "5d9f28a7e4c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return
    op.execute(
        """
        CREATE OR REPLACE VIEW ai_stock_snapshot AS
        SELECT
            s.symbol,
            s.company_name,
            s.exchange,
            s.industry,
            sp.close AS last_close,
            sp.time AS last_price_time,
            ofd.trade_date AS orderflow_date,
            ofd.buy_volume AS orderflow_buy_volume,
            ofd.sell_volume AS orderflow_sell_volume,
            ofd.net_volume AS orderflow_net_volume,
            ofd.buy_value AS orderflow_buy_value,
            ofd.sell_value AS orderflow_sell_value,
            ofd.net_value AS orderflow_net_value,
            ft.trade_date AS foreign_trade_date,
            ft.buy_volume AS foreign_buy_volume,
            ft.sell_volume AS foreign_sell_volume,
            ft.net_volume AS foreign_net_volume,
            ft.buy_value AS foreign_buy_value,
            ft.sell_value AS foreign_sell_value,
            ft.net_value AS foreign_net_value,
            ss.snapshot_date AS screener_date,
            ss.market_cap,
            ss.pe,
            ss.pb,
            ss.roe,
            ss.roa,
            ss.eps
        FROM stocks s
        LEFT JOIN LATERAL (
            SELECT time, close
            FROM stock_prices
            WHERE symbol = s.symbol AND interval = '1D'
            ORDER BY time DESC
            LIMIT 1
        ) sp ON TRUE
        LEFT JOIN LATERAL (
            SELECT *
            FROM order_flow_daily
            WHERE symbol = s.symbol
            ORDER BY trade_date DESC
            LIMIT 1
        ) ofd ON TRUE
        LEFT JOIN LATERAL (
            SELECT *
            FROM foreign_trading
            WHERE symbol = s.symbol
            ORDER BY trade_date DESC
            LIMIT 1
        ) ft ON TRUE
        LEFT JOIN LATERAL (
            SELECT *
            FROM screener_snapshots
            WHERE symbol = s.symbol
            ORDER BY snapshot_date DESC
            LIMIT 1
        ) ss ON TRUE;
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS ai_stock_snapshot")
