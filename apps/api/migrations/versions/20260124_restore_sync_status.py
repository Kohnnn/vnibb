"""Restore sync_status table

Revision ID: 20260124_restore_sync_status
Revises: 20260124_enable_rls
Create Date: 2026-01-24 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260124_restore_sync_status'
down_revision: Union[str, None] = '20260124_enable_rls'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL to create table IF NOT EXISTS to be safe
    op.execute("""
        CREATE TABLE IF NOT EXISTS sync_status (
            id SERIAL NOT NULL, 
            sync_type VARCHAR(50) NOT NULL, 
            started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
            completed_at TIMESTAMP WITHOUT TIME ZONE, 
            success_count INTEGER DEFAULT 0 NOT NULL, 
            error_count INTEGER DEFAULT 0 NOT NULL, 
            status VARCHAR(20) DEFAULT 'running' NOT NULL, 
            errors TEXT, 
            metadata TEXT, 
            CONSTRAINT pk_sync_status PRIMARY KEY (id)
        )
    """)
    
    # Indexes (IF NOT EXISTS is tricky for indexes in standard SQL, usually need DO block or ignore error)
    # Postgres 9.5+ supports IF NOT EXISTS for indexes
    op.execute('CREATE INDEX IF NOT EXISTS ix_sync_status_started_at ON sync_status (started_at)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_sync_status_sync_type ON sync_status (sync_type)')
    
    # Apply RLS to this new table immediately as well
    op.execute('ALTER TABLE sync_status ENABLE ROW LEVEL SECURITY')
    
    # Policies for sync_status (likely public read not needed, but safe to allow service role)
    # Maybe allow authenticated admins to read sync status?
    # For now, stick to Service Role (API) only to be safe.


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS sync_status')
