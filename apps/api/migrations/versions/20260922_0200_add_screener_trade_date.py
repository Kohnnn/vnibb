"""Add row-level market trade date to screener snapshots.

Revision ID: 0123456789ab
Revises: f0123456789a
Create Date: 2026-09-22 02:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0123456789ab"
down_revision: str | None = "f0123456789a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE_NAME = "screener_snapshots"
COLUMN_NAME = "trade_date"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if TABLE_NAME not in inspector.get_table_names():
        return False
    return any(column["name"] == COLUMN_NAME for column in inspector.get_columns(TABLE_NAME))


def upgrade() -> None:
    if _has_column():
        return
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.add_column(sa.Column(COLUMN_NAME, sa.Date(), nullable=True))


def downgrade() -> None:
    if not _has_column():
        return
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.drop_column(COLUMN_NAME)
