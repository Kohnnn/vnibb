"""Initial VNIBB schema

Revision ID: 0001_initial
Revises: 
Create Date: 2026-01-06

Creates all core tables:
- stocks: Master stock list
- stock_prices: Historical OHLCV data
- stock_indices: Market index data
- income_statements, balance_sheets, cash_flows: Financial statements
- screener_snapshots: Daily screener metrics
- companies, shareholders, officers: Company profile data
- user_dashboards, dashboard_widgets: Dashboard configuration
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # === STOCKS ===
    op.create_table(
        'stocks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('isin', sa.String(20), nullable=True),
        sa.Column('company_name', sa.String(255), nullable=True),
        sa.Column('short_name', sa.String(100), nullable=True),
        sa.Column('exchange', sa.String(10), nullable=False, server_default='HOSE'),
        sa.Column('industry', sa.String(100), nullable=True),
        sa.Column('sector', sa.String(100), nullable=True),
        sa.Column('is_active', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('listing_date', sa.Date(), nullable=True),
        sa.Column('delisting_date', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_stocks'),
        sa.UniqueConstraint('symbol', name='uq_stocks_symbol'),
        sa.UniqueConstraint('isin', name='uq_stocks_isin'),
    )
    op.create_index('ix_stocks_symbol', 'stocks', ['symbol'])
    op.create_index('ix_stocks_exchange', 'stocks', ['exchange'])
    op.create_index('ix_stocks_industry', 'stocks', ['industry'])

    # === STOCK PRICES ===
    op.create_table(
        'stock_prices',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('stock_id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('time', sa.Date(), nullable=False),
        sa.Column('open', sa.Float(), nullable=False),
        sa.Column('high', sa.Float(), nullable=False),
        sa.Column('low', sa.Float(), nullable=False),
        sa.Column('close', sa.Float(), nullable=False),
        sa.Column('volume', sa.BigInteger(), nullable=False),
        sa.Column('value', sa.Float(), nullable=True),
        sa.Column('adj_close', sa.Float(), nullable=True),
        sa.Column('interval', sa.String(5), nullable=False, server_default='1D'),
        sa.Column('source', sa.String(20), nullable=False, server_default='vnstock'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['stock_id'], ['stocks.id'], name='fk_stock_prices_stock_id_stocks'),
        sa.PrimaryKeyConstraint('id', name='pk_stock_prices'),
        sa.UniqueConstraint('symbol', 'time', 'interval', name='uq_stock_price_symbol_time_interval'),
    )
    op.create_index('ix_stock_prices_stock_id', 'stock_prices', ['stock_id'])
    op.create_index('ix_stock_prices_symbol', 'stock_prices', ['symbol'])
    op.create_index('ix_stock_prices_time', 'stock_prices', ['time'])
    op.create_index('ix_stock_price_symbol_time', 'stock_prices', ['symbol', 'time'])

    # === STOCK INDICES ===
    op.create_table(
        'stock_indices',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('index_code', sa.String(20), nullable=False),
        sa.Column('time', sa.Date(), nullable=False),
        sa.Column('open', sa.Float(), nullable=False),
        sa.Column('high', sa.Float(), nullable=False),
        sa.Column('low', sa.Float(), nullable=False),
        sa.Column('close', sa.Float(), nullable=False),
        sa.Column('volume', sa.BigInteger(), nullable=False),
        sa.Column('value', sa.Float(), nullable=True),
        sa.Column('change', sa.Float(), nullable=True),
        sa.Column('change_pct', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_stock_indices'),
        sa.UniqueConstraint('index_code', 'time', name='uq_stock_index_code_time'),
    )
    op.create_index('ix_stock_indices_index_code', 'stock_indices', ['index_code'])
    op.create_index('ix_stock_index_code_time', 'stock_indices', ['index_code', 'time'])

    # === INCOME STATEMENTS ===
    op.create_table(
        'income_statements',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('period', sa.String(10), nullable=False),
        sa.Column('period_type', sa.String(10), nullable=False, server_default='year'),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_quarter', sa.Integer(), nullable=True),
        sa.Column('revenue', sa.Float(), nullable=True),
        sa.Column('cost_of_revenue', sa.Float(), nullable=True),
        sa.Column('gross_profit', sa.Float(), nullable=True),
        sa.Column('operating_expenses', sa.Float(), nullable=True),
        sa.Column('operating_income', sa.Float(), nullable=True),
        sa.Column('interest_expense', sa.Float(), nullable=True),
        sa.Column('other_income', sa.Float(), nullable=True),
        sa.Column('income_before_tax', sa.Float(), nullable=True),
        sa.Column('income_tax', sa.Float(), nullable=True),
        sa.Column('net_income', sa.Float(), nullable=True),
        sa.Column('eps', sa.Float(), nullable=True),
        sa.Column('eps_diluted', sa.Float(), nullable=True),
        sa.Column('ebitda', sa.Float(), nullable=True),
        sa.Column('raw_data', sa.JSON(), nullable=True),
        sa.Column('source', sa.String(20), nullable=False, server_default='vnstock'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_income_statements'),
        sa.UniqueConstraint('symbol', 'period', 'period_type', name='uq_income_stmt_symbol_period'),
    )
    op.create_index('ix_income_statements_symbol', 'income_statements', ['symbol'])
    op.create_index('ix_income_stmt_symbol_year', 'income_statements', ['symbol', 'fiscal_year'])

    # === BALANCE SHEETS ===
    op.create_table(
        'balance_sheets',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('period', sa.String(10), nullable=False),
        sa.Column('period_type', sa.String(10), nullable=False, server_default='year'),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_quarter', sa.Integer(), nullable=True),
        sa.Column('total_assets', sa.Float(), nullable=True),
        sa.Column('current_assets', sa.Float(), nullable=True),
        sa.Column('cash_and_equivalents', sa.Float(), nullable=True),
        sa.Column('short_term_investments', sa.Float(), nullable=True),
        sa.Column('accounts_receivable', sa.Float(), nullable=True),
        sa.Column('inventory', sa.Float(), nullable=True),
        sa.Column('non_current_assets', sa.Float(), nullable=True),
        sa.Column('fixed_assets', sa.Float(), nullable=True),
        sa.Column('total_liabilities', sa.Float(), nullable=True),
        sa.Column('current_liabilities', sa.Float(), nullable=True),
        sa.Column('accounts_payable', sa.Float(), nullable=True),
        sa.Column('short_term_debt', sa.Float(), nullable=True),
        sa.Column('non_current_liabilities', sa.Float(), nullable=True),
        sa.Column('long_term_debt', sa.Float(), nullable=True),
        sa.Column('total_equity', sa.Float(), nullable=True),
        sa.Column('retained_earnings', sa.Float(), nullable=True),
        sa.Column('book_value_per_share', sa.Float(), nullable=True),
        sa.Column('raw_data', sa.JSON(), nullable=True),
        sa.Column('source', sa.String(20), nullable=False, server_default='vnstock'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_balance_sheets'),
        sa.UniqueConstraint('symbol', 'period', 'period_type', name='uq_balance_sheet_symbol_period'),
    )
    op.create_index('ix_balance_sheets_symbol', 'balance_sheets', ['symbol'])
    op.create_index('ix_balance_sheet_symbol_year', 'balance_sheets', ['symbol', 'fiscal_year'])

    # === CASH FLOWS ===
    op.create_table(
        'cash_flows',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('period', sa.String(10), nullable=False),
        sa.Column('period_type', sa.String(10), nullable=False, server_default='year'),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_quarter', sa.Integer(), nullable=True),
        sa.Column('operating_cash_flow', sa.Float(), nullable=True),
        sa.Column('depreciation', sa.Float(), nullable=True),
        sa.Column('investing_cash_flow', sa.Float(), nullable=True),
        sa.Column('capital_expenditure', sa.Float(), nullable=True),
        sa.Column('financing_cash_flow', sa.Float(), nullable=True),
        sa.Column('dividends_paid', sa.Float(), nullable=True),
        sa.Column('debt_repayment', sa.Float(), nullable=True),
        sa.Column('net_change_in_cash', sa.Float(), nullable=True),
        sa.Column('free_cash_flow', sa.Float(), nullable=True),
        sa.Column('raw_data', sa.JSON(), nullable=True),
        sa.Column('source', sa.String(20), nullable=False, server_default='vnstock'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_cash_flows'),
        sa.UniqueConstraint('symbol', 'period', 'period_type', name='uq_cash_flow_symbol_period'),
    )
    op.create_index('ix_cash_flows_symbol', 'cash_flows', ['symbol'])
    op.create_index('ix_cash_flow_symbol_year', 'cash_flows', ['symbol', 'fiscal_year'])

    # === SCREENER SNAPSHOTS ===
    op.create_table(
        'screener_snapshots',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('company_name', sa.String(255), nullable=True),
        sa.Column('exchange', sa.String(10), nullable=True),
        sa.Column('industry', sa.String(100), nullable=True),
        sa.Column('price', sa.Float(), nullable=True),
        sa.Column('volume', sa.Float(), nullable=True),
        sa.Column('market_cap', sa.Float(), nullable=True),
        sa.Column('pe', sa.Float(), nullable=True),
        sa.Column('pb', sa.Float(), nullable=True),
        sa.Column('ps', sa.Float(), nullable=True),
        sa.Column('ev_ebitda', sa.Float(), nullable=True),
        sa.Column('roe', sa.Float(), nullable=True),
        sa.Column('roa', sa.Float(), nullable=True),
        sa.Column('roic', sa.Float(), nullable=True),
        sa.Column('gross_margin', sa.Float(), nullable=True),
        sa.Column('net_margin', sa.Float(), nullable=True),
        sa.Column('operating_margin', sa.Float(), nullable=True),
        sa.Column('revenue_growth', sa.Float(), nullable=True),
        sa.Column('earnings_growth', sa.Float(), nullable=True),
        sa.Column('dividend_yield', sa.Float(), nullable=True),
        sa.Column('debt_to_equity', sa.Float(), nullable=True),
        sa.Column('current_ratio', sa.Float(), nullable=True),
        sa.Column('quick_ratio', sa.Float(), nullable=True),
        sa.Column('eps', sa.Float(), nullable=True),
        sa.Column('bvps', sa.Float(), nullable=True),
        sa.Column('foreign_ownership', sa.Float(), nullable=True),
        sa.Column('rs_rating', sa.Float(), nullable=True),
        sa.Column('rs_rank', sa.Integer(), nullable=True),
        sa.Column('extended_metrics', sa.JSON(), nullable=True),
        sa.Column('source', sa.String(20), nullable=False, server_default='vnstock'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_screener_snapshots'),
        sa.UniqueConstraint('symbol', 'snapshot_date', name='uq_screener_snapshot_symbol_date'),
    )
    op.create_index('ix_screener_snapshots_symbol', 'screener_snapshots', ['symbol'])
    op.create_index('ix_screener_snapshots_snapshot_date', 'screener_snapshots', ['snapshot_date'])
    op.create_index('ix_screener_symbol_date', 'screener_snapshots', ['symbol', 'snapshot_date'])
    op.create_index('ix_screener_date_industry', 'screener_snapshots', ['snapshot_date', 'industry'])
    op.create_index('ix_screener_date_rs', 'screener_snapshots', ['snapshot_date', 'rs_rating'])

    # === COMPANIES ===
    op.create_table(
        'companies',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('company_name', sa.String(255), nullable=True),
        sa.Column('short_name', sa.String(100), nullable=True),
        sa.Column('english_name', sa.String(255), nullable=True),
        sa.Column('exchange', sa.String(10), nullable=True),
        sa.Column('industry', sa.String(100), nullable=True),
        sa.Column('sector', sa.String(100), nullable=True),
        sa.Column('subsector', sa.String(100), nullable=True),
        sa.Column('established_date', sa.Date(), nullable=True),
        sa.Column('listing_date', sa.Date(), nullable=True),
        sa.Column('outstanding_shares', sa.Float(), nullable=True),
        sa.Column('listed_shares', sa.Float(), nullable=True),
        sa.Column('website', sa.String(255), nullable=True),
        sa.Column('email', sa.String(100), nullable=True),
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('fax', sa.String(50), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('business_description', sa.Text(), nullable=True),
        sa.Column('raw_data', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_companies'),
        sa.UniqueConstraint('symbol', name='uq_companies_symbol'),
    )
    op.create_index('ix_companies_symbol', 'companies', ['symbol'])

    # === SHAREHOLDERS ===
    op.create_table(
        'shareholders',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('shareholder_type', sa.String(50), nullable=True),
        sa.Column('shares_held', sa.Float(), nullable=True),
        sa.Column('ownership_pct', sa.Float(), nullable=True),
        sa.Column('as_of_date', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name='fk_shareholders_company_id_companies'),
        sa.PrimaryKeyConstraint('id', name='pk_shareholders'),
    )
    op.create_index('ix_shareholders_company_id', 'shareholders', ['company_id'])
    op.create_index('ix_shareholders_symbol', 'shareholders', ['symbol'])
    op.create_index('ix_shareholder_symbol_type', 'shareholders', ['symbol', 'shareholder_type'])

    # === OFFICERS ===
    op.create_table(
        'officers',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('title', sa.String(100), nullable=True),
        sa.Column('position_type', sa.String(50), nullable=True),
        sa.Column('shares_held', sa.Float(), nullable=True),
        sa.Column('ownership_pct', sa.Float(), nullable=True),
        sa.Column('appointment_date', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name='fk_officers_company_id_companies'),
        sa.PrimaryKeyConstraint('id', name='pk_officers'),
    )
    op.create_index('ix_officers_company_id', 'officers', ['company_id'])
    op.create_index('ix_officers_symbol', 'officers', ['symbol'])
    op.create_index('ix_officer_symbol', 'officers', ['symbol'])

    # === USER DASHBOARDS ===
    op.create_table(
        'user_dashboards',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False, server_default='anonymous'),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('is_default', sa.Integer(), server_default='0'),
        sa.Column('layout_config', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_user_dashboards'),
    )
    op.create_index('ix_user_dashboards_user_id', 'user_dashboards', ['user_id'])
    op.create_index('ix_dashboard_user_default', 'user_dashboards', ['user_id', 'is_default'])

    # === DASHBOARD WIDGETS ===
    op.create_table(
        'dashboard_widgets',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('dashboard_id', sa.Integer(), nullable=False),
        sa.Column('widget_id', sa.String(50), nullable=False),
        sa.Column('widget_type', sa.String(50), nullable=False),
        sa.Column('layout', sa.JSON(), nullable=False),
        sa.Column('widget_config', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['dashboard_id'], ['user_dashboards.id'], name='fk_dashboard_widgets_dashboard_id_user_dashboards'),
        sa.PrimaryKeyConstraint('id', name='pk_dashboard_widgets'),
    )
    op.create_index('ix_dashboard_widgets_dashboard_id', 'dashboard_widgets', ['dashboard_id'])


def downgrade() -> None:
    # Drop tables in reverse order (respecting foreign keys)
    op.drop_table('dashboard_widgets')
    op.drop_table('user_dashboards')
    op.drop_table('officers')
    op.drop_table('shareholders')
    op.drop_table('companies')
    op.drop_table('screener_snapshots')
    op.drop_table('cash_flows')
    op.drop_table('balance_sheets')
    op.drop_table('income_statements')
    op.drop_table('stock_indices')
    op.drop_table('stock_prices')
    op.drop_table('stocks')
