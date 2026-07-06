"""add_prediction_markets_extra_column

Revision ID: c7d8e9f01234
Revises: b6c7d8e9f012
Create Date: 2026-07-05 21:00:00.000000

Phase 9/10: source-agnostic ingest normalizers persist provider metadata
(``raw_category``, ``canonical_topics``) under ``prediction_markets.extra``.
The topic selector on ``GET /prediction-markets`` filters on
``extra.canonical_topics`` and the ElectionOddsWidget reads it, so the
column must exist on every deployed database.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c7d8e9f01234"
down_revision: str | None = "b6c7d8e9f012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE_NAME = "prediction_markets"
COLUMN_NAME = "extra"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns(TABLE_NAME)}
    if COLUMN_NAME in columns:
        return
    op.add_column(
        TABLE_NAME,
        sa.Column(COLUMN_NAME, sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE_NAME not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns(TABLE_NAME)}
    if COLUMN_NAME not in columns:
        return
    op.drop_column(TABLE_NAME, COLUMN_NAME)
