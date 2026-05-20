"""add_stocks_empty_sync_count

Revision ID: 4e8b1c2a9f17
Revises: 2d7a4c9b8e31
Create Date: 2026-05-20 09:00:00.000000

Adds a `stocks.empty_sync_count` column used by the daily price sync to
auto-deactivate symbols whose vnstock provider repeatedly returns
"empty data". The column starts at 0 and increments on each empty
response; once it crosses a small threshold the sync flips
`stocks.is_active` to 0 so subsequent runs skip the symbol.

The original daily_trading reports ~700 errors per run on the live
deployment, almost entirely from delisted/inactive tickers. This
column is the bookkeeping needed to drain that backlog without manual
ticker-by-ticker maintenance.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "4e8b1c2a9f17"
down_revision: str | None = "2d7a4c9b8e31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE_NAME = "stocks"
COLUMN_NAME = "empty_sync_count"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if TABLE_NAME not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns(TABLE_NAME)}
    if COLUMN_NAME in column_names:
        return

    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                COLUMN_NAME,
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if TABLE_NAME not in inspector.get_table_names():
        return

    column_names = {column["name"] for column in inspector.get_columns(TABLE_NAME)}
    if COLUMN_NAME not in column_names:
        return

    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.drop_column(COLUMN_NAME)
