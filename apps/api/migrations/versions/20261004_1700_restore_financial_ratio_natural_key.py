"""Restore the financial-ratio natural-key constraint missing from production.

`FinancialRatio` declares
``UniqueConstraint("symbol", "period", "period_type", name="uq_financial_ratio_symbol_period")``,
and every writer calls
``get_upsert_stmt(FinancialRatio, ["symbol", "period", "period_type"], values)``,
which emits ``INSERT ... ON CONFLICT (symbol, period, period_type) DO UPDATE``.

A production constraint census on 2026-10-04 found only the primary-key index
for ``financial_ratios``; ``uq_financial_ratio_symbol_period`` was absent.
The initial migration, ``20260125_0842_1aaa2a1cf198_initial_schema.py``, already
declares this unique constraint. The census proves live-schema drift, but does
not establish when or why the constraint became absent.

Without it, natural-key upserts fail with ``InvalidColumnReferenceError: there
is no unique or exclusion constraint matching the ON CONFLICT specification``.
The durable ``financial_ratios_sync`` record instead reports a 5400s timeout;
no observed production log attributes that timeout to the missing constraint.

The migration is idempotent and lossless for a database already holding the
constraint. Where duplicates exist it keeps the newest row per key (highest
``id``) before adding the constraint, matching ``20260922_1530``. Production
measured zero duplicate keys across 17,400 rows, so no data is discarded there.
"""


from collections.abc import Sequence

from alembic import op

revision: str = "e5f1a7c9d2b4"
down_revision: str | None = "b7312f0c4e88"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "financial_ratios"
_CONSTRAINT = "uq_financial_ratio_symbol_period"
_COLUMNS = ("symbol", "period", "period_type")


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    conn = op.get_bind()

    # Scope the probe to the target relation so a same-named constraint in
    # another schema cannot mask this table's missing constraint.
    exists = conn.exec_driver_sql(
        "SELECT 1 FROM pg_constraint c "
        "WHERE c.conname = %s AND c.conrelid = to_regclass(%s)",
        (_CONSTRAINT, _TABLE),
    ).scalar()
    if exists:
        return

    # Both sides must be alias-qualified; an unqualified comparison resolves
    # every column to one alias, compares each row to itself, and the ALTER
    # then fails with "could not create unique index".
    left = ", ".join(f"a.{column}" for column in _COLUMNS)
    right = ", ".join(f"b.{column}" for column in _COLUMNS)
    conn.exec_driver_sql(
        f"DELETE FROM {_TABLE} a USING {_TABLE} b "
        f"WHERE a.id < b.id AND ({left}) = ({right})"
    )

    conn.exec_driver_sql(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_CONSTRAINT} "
        f"UNIQUE ({', '.join(_COLUMNS)})"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT}")
