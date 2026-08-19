"""Widen prediction-market snapshot text fields.

Revision ID: e9f012345678
Revises: d8e9f0123456
Create Date: 2026-08-19 08:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e9f012345678"
down_revision: str | None = "d8e9f0123456"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE_NAME = "prediction_market_snapshots"
COLUMNS = ("question", "url")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in inspector.get_table_names():
        return
    columns = {column["name"]: column for column in inspector.get_columns(TABLE_NAME)}
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        for column_name in COLUMNS:
            if column_name in columns and not isinstance(columns[column_name]["type"], sa.Text):
                batch_op.alter_column(
                    column_name,
                    existing_type=columns[column_name]["type"],
                    type_=sa.Text(),
                    existing_nullable=columns[column_name]["nullable"],
                )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in inspector.get_table_names():
        return
    for column_name in COLUMNS:
        overflow = bind.execute(
            sa.text(
                f"SELECT EXISTS (SELECT 1 FROM {TABLE_NAME} "
                f"WHERE char_length({column_name}) > 512)"
            )
        ).scalar()
        if overflow:
            raise RuntimeError(f"Cannot narrow {TABLE_NAME}.{column_name}: values exceed 512 characters")
    columns = {column["name"]: column for column in inspector.get_columns(TABLE_NAME)}
    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        for column_name in COLUMNS:
            if column_name in columns:
                batch_op.alter_column(
                    column_name,
                    existing_type=columns[column_name]["type"],
                    type_=sa.String(length=512),
                    existing_nullable=columns[column_name]["nullable"],
                )
