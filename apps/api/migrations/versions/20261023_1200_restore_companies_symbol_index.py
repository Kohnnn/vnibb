"""Restore the company symbol index without changing rows or ID generation."""

from alembic import op

revision = "a6d4c91e8b20"
down_revision = "f8c3a102d679"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    conn.exec_driver_sql("SET LOCAL lock_timeout = '5s'")
    conn.exec_driver_sql("SET LOCAL statement_timeout = '25s'")
    conn.exec_driver_sql("LOCK TABLE companies IN SHARE MODE")
    symbol_not_null = conn.exec_driver_sql(
        "SELECT attnotnull FROM pg_attribute "
        "WHERE attrelid='companies'::regclass AND attname='symbol' AND NOT attisdropped"
    ).scalar_one()
    if not symbol_not_null:
        raise RuntimeError("Company symbol must be NOT NULL; explicit schema review required")

    invalid_symbols = conn.exec_driver_sql(
        "SELECT EXISTS (SELECT 1 FROM companies WHERE symbol IS NULL OR btrim(symbol)='' "
        "OR symbol<>upper(btrim(symbol))) OR EXISTS (SELECT 1 FROM companies "
        "GROUP BY upper(btrim(symbol)) HAVING count(*) > 1)"
    ).scalar_one()
    if invalid_symbols:
        raise RuntimeError(
            "Company symbols are null, noncanonical or duplicated; explicit reconciliation required"
        )

    deferrable_symbol_key = conn.exec_driver_sql(
        "SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a "
        "ON a.attrelid=c.conrelid AND a.attname='symbol' "
        "WHERE c.conrelid='companies'::regclass AND c.contype='u' AND c.condeferrable "
        "AND c.conkey=ARRAY[a.attnum])"
    ).scalar_one()
    if deferrable_symbol_key:
        raise RuntimeError("Deferrable company symbol uniqueness requires explicit schema review")

    usable_index = conn.exec_driver_sql(
        "SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a "
        "ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0] "
        "WHERE i.indrelid='companies'::regclass AND a.attname='symbol' "
        "AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate "
        "AND i.indnkeyatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL)"
    ).scalar_one()
    if usable_index:
        return

    conn.exec_driver_sql("CREATE UNIQUE INDEX ix_companies_symbol ON companies (symbol)")


def downgrade() -> None:
    raise RuntimeError(
        "Retain the restored companies symbol index during application rollback; "
        "removal requires an explicit, provenance-checked schema decision"
    )
