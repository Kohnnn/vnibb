"""Index fresh market selection and enforce one snapshot per market/bucket."""

from __future__ import annotations

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a926b4d87501"
down_revision: str | None = "d4c39e8a7b12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MARKET_FRESH_INDEX = "ix_prediction_markets_source_updated_at_id"
MARKET_ADMISSION_INDEX = "ix_prediction_markets_noncombo_source_id"
DAILY_UNIQUE = "uq_prediction_market_snapshot_bucket"
INTRADAY_UNIQUE = "uq_prediction_market_intraday_bucket"
DAILY_BUCKET_INDEX = "ix_prediction_market_snapshots_bucket_at"
INTRADAY_BUCKET_INDEX = "ix_prediction_market_intraday_snapshots_bucket_at"

_BUCKET_TABLES = (
    ("prediction_market_snapshots", DAILY_UNIQUE, "day"),
    ("prediction_market_intraday_snapshots", INTRADAY_UNIQUE, "15 minutes"),
)


def _add_snapshot_buckets() -> None:
    bind = op.get_bind()
    postgres = bind.dialect.name == "postgresql"
    for table, _, cadence in _BUCKET_TABLES:
        if "bucket_at" not in {column["name"] for column in sa.inspect(bind).get_columns(table)}:
            op.add_column(table, sa.Column("bucket_at", sa.DateTime(timezone=True), nullable=True))
        if postgres:
            expression = (
                "date_trunc('day', captured_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'"
                if cadence == "day" else
                "to_timestamp(floor(extract(epoch from captured_at) / 900) * 900)"
            )
        else:
            expression = (
                "strftime('%Y-%m-%d 00:00:00.000000', captured_at)" if cadence == "day"
                else "strftime('%Y-%m-%d %H:', captured_at) || "
                     "printf('%02d:00.000000', (cast(strftime('%M', captured_at) as integer) / 15) * 15)"
            )
        op.execute(f"UPDATE {table} SET bucket_at = {expression} WHERE bucket_at IS NULL")
        invalid = bind.execute(sa.text(f"""
            SELECT 1 FROM {table} GROUP BY source, source_id, bucket_at
            HAVING bucket_at IS NULL OR count(*) > 1 LIMIT 1
        """)).first()
        if invalid:
            raise RuntimeError(f"Existing {table} has invalid/duplicate snapshot buckets")
        if postgres:
            op.alter_column(table, "bucket_at", nullable=False)
        else:
            with op.batch_alter_table(table) as batch:
                batch.alter_column("bucket_at", existing_type=sa.DateTime(timezone=True), nullable=False)


def _create_postgres_index(name: str, ddl: str, table: str, columns: tuple[str, ...], *, unique: bool = False) -> None:
    existing = op.get_bind().execute(sa.text("""
        SELECT i.indisvalid, i.indisunique, t.relname,
               array(SELECT pg_get_indexdef(c.oid, n, true) ||
                            CASE WHEN (i.indoption[n-1] & 1) = 1 THEN ' DESC' ELSE '' END
                     FROM generate_series(1, i.indnkeyatts) AS n ORDER BY n) AS columns,
               pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE c.oid = to_regclass(:name)
    """), {"name": name}).first()
    if existing is not None:
        if existing.relname != table:
            raise RuntimeError(f"Index {name} belongs to an unexpected table")
        if existing.indisvalid:
            if existing.indisunique != unique or tuple(existing.columns) != columns:
                raise RuntimeError(f"Index {name} has unexpected columns or uniqueness")
            is_catalogue_index = name in (MARKET_FRESH_INDEX, MARKET_ADMISSION_INDEX)
            if is_catalogue_index:
                if existing.predicate is None or re.sub(
                    r"[\s()]|::text", "", existing.predicate
                ) != "source<>'kalshi'ORsource_id!~~'KXMV%'":
                    raise RuntimeError(f"Index {name} has unexpected predicate")
            elif existing.predicate is not None:
                raise RuntimeError(f"Index {name} has unexpected predicate")
            return
        op.execute(f"DROP INDEX CONCURRENTLY {name}")
    op.execute(ddl)


def upgrade() -> None:
    _add_snapshot_buckets()
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            _create_postgres_index(MARKET_FRESH_INDEX,
                "CREATE INDEX CONCURRENTLY ix_prediction_markets_source_updated_at_id "
                "ON prediction_markets (source, updated_at DESC, id) "
                "WHERE source <> 'kalshi' OR source_id NOT LIKE 'KXMV%'", "prediction_markets", ("source", "updated_at DESC", "id"))
            _create_postgres_index(MARKET_ADMISSION_INDEX,
                "CREATE INDEX CONCURRENTLY ix_prediction_markets_noncombo_source_id "
                "ON prediction_markets (source, id) "
                "WHERE source <> 'kalshi' OR source_id NOT LIKE 'KXMV%'", "prediction_markets", ("source", "id"))
            _create_postgres_index(DAILY_UNIQUE,
                "CREATE UNIQUE INDEX CONCURRENTLY uq_prediction_market_snapshot_bucket "
                "ON prediction_market_snapshots (source, source_id, bucket_at)",
                "prediction_market_snapshots", ("source", "source_id", "bucket_at"), unique=True)
            _create_postgres_index(INTRADAY_UNIQUE,
                "CREATE UNIQUE INDEX CONCURRENTLY uq_prediction_market_intraday_bucket "
                "ON prediction_market_intraday_snapshots (source, source_id, bucket_at)",
                "prediction_market_intraday_snapshots", ("source", "source_id", "bucket_at"), unique=True)
            _create_postgres_index(DAILY_BUCKET_INDEX,
                "CREATE INDEX CONCURRENTLY ix_prediction_market_snapshots_bucket_at "
                "ON prediction_market_snapshots (bucket_at)",
                "prediction_market_snapshots", ("bucket_at",))
            _create_postgres_index(INTRADAY_BUCKET_INDEX,
                "CREATE INDEX CONCURRENTLY ix_prediction_market_intraday_snapshots_bucket_at "
                "ON prediction_market_intraday_snapshots (bucket_at)",
                "prediction_market_intraday_snapshots", ("bucket_at",))
    else:
        condition = sa.text("source <> 'kalshi' OR source_id NOT LIKE 'KXMV%'")
        op.create_index(MARKET_FRESH_INDEX, "prediction_markets", ["source", sa.text("updated_at DESC"), "id"], sqlite_where=condition)
        op.create_index(MARKET_ADMISSION_INDEX, "prediction_markets", ["source", "id"], sqlite_where=condition)
        op.create_index(DAILY_UNIQUE, "prediction_market_snapshots", ["source", "source_id", "bucket_at"], unique=True)
        op.create_index(INTRADAY_UNIQUE, "prediction_market_intraday_snapshots", ["source", "source_id", "bucket_at"], unique=True)
        op.create_index(DAILY_BUCKET_INDEX, "prediction_market_snapshots", ["bucket_at"])
        op.create_index(INTRADAY_BUCKET_INDEX, "prediction_market_intraday_snapshots", ["bucket_at"])

def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for name in (INTRADAY_BUCKET_INDEX, DAILY_BUCKET_INDEX):
                op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            for name in (INTRADAY_UNIQUE, DAILY_UNIQUE, MARKET_ADMISSION_INDEX, MARKET_FRESH_INDEX):
                op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
    else:
        op.drop_index(INTRADAY_BUCKET_INDEX, "prediction_market_intraday_snapshots")
        op.drop_index(DAILY_BUCKET_INDEX, "prediction_market_snapshots")
        op.drop_index(INTRADAY_UNIQUE, "prediction_market_intraday_snapshots")
        op.drop_index(DAILY_UNIQUE, "prediction_market_snapshots")
        op.drop_index(MARKET_ADMISSION_INDEX, "prediction_markets")
        op.drop_index(MARKET_FRESH_INDEX, "prediction_markets")
    for table, _, _ in _BUCKET_TABLES:
        op.drop_column(table, "bucket_at")
