"""Restore unique constraints that the models declare but prod never got.

Twelve of the seventeen `UniqueConstraint`s declared in `vnibb.models` do not
exist in the production database. This is model/migration drift, not a missing
migration: e.g. `5b2c7d8f3a10` (20260128_1200_add_order_flow_and_derivatives)
declares `uq_order_flow_symbol_date` and IS an ancestor of the applied head, yet
`SELECT count(*) FROM pg_constraint WHERE conname='uq_order_flow_symbol_date'`
returns 0. The revision was stamped; the DDL never landed.

The impact is not cosmetic. Every writer that uses
`get_upsert_stmt(model, [...], values)` emits
`INSERT ... ON CONFLICT (cols) DO UPDATE`, which Postgres rejects with
`InvalidColumnReferenceError: there is no unique or exclusion constraint
matching the ON CONFLICT specification` when the constraint is absent. That is
exactly why `daily_trading_sync` has failed 7 days running with
`intraday_trades` at 0 success / 60 errors, and it silently caps several other
feeds at their last successful load (2026-05-20 / 2026-06-16).

Because the constraints are missing, those tables have also been allowed to
accumulate duplicate rows. Creating a unique constraint fails if duplicates
exist, so this migration deletes duplicates first, keeping the newest row per
key (highest `id`, falling back to `ctid`) before adding each constraint. Only
`dividends` (178 duplicate keys) and `company_events` (14) actually have any;
the rest measured zero and are unaffected by the delete.

Data loss note: the dedupe discards the older duplicate rows for those two
tables only. Those rows are re-derivable from the provider on the next sync.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "b7e1c4a90f21"
down_revision: Union[str, None] = "0123456789ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, constraint name, columns)
CONSTRAINTS = [
    ("stock_indices", "uq_stock_index_code_time", "index_code, time"),
    ("sector_performance", "uq_sector_perf_code_date", "sector_code, trade_date"),
    (
        "technical_indicators",
        "uq_technical_indicator_symbol_date",
        "symbol, calc_date",
    ),
    ("company_events", "uq_event_symbol_type_date", "symbol, event_type, event_date"),
    (
        "dividends",
        "uq_dividend_symbol_date_year",
        "symbol, exercise_date, cash_year",
    ),
    (
        "balance_sheets",
        "uq_balance_sheet_symbol_period",
        "symbol, period, period_type",
    ),
    ("cash_flows", "uq_cash_flow_symbol_period", "symbol, period, period_type"),
    (
        "income_statements",
        "uq_income_stmt_symbol_period",
        "symbol, period, period_type",
    ),
    (
        "screener_snapshots",
        "uq_screener_snapshot_symbol_date",
        "symbol, snapshot_date",
    ),
    ("company_news", "uq_news_symbol_title_date", "symbol, title, published_date"),
    (
        "derivative_prices",
        "uq_derivative_symbol_date_interval",
        "symbol, trade_date, interval",
    ),
    ("order_flow_daily", "uq_order_flow_symbol_date", "symbol, trade_date"),
]


def upgrade() -> None:
    conn = op.get_bind()

    for table, name, columns in CONSTRAINTS:
        # Idempotent: a database that already has the constraint is left alone.
        exists = conn.exec_driver_sql(
            "SELECT 1 FROM pg_constraint WHERE conname = %s", (name,)
        ).scalar()
        if exists:
            continue

        # Keep the newest row per key so the constraint can be created.
        # Both sides must be alias-qualified: an unqualified
        # `(cols) IS NOT DISTINCT FROM (cols)` resolves every column to the
        # same alias, so it compares a row to itself, deletes nothing, and the
        # ALTER TABLE then fails with "could not create unique index".
        key_cols = [c.strip() for c in columns.split(",")]
        left = ", ".join(f"a.{c}" for c in key_cols)
        right = ", ".join(f"b.{c}" for c in key_cols)
        conn.exec_driver_sql(
            f"DELETE FROM {table} a USING {table} b "
            f"WHERE a.id < b.id AND ({left}) = ({right})"
        )

        conn.exec_driver_sql(
            f"ALTER TABLE {table} ADD CONSTRAINT {name} UNIQUE ({columns})"
        )


def downgrade() -> None:
    for table, name, _columns in CONSTRAINTS:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")
