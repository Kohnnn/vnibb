"""Restore the declared stock price date index without changing price rows."""

import sqlalchemy as sa
from alembic import op

revision = "c51e7d82b4f0"
down_revision = "a6d4c91e8b20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    with op.get_context().autocommit_block():
        existing = conn.exec_driver_sql("""
            SELECT i.indrelid = 'stock_prices'::regclass AS expected_table,
                   am.amname, i.indisunique, i.indisvalid, i.indisready,
                   i.indnkeyatts, i.indnatts, a.attname,
                   i.indpred IS NULL AS unfiltered, i.indexprs IS NULL AS plain
            FROM pg_class c
            LEFT JOIN pg_index i ON i.indexrelid = c.oid
            LEFT JOIN pg_am am ON am.oid = c.relam
            LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
            WHERE c.oid = to_regclass('ix_stock_price_date_only')
        """).first()
        if existing is not None:
            if not existing.expected_table:
                raise RuntimeError(
                    "Index ix_stock_price_date_only belongs to an unexpected table; "
                    "explicit schema review required"
                )
            if not existing.indisvalid or not existing.indisready:
                raise RuntimeError(
                    "Index ix_stock_price_date_only is invalid or not ready; "
                    "explicit schema review required"
                )
            if (existing.amname != "btree" or existing.indisunique
                    or existing.indnkeyatts != 1 or existing.indnatts != 1
                    or existing.attname != "time" or not existing.unfiltered
                    or not existing.plain):
                raise RuntimeError(
                    "Index ix_stock_price_date_only has unexpected definition; "
                    "explicit schema review required"
                )
            return

        previous = conn.exec_driver_sql(
            "SELECT current_setting('lock_timeout') AS lock_timeout, "
            "current_setting('statement_timeout') AS statement_timeout"
        ).one()
        try:
            conn.exec_driver_sql("SET lock_timeout = '5s'")
            conn.exec_driver_sql("SET statement_timeout = '120s'")
            conn.exec_driver_sql(
                "CREATE INDEX CONCURRENTLY ix_stock_price_date_only ON stock_prices (time)"
            )
        finally:
            conn.execute(
                sa.text(
                    "SELECT set_config('lock_timeout', :lock_timeout, false), "
                    "set_config('statement_timeout', :statement_timeout, false)"
                ),
                {
                    "lock_timeout": previous.lock_timeout,
                    "statement_timeout": previous.statement_timeout,
                },
            )


def downgrade() -> None:
    raise RuntimeError(
        "Retain the restored stock price date index during application rollback; "
        "removal requires an explicit, provenance-checked schema review"
    )
