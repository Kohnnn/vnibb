#!/usr/bin/env python3
"""In-process financial statement parity probe.

Calls the equity service layer directly for every active symbol, bypassing
the FastAPI rate limiter that polluted prior HTTP-based parity attempts.
Writes a CSV bucket report so we can spot tickers whose Financial Statement
tab is rendering blank.

Run from the monorepo root after installing dev dependencies::

    python -m apps.api.scripts.finstmt_parity --limit 100
    python -m apps.api.scripts.finstmt_parity --symbols VNM,VIC,FPT --period FY,Q1,TTM

Outputs::

    output/finstmt_parity_<timestamp>.csv
    output/finstmt_parity_<timestamp>.summary.json
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.providers.vnstock.financials import StatementType
from vnibb.services.financial_service import get_financials_with_ttm

logger = logging.getLogger("finstmt_parity")

# Map FE-facing period strings to backend canonical values, mirroring
# `apps/web/src/lib/api.ts:normalizeFinancialStatementPeriod`. Keep this
# table in sync if the frontend mapping changes.
PERIOD_ALIASES: dict[str, str] = {
    "FY": "year",
    "YEAR": "year",
    "ANNUAL": "year",
    "Q": "quarter",
    "QUARTER": "quarter",
    "Q1": "Q1",
    "Q2": "Q2",
    "Q3": "Q3",
    "Q4": "Q4",
    "TTM": "TTM",
}

STATEMENT_KEYS: list[tuple[str, str]] = [
    ("income", StatementType.INCOME.value),
    ("balance", StatementType.BALANCE.value),
    ("cashflow", StatementType.CASHFLOW.value),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="In-process financial parity probe")
    parser.add_argument(
        "--symbols",
        default="ALL",
        help="Comma-separated symbol list, or ALL to probe every active symbol.",
    )
    parser.add_argument(
        "--period",
        default="FY",
        help="Comma-separated period selectors (FY, Q1, Q2, Q3, Q4, TTM).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional cap on number of symbols (0 = no cap).",
    )
    parser.add_argument(
        "--statements",
        default="income,balance,cashflow",
        help="Comma-separated statement keys to probe (income, balance, cashflow).",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Number of symbols to probe in parallel.",
    )
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory for CSV/JSON output.",
    )
    return parser.parse_args()


async def load_symbols(symbols_arg: str, limit: int) -> list[str]:
    if symbols_arg.strip().upper() != "ALL":
        symbols = [s.strip().upper() for s in symbols_arg.split(",") if s.strip()]
        deduped = list(dict.fromkeys(symbols))
        return deduped[:limit] if limit > 0 else deduped

    async with async_session_maker() as session:
        rows = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
        symbols = [str(row[0]).strip().upper() for row in rows.fetchall() if row[0]]

    deduped = list(dict.fromkeys(symbols))
    return deduped[:limit] if limit > 0 else deduped


def canonicalize_period(period: str) -> str:
    return PERIOD_ALIASES.get(period.strip().upper(), period.strip().lower())


def count_non_null_metrics(rows: list[Any]) -> int:
    total = 0
    for row in rows:
        if hasattr(row, "model_dump"):
            payload = row.model_dump()
        elif isinstance(row, dict):
            payload = row
        else:
            payload = getattr(row, "__dict__", {})
        for key, value in payload.items():
            if key in {"period", "fiscal_year", "year_report", "year"}:
                continue
            if value not in (None, "", []):
                total += 1
    return total


def distinct_periods(rows: list[Any]) -> list[str]:
    seen: list[str] = []
    for row in rows:
        period = getattr(row, "period", None) if not isinstance(row, dict) else row.get("period")
        if period and period not in seen:
            seen.append(str(period))
    return seen


async def probe_statement(
    symbol: str,
    statement_key: str,
    statement_type: str,
    period_value: str,
) -> dict[str, Any]:
    started = datetime.now(UTC)
    try:
        rows = await get_financials_with_ttm(
            symbol=symbol,
            statement_type=statement_type,
            period=period_value,
            limit=8,
        )
        return {
            "symbol": symbol,
            "statement": statement_key,
            "period_canonical": canonicalize_period(period_value),
            "period_requested": period_value,
            "row_count": len(rows),
            "non_null_metric_count": count_non_null_metrics(rows),
            "distinct_periods": "|".join(distinct_periods(rows)),
            "error": "",
            "duration_ms": int((datetime.now(UTC) - started).total_seconds() * 1000),
        }
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("[%s/%s/%s] %s", symbol, statement_key, period_value, exc)
        return {
            "symbol": symbol,
            "statement": statement_key,
            "period_canonical": canonicalize_period(period_value),
            "period_requested": period_value,
            "row_count": 0,
            "non_null_metric_count": 0,
            "distinct_periods": "",
            "error": str(exc),
            "duration_ms": int((datetime.now(UTC) - started).total_seconds() * 1000),
        }


async def probe_symbol(
    symbol: str,
    statement_keys: list[str],
    period_values: list[str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for period_value in period_values:
        for key in statement_keys:
            resolved = next((s for k, s in STATEMENT_KEYS if k == key), None)
            if resolved is None:
                continue
            rows.append(await probe_statement(symbol, key, resolved, period_value))
    return rows


async def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

    symbols = await load_symbols(args.symbols, args.limit)
    if not symbols:
        logger.warning("No symbols to probe.")
        return 0

    period_values = [p.strip() for p in args.period.split(",") if p.strip()]
    statement_keys = [s.strip().lower() for s in args.statements.split(",") if s.strip()]
    invalid = [k for k in statement_keys if k not in {"income", "balance", "cashflow"}]
    if invalid:
        logger.error("Unknown --statements value(s): %s", invalid)
        return 2

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"finstmt_parity_{timestamp}.csv"
    summary_path = output_dir / f"finstmt_parity_{timestamp}.summary.json"

    semaphore = asyncio.Semaphore(max(1, args.concurrency))

    async def guarded(symbol: str) -> list[dict[str, Any]]:
        async with semaphore:
            return await probe_symbol(symbol, statement_keys, period_values)

    started_at = datetime.now(UTC)
    logger.info(
        "Probing %d symbols x %d periods x %d statements (concurrency=%d)",
        len(symbols),
        len(period_values),
        len(statement_keys),
        args.concurrency,
    )

    all_rows: list[dict[str, Any]] = []
    for batch_start in range(0, len(symbols), 50):
        batch = symbols[batch_start : batch_start + 50]
        results = await asyncio.gather(*(guarded(s) for s in batch))
        for symbol_rows in results:
            all_rows.extend(symbol_rows)
        logger.info(
            "Progress: %d / %d symbols",
            min(batch_start + len(batch), len(symbols)),
            len(symbols),
        )

    fieldnames = [
        "symbol",
        "statement",
        "period_canonical",
        "period_requested",
        "row_count",
        "non_null_metric_count",
        "distinct_periods",
        "error",
        "duration_ms",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    summary = {
        "total_checks": len(all_rows),
        "blank_rows": sum(1 for r in all_rows if r["row_count"] == 0 and not r["error"]),
        "error_rows": sum(1 for r in all_rows if r["error"]),
        "filled_rows": sum(1 for r in all_rows if r["row_count"] > 0 and r["non_null_metric_count"] > 0),
        "by_statement": {
            key: {
                "blank": sum(1 for r in all_rows if r["statement"] == key and r["row_count"] == 0 and not r["error"]),
                "error": sum(1 for r in all_rows if r["statement"] == key and r["error"]),
                "filled": sum(
                    1
                    for r in all_rows
                    if r["statement"] == key and r["row_count"] > 0 and r["non_null_metric_count"] > 0
                ),
            }
            for key in {"income", "balance", "cashflow"}
            if key in statement_keys
        },
        "started_at": started_at.isoformat(),
        "completed_at": datetime.now(UTC).isoformat(),
        "symbols_total": len(symbols),
    }
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    logger.info("Wrote %s", csv_path)
    logger.info("Wrote %s", summary_path)
    logger.info("Summary: %s", json.dumps(summary["by_statement"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
