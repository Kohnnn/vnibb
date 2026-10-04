"""Restore the financial-ratio natural-key constraint that prod never got.

`FinancialRatio` declares
``UniqueConstraint("symbol", "period", "period_type", name="uq_financial_ratio_symbol_period")``,
and every writer calls
``get_upsert_stmt(FinancialRatio, ["symbol", "period", "period_type"], values)``,
which emits ``INSERT ... ON CONFLICT (symbol, period, period_type) DO UPDATE``.

The production database only ever received the primary-key index for
`financial_ratios`; a constraint census on 2026-10-04 found
``uq_financial_ratio_symbol_period`` absent (alongside two snapshot bucket
uniques that *do* exist as concurrent indexes, so ``ON CONFLICT`` accepts them).
The missing constraint makes every financial-ratio upsert fail with
``InvalidColumnReferenceError: there is no unique or exclusion constraint
matching the ON CONFLICT specification`` — the durable ``financial_ratios_sync``
job has been failing for that reason.

This is stamped-revision drift, not a lost migration: no migration ever declared
`uq_financial_ratio_symbol_period` for the table, and the model's declared
constraints are not automatically applied to an already-created table.

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
