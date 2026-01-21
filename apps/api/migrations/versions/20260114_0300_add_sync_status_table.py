"""Add sync_status table for tracking data sync operations

Revision ID: 20260114_0300_sync_status
Revises: a0fc7ce48b87
Create Date: 2026-01-14 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260114_0300_sync_status'
down_revision: Union[str, None] = 'a0fc7ce48b87'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create sync_status table."""
    op.create_table(
        'sync_status',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('sync_type', sa.String(length=50), nullable=False),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('success_count', sa.Integer(), nullable=False, default=0),
        sa.Column('error_count', sa.Integer(), nullable=False, default=0),
        sa.Column('status', sa.String(length=20), nullable=False, default='running'),
        sa.Column('errors', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('metadata', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_sync_status'))
    )
    
    # Create index on sync_type for filtering
    op.create_index(
        op.f('ix_sync_status_sync_type'),
        'sync_status',
        ['sync_type'],
        unique=False
    )
    
    # Create index on started_at for ordering
    op.create_index(
        op.f('ix_sync_status_started_at'),
        'sync_status',
        ['started_at'],
        unique=False
    )


def downgrade() -> None:
    """Drop sync_status table."""
    op.drop_index(op.f('ix_sync_status_started_at'), table_name='sync_status')
    op.drop_index(op.f('ix_sync_status_sync_type'), table_name='sync_status')
    op.drop_table('sync_status')
