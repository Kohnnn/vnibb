"""Index stale catalogue rows so retention can find debris without a full scan.

``prediction_markets`` accumulated ~14.7 M write-once Kalshi rows because the
ingest upserts on ``(source, source_id)`` and nothing removed delisted
contracts. The catalogue retention sweep selects on ``updated_at`` and
``is_synthetic``, which without a supporting index degrades to a sequential
scan of the whole table on every run.

The existing freshness index is ``(source, updated_at DESC, id)``, which cannot
serve a source-agnostic ``updated_at`` range. This adds the range index the
sweep needs. It is built concurrently so the first deploy does not hold a write
lock on the live catalogue.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7312f0c4e88"
down_revision: str | None = "a926b4d87501"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STALE_INDEX = "ix_prediction_markets_updated_at_id"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # CONCURRENTLY cannot run inside a transaction block.
        with op.get_context().autocommit_block():
            existing = bind.execute(sa.text("""
                SELECT i.indisvalid, i.indisunique, t.relname, am.amname,
                       array(SELECT pg_get_indexdef(c.oid, n, true) ||
                                    CASE WHEN (i.indoption[n-1] & 1) = 1 THEN ' DESC' ELSE '' END
                             FROM generate_series(1, i.indnkeyatts) AS n ORDER BY n) AS columns,
                       pg_get_expr(i.indpred, i.indrelid) AS predicate
                FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                JOIN pg_class t ON t.oid = i.indrelid
                JOIN pg_am am ON am.oid = c.relam
                WHERE c.oid = to_regclass(:name)
            """), {"name": STALE_INDEX}).first()
            if existing is not None:
                if existing.relname != "prediction_markets":
                    raise RuntimeError(f"Index {STALE_INDEX} belongs to an unexpected table")
                if existing.indisvalid:
                    if (existing.indisunique or existing.amname != "btree"
                            or tuple(existing.columns) != ("updated_at", "id")
                            or existing.predicate is not None):
                        raise RuntimeError(f"Index {STALE_INDEX} has unexpected definition")
                    return
                op.execute(f"DROP INDEX CONCURRENTLY {STALE_INDEX}")
            op.execute(
                f"CREATE INDEX CONCURRENTLY {STALE_INDEX} "
                "ON prediction_markets (updated_at, id)"
            )
    elif STALE_INDEX not in {index["name"] for index in sa.inspect(bind).get_indexes("prediction_markets")}:
        op.create_index(STALE_INDEX, "prediction_markets", ["updated_at", "id"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {STALE_INDEX}")
    else:
        op.drop_index(STALE_INDEX, table_name="prediction_markets")
