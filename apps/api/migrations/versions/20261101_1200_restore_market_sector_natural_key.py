"""Restore the market-sector natural key production never got.

`MarketSector` declares ``sector_code`` as ``unique=True, index=True`` and the
declared index name is ``ix_market_sectors_sector_code``. The initial schema
creates it, but the live production database holds only ``market_sectors_pkey``,
so ``get_upsert_stmt(MarketSector, ["sector_code"])`` emits ``ON CONFLICT
(sector_code)`` against no matching constraint.

Observed effect: ``sync_all_data`` fails every daily run with
``ProgrammingError: there is no unique or exclusion constraint matching the
ON CONFLICT specification`` for ``market_sectors`` (2026-10-30 and 2026-10-31
in the scheduler log).

Idempotent and lossless. Production measured zero duplicate and zero null
codes across 24 rows on 2026-11-01, so no data is discarded there.
"""

import sqlalchemy as sa
from alembic import op

revision = "b8f2c5d91e40"
down_revision = "d47b2a61f903"
branch_labels = None
depends_on = None

_TABLE = "market_sectors"
_INDEX = "ix_market_sectors_sector_code"


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return

    with op.get_context().autocommit_block():
        existing = conn.exec_driver_sql(
            "SELECT i.indrelid = 'market_sectors'::regclass AS expected_table, "
            "       am.amname, i.indisunique, i.indisvalid, i.indisready, "
            "       i.indimmediate, i.indnkeyatts, i.indnatts, a.attname, "
            "       i.indpred IS NULL AS unfiltered, i.indexprs IS NULL AS plain "
            "FROM pg_class c "
            "LEFT JOIN pg_index i ON i.indexrelid = c.oid "
            "LEFT JOIN pg_am am ON am.oid = c.relam "
            "LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0] "
            "WHERE c.oid = to_regclass(%s)",
            (_INDEX,),
        ).first()
        if existing is not None:
            if (not existing.expected_table or existing.amname != "btree"
                    or not existing.indisunique or not existing.indisvalid
                    or not existing.indisready or not existing.indimmediate
                    or existing.indnkeyatts != 1 or existing.indnatts != 1
                    or existing.attname != "sector_code" or not existing.unfiltered
                    or not existing.plain):
                raise RuntimeError(
                    f"Index {_INDEX} has unexpected ownership or definition; "
                    "explicit schema review required"
                )
            return

        # A unique index is only as good as the rows it admits; refuse to build
        # it over codes the sync would then fail to distinguish.
        invalid = conn.exec_driver_sql(
            f"SELECT EXISTS (SELECT 1 FROM {_TABLE} "
            f"WHERE sector_code IS NULL OR btrim(sector_code) = '') "
            f"OR EXISTS (SELECT 1 FROM {_TABLE} GROUP BY sector_code HAVING count(*) > 1)"
        ).scalar_one()
        if invalid:
            raise RuntimeError(
                "market_sectors codes are null or duplicated; explicit reconciliation required"
            )

        conn.exec_driver_sql(
            f"CREATE UNIQUE INDEX CONCURRENTLY {_INDEX} ON {_TABLE} (sector_code)"
        )


def downgrade() -> None:
    raise RuntimeError(
        "Retain the restored market-sector natural key during application rollback; "
        "removal requires an explicit, provenance-checked schema review"
    )
