"""Persist source coverage receipts without certifying historical flow rows."""

import sqlalchemy as sa
from alembic import op

revision = "f8c3a102d679"
down_revision = "e5f1a7c9d2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("order_flow_daily", sa.Column("coverage", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("order_flow_daily", "coverage")
