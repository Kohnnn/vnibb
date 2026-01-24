"""Enable RLS and policies

Revision ID: 20260124_enable_rls
Revises: 202c5b1127fc
Create Date: 2026-01-24 13:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260124_enable_rls'
down_revision: Union[str, None] = '202c5b1127fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enable RLS on all tables
    tables = [
        "stocks",
        "stock_prices",
        "stock_indices",
        "income_statements",
        "balance_sheets",
        "cash_flows",
        "screener_snapshots",
        "companies",
        "shareholders",
        "officers",
        "user_dashboards",
        "dashboard_widgets",
    ]
    
    for table in tables:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')

    # 2. Add Policies
    
    # Policy: Public Read Access (Select for anon/authenticated)
    # Applies to public data tables
    public_tables = [
        "stocks",
        "stock_prices",
        "stock_indices",
        "income_statements",
        "balance_sheets",
        "cash_flows",
        "screener_snapshots",
        "companies",
        "shareholders",
        "officers",
    ]
    
    for table in public_tables:
        # Create policy: "Public Read"
        # Allows SELECT for ALL roles (anon, authenticated, service_role)
        # Service role bypasses RLS anyway, but this explicitness helps.
        op.execute(f"""
            CREATE POLICY "Enable read access for all users" ON "{table}"
            FOR SELECT
            USING (true);
        """)

    # Policy: User Private Data
    # Applies to user_dashboards, dashboard_widgets
    # Only allow access if auth.uid() matches user_id column
    # NOTE: This assumes 'user_id' column exists and is a UUID matching auth.uid()
    # If the column uses string user IDs, caching might be tricky, but standard is auth.uid()
    
    # Check if we should add policies for dashboard tables or keep them API-only (service_role).
    # Since frontend might use them, we'll add 'authenticated' policy.
    
    op.execute("""
        CREATE POLICY "Users can only see their own dashboards" ON "user_dashboards"
        FOR SELECT
        TO authenticated
        USING (auth.uid()::text = user_id);
    """)
    
    op.execute("""
        CREATE POLICY "Users can insert their own dashboards" ON "user_dashboards"
        FOR INSERT
        TO authenticated
        WITH CHECK (auth.uid()::text = user_id);
    """)
    
    op.execute("""
        CREATE POLICY "Users can update their own dashboards" ON "user_dashboards"
        FOR UPDATE
        TO authenticated
        USING (auth.uid()::text = user_id);
    """)
    
    op.execute("""
        CREATE POLICY "Users can delete their own dashboards" ON "user_dashboards"
        FOR DELETE
        TO authenticated
        USING (auth.uid()::text = user_id);
    """)

    # Dashboard Widgets (linked via dashboard_id usually, but let's assume complex join or just protect via parent)
    # For simplicity, we might just enabling RLS without policy means NO access for anon/auth
    # which effectively keeps it "Service Role Only" for now unless we do joined checks.
    # Leaving dashboard_widgets strictly private (API only) for now is safer until we verify schema.


def downgrade() -> None:
    # Disable RLS
    tables = [
        "stocks",
        "stock_prices",
        "stock_indices",
        "income_statements",
        "balance_sheets",
        "cash_flows",
        "screener_snapshots",
        "companies",
        "shareholders",
        "officers",
        "user_dashboards",
        "dashboard_widgets",
    ]
    
    for table in tables:
        op.execute(f'DROP POLICY IF EXISTS "Enable read access for all users" ON "{table}"')
        op.execute(f'DROP POLICY IF EXISTS "Users can only see their own dashboards" ON "{table}"')
        op.execute(f'DROP POLICY IF EXISTS "Users can insert their own dashboards" ON "{table}"')
        op.execute(f'DROP POLICY IF EXISTS "Users can update their own dashboards" ON "{table}"')
        op.execute(f'DROP POLICY IF EXISTS "Users can delete their own dashboards" ON "{table}"')
        op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
