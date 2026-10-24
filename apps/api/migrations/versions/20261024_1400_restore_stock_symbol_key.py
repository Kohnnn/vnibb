"""Restore the declared stock symbol natural key without changing stock rows."""

import sqlalchemy as sa
from alembic import op

revision = "d47b2a61f903"
down_revision = "c51e7d82b4f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    with op.get_context().autocommit_block():
        existing = conn.exec_driver_sql("""
            SELECT i.indrelid = 'stocks'::regclass AS expected_table,
                   am.amname, i.indisunique, i.indisvalid, i.indisready,
                   i.indimmediate, i.indnkeyatts, i.indnatts, a.attname,
                   i.indpred IS NULL AS unfiltered, i.indexprs IS NULL AS plain
            FROM pg_class c
            LEFT JOIN pg_index i ON i.indexrelid = c.oid
            LEFT JOIN pg_am am ON am.oid = c.relam
            LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
            WHERE c.oid = to_regclass('ix_stocks_symbol')
        """).first()
        if existing is not None:
            if (not existing.expected_table or existing.amname != "btree"
                    or not existing.indisunique or not existing.indisvalid
                    or not existing.indisready or not existing.indimmediate
                    or existing.indnkeyatts != 1 or existing.indnatts != 1
                    or existing.attname != "symbol" or not existing.unfiltered
                    or not existing.plain):
                raise RuntimeError(
                    "Index ix_stocks_symbol has unexpected ownership or definition; "
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
                "CREATE UNIQUE INDEX CONCURRENTLY ix_stocks_symbol ON stocks (symbol)"
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
        "Retain the restored stock symbol natural key during application rollback; "
        "removal requires an explicit, provenance-checked schema review"
    )
