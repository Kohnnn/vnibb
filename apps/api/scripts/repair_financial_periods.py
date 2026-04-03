"""Safe financial period repair helper.

This script intentionally applies only low-risk fixes that can be derived from
the current source rows without guessing missing fiscal periods.
"""

import argparse
import asyncio
import json
from dataclasses import dataclass

from sqlalchemy import text

from vnibb.core.database import async_session_maker


@dataclass(frozen=True)
class SqlFix:
    name: str
    sql: str


SAFE_FIXES: tuple[SqlFix, ...] = (
    SqlFix(
        name="income_yearlike_quarter_to_year",
        sql="""
        UPDATE income_statements
        SET period_type = 'year', fiscal_quarter = NULL
        WHERE id IN (
            SELECT q.id
            FROM income_statements q
            WHERE lower(coalesce(q.period_type, '')) = 'quarter'
              AND q.fiscal_quarter IS NULL
              AND q.period ~ '^20\\d{2}$'
              AND q.fiscal_year = CAST(q.period AS integer)
              AND NOT EXISTS (
                SELECT 1 FROM income_statements y
                WHERE y.symbol = q.symbol
                  AND y.period = q.period
                  AND lower(coalesce(y.period_type, '')) = 'year'
              )
        )
        """,
    ),
    SqlFix(
        name="balance_yearlike_quarter_to_year",
        sql="""
        UPDATE balance_sheets
        SET period_type = 'year', fiscal_quarter = NULL
        WHERE id IN (
            SELECT q.id
            FROM balance_sheets q
            WHERE lower(coalesce(q.period_type, '')) = 'quarter'
              AND q.fiscal_quarter IS NULL
              AND q.period ~ '^20\\d{2}$'
              AND q.fiscal_year = CAST(q.period AS integer)
              AND NOT EXISTS (
                SELECT 1 FROM balance_sheets y
                WHERE y.symbol = q.symbol
                  AND y.period = q.period
                  AND lower(coalesce(y.period_type, '')) = 'year'
              )
        )
        """,
    ),
    SqlFix(
        name="cash_yearlike_quarter_to_year",
        sql="""
        UPDATE cash_flows
        SET period_type = 'year', fiscal_quarter = NULL
        WHERE id IN (
            SELECT q.id
            FROM cash_flows q
            WHERE lower(coalesce(q.period_type, '')) = 'quarter'
              AND q.fiscal_quarter IS NULL
              AND q.period ~ '^20\\d{2}$'
              AND q.fiscal_year = CAST(q.period AS integer)
              AND NOT EXISTS (
                SELECT 1 FROM cash_flows y
                WHERE y.symbol = q.symbol
                  AND y.period = q.period
                  AND lower(coalesce(y.period_type, '')) = 'year'
              )
        )
        """,
    ),
    SqlFix(
        name="ratios_normalize_quarter_period_format",
        sql="""
        UPDATE financial_ratios
        SET period = regexp_replace(period, '^(20\\d{2})-Q([1-4])$', 'Q\\2-\\1')
        WHERE period ~ '^20\\d{2}-Q[1-4]$'
        """,
    ),
)


REPORT_SQL = {
    "income_yearlike_quarter": """
        SELECT count(*) AS count
        FROM income_statements
        WHERE lower(coalesce(period_type, '')) = 'quarter'
          AND fiscal_quarter IS NULL
          AND period ~ '^20\\d{2}$'
          AND fiscal_year = CAST(period AS integer)
    """,
    "balance_yearlike_quarter": """
        SELECT count(*) AS count
        FROM balance_sheets
        WHERE lower(coalesce(period_type, '')) = 'quarter'
          AND fiscal_quarter IS NULL
          AND period ~ '^20\\d{2}$'
          AND fiscal_year = CAST(period AS integer)
    """,
    "cash_yearlike_quarter": """
        SELECT count(*) AS count
        FROM cash_flows
        WHERE lower(coalesce(period_type, '')) = 'quarter'
          AND fiscal_quarter IS NULL
          AND period ~ '^20\\d{2}$'
          AND fiscal_year = CAST(period AS integer)
    """,
    "ratios_swapped_quarter_format": """
        SELECT count(*) AS count
        FROM financial_ratios
        WHERE period ~ '^20\\d{2}-Q[1-4]$'
    """,
    "income_conflicting_duplicates": """
        SELECT count(*) AS count
        FROM income_statements q
        WHERE lower(coalesce(q.period_type, '')) = 'quarter'
          AND q.fiscal_quarter IS NULL
          AND q.period ~ '^20\\d{2}$'
          AND q.fiscal_year = CAST(q.period AS integer)
          AND EXISTS (
            SELECT 1 FROM income_statements y
            WHERE y.symbol = q.symbol
              AND y.period = q.period
              AND lower(coalesce(y.period_type, '')) = 'year'
          )
    """,
    "balance_conflicting_duplicates": """
        SELECT count(*) AS count
        FROM balance_sheets q
        WHERE lower(coalesce(q.period_type, '')) = 'quarter'
          AND q.fiscal_quarter IS NULL
          AND q.period ~ '^20\\d{2}$'
          AND q.fiscal_year = CAST(q.period AS integer)
          AND EXISTS (
            SELECT 1 FROM balance_sheets y
            WHERE y.symbol = q.symbol
              AND y.period = q.period
              AND lower(coalesce(y.period_type, '')) = 'year'
          )
    """,
    "cash_conflicting_duplicates": """
        SELECT count(*) AS count
        FROM cash_flows q
        WHERE lower(coalesce(q.period_type, '')) = 'quarter'
          AND q.fiscal_quarter IS NULL
          AND q.period ~ '^20\\d{2}$'
          AND q.fiscal_year = CAST(q.period AS integer)
          AND EXISTS (
            SELECT 1 FROM cash_flows y
            WHERE y.symbol = q.symbol
              AND y.period = q.period
              AND lower(coalesce(y.period_type, '')) = 'year'
          )
    """,
    "balance_unrecoverable_small_year": """
        SELECT count(*) AS count
        FROM balance_sheets
        WHERE fiscal_year IS NOT NULL AND fiscal_year < 1900
    """,
    "cash_unrecoverable_small_year": """
        SELECT count(*) AS count
        FROM cash_flows
        WHERE fiscal_year IS NOT NULL AND fiscal_year < 1900
    """,
}


async def collect_report() -> dict[str, int]:
    report: dict[str, int] = {}
    async with async_session_maker() as session:
        for name, sql in REPORT_SQL.items():
            result = await session.execute(text(sql))
            report[name] = int(result.scalar() or 0)
    return report


async def apply_safe_fixes() -> dict[str, int]:
    results: dict[str, int] = {}
    async with async_session_maker() as session:
        for fix in SAFE_FIXES:
            result = await session.execute(text(fix.sql))
            results[fix.name] = int(result.rowcount or 0)
        await session.commit()
    return results


async def _main(apply: bool) -> None:
    before = await collect_report()
    payload: dict[str, object] = {"before": before}

    if apply:
        payload["applied"] = await apply_safe_fixes()
        payload["after"] = await collect_report()

    print(json.dumps(payload, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Repair safe financial period issues")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the safe repairs instead of reporting only",
    )
    args = parser.parse_args()
    asyncio.run(_main(args.apply))


if __name__ == "__main__":
    main()
