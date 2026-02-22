"""add_ev_sales_to_financial_ratios

Revision ID: d2f6e4b1c9a8
Revises: 8b7f0c1e9d12
Create Date: 2026-02-22 13:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2f6e4b1c9a8"
down_revision: Union[str, None] = "8b7f0c1e9d12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if _has_column("financial_ratios", "ev_sales"):
        return

    with op.batch_alter_table("financial_ratios", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ev_sales", sa.Float(), nullable=True))


def downgrade() -> None:
    if not _has_column("financial_ratios", "ev_sales"):
        return

    with op.batch_alter_table("financial_ratios", schema=None) as batch_op:
        batch_op.drop_column("ev_sales")
