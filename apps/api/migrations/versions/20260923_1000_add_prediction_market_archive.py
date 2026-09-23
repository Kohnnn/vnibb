"""Archive terminal prediction markets without changing the live corpus."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4c39e8a7b12"
down_revision: str | None = "f6a9c2d41b83"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "prediction_market_archive",
        sa.Column("market_id", sa.Integer(), primary_key=True),
        sa.Column("batch_id", sa.String(36), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=False),
        sa.Column("backup_sha256", sa.String(64), nullable=False),
    )
    op.create_index(
        "ix_prediction_market_archive_batch_id", "prediction_market_archive", ["batch_id"]
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE INDEX ix_prediction_market_archive_end_date ON prediction_market_archive ((payload->>'end_date'), market_id)")
        op.execute("CREATE INDEX ix_prediction_market_archive_source ON prediction_market_archive ((payload->>'source'))")

def downgrade() -> None:
    bind = op.get_bind()
    remaining = bind.execute(sa.text("SELECT 1 FROM prediction_market_archive LIMIT 1")).first()
    if remaining:
        raise RuntimeError("Restore archived markets before dropping prediction_market_archive")
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX ix_prediction_market_archive_source")
        op.execute("DROP INDEX ix_prediction_market_archive_end_date")
    op.drop_index("ix_prediction_market_archive_batch_id", table_name="prediction_market_archive")
    op.drop_table("prediction_market_archive")
