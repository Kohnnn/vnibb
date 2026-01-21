"""
Add performance indexes for database optimization.

Revision ID: 5a74881719e
Revises: 20260114_0300_sync_status
Create Date: 2026-01-14 22:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5a74881719e'
down_revision = '20260114_0300_sync_status'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Screener Snapshot performance indexes
    # Filter by date is almost always present, then by market cap and valuation
    op.create_index(
        'ix_screener_date_market_cap_pe',
        'screener_snapshots',
        ['snapshot_date', 'market_cap', 'pe']
    )
    
    # 2. Stock Prices performance indexes
    # Symbol + Interval + Time is the primary query pattern for charts
    op.create_index(
        'ix_stock_prices_symbol_interval_time',
        'stock_prices',
        ['symbol', 'interval', 'time']
    )
    
    # 3. Financial Statements performance indexes
    # Symbol + Period Type + Year for fast lookup of historical statements
    op.create_index(
        'ix_income_stmt_lookup',
        'income_statements',
        ['symbol', 'period_type', 'fiscal_year']
    )
    op.create_index(
        'ix_balance_sheet_lookup',
        'balance_sheets',
        ['symbol', 'period_type', 'fiscal_year']
    )
    op.create_index(
        'ix_cash_flow_lookup',
        'cash_flows',
        ['symbol', 'period_type', 'fiscal_year']
    )
    
    # 4. News performance indexes
    # Already has ix_news_symbol_published, but let's add one for global news feed
    op.create_index(
        'ix_company_news_published_at',
        'company_news',
        ['published_date']
    )


def downgrade():
    op.drop_index('ix_company_news_published_at', table_name='company_news')
    op.drop_index('ix_cash_flow_lookup', table_name='cash_flows')
    op.drop_index('ix_balance_sheet_lookup', table_name='balance_sheets')
    op.drop_index('ix_income_stmt_lookup', table_name='income_statements')
    op.drop_index('ix_stock_prices_symbol_interval_time', table_name='stock_prices')
    op.drop_index('ix_screener_date_market_cap_pe', table_name='screener_snapshots')
