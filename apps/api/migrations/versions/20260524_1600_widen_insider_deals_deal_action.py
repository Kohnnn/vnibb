"""widen_insider_deals_deal_action_to_50

Revision ID: 7f3a8d1e6b22
Revises: 4e8b1c2a9f17
Create Date: 2026-05-24 16:00:00.000000

QA-v4 D.4: The InsiderDeal.deal_action column was previously String(10),
which would truncate Vietnamese phrases like "Đăng ký mua" (10 chars
including the trailing 'a' is the boundary; trailing space patterns
overflow). Bump to String(50) so VnstockInsiderDealsFetcher's normalized
output (BUY/SELL/UNKNOWN) and any localized provider strings can be
upserted without raising a DataError on commit.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "7f3a8d1e6b22"
down_revision: str | None = "4e8b1c2a9f17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE_NAME = "insider_deals"
COLUMN_NAME = "deal_action"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if TABLE_NAME not in inspector.get_table_names():
        return

    columns = {column["name"]: column for column in inspector.get_columns(TABLE_NAME)}
    if COLUMN_NAME not in columns:
        return

    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.alter_column(
            COLUMN_NAME,
            existing_type=sa.String(length=10),
            type_=sa.String(length=50),
            existing_nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if TABLE_NAME not in inspector.get_table_names():
        return

    columns = {column["name"]: column for column in inspector.get_columns(TABLE_NAME)}
    if COLUMN_NAME not in columns:
        return

    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.alter_column(
            COLUMN_NAME,
            existing_type=sa.String(length=50),
            type_=sa.String(length=10),
            existing_nullable=True,
        )
