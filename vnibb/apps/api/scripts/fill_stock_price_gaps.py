#!/usr/bin/env python3
"""Backfill stale daily price ranges using DataPipeline gap-fill logic."""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import and_, func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock, StockPrice
from vnibb.services.data_pipeline import data_pipeline


@dataclass
class PriceCoverage:
    symbol: str
    earliest_date: date | None
    latest_date: date | None
    trading_days: int


def parse_symbols(raw: str) -> list[str]:
    return [symbol.strip().upper() for symbol in raw.split(",") if symbol.strip()]


async def load_price_coverage(symbols: list[str] | None = None) -> list[PriceCoverage]:
    async with async_session_maker() as session:
        stmt = (
            select(
                Stock.symbol,
                func.min(StockPrice.time).label("earliest_date"),
                func.max(StockPrice.time).label("latest_date"),
                func.count(func.distinct(StockPrice.time)).label("trading_days"),
            )
            .select_from(Stock)
            .outerjoin(
                StockPrice,
                and_(
                    StockPrice.symbol == Stock.symbol,
                    StockPrice.interval == "1D",
                ),
            )
            .where(Stock.is_active == 1)
            .group_by(Stock.symbol)
        )

        if symbols:
            stmt = stmt.where(Stock.symbol.in_(symbols))

        rows = (await session.execute(stmt)).all()

    coverage = [
        PriceCoverage(
            symbol=str(row.symbol).upper(),
            earliest_date=row.earliest_date,
            latest_date=row.latest_date,
            trading_days=int(row.trading_days or 0),
        )
        for row in rows
    ]
    coverage.sort(
        key=lambda row: (row.latest_date is not None, row.latest_date or date.min, row.symbol)
    )
    return coverage


def select_stale_candidates(
    coverage_rows: list[PriceCoverage],
    stale_cutoff: date,
    include_empty: bool,
) -> list[PriceCoverage]:
    candidates: list[PriceCoverage] = []
    for row in coverage_rows:
        if row.latest_date is None:
            if include_empty:
                candidates.append(row)
            continue

        if row.latest_date < stale_cutoff:
            candidates.append(row)

    return candidates


async def refill_symbol(
    symbol: str,
    latest_date: date | None,
    end_date: date,
    bootstrap_days: int,
) -> int:
    start_date = latest_date or (end_date - timedelta(days=bootstrap_days))
    return await data_pipeline.sync_daily_prices(
        symbols=[symbol],
        start_date=start_date,
        end_date=end_date,
        fill_missing_gaps=True,
        cache_recent=False,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fill stale stock price gaps")
    parser.add_argument(
        "--symbols",
        type=str,
        default="",
        help="Comma-separated symbol list. Defaults to all active stocks.",
    )
    parser.add_argument(
        "--max-stale-days",
        type=int,
        default=2,
        help="Symbols older than this many days are considered stale.",
    )
    parser.add_argument(
        "--bootstrap-days",
        type=int,
        default=365,
        help="History window used when a symbol has no daily prices yet.",
    )
    parser.add_argument(
        "--max-symbols",
        type=int,
        default=0,
        help="Optional cap on how many stale symbols to process.",
    )
    parser.add_argument(
        "--include-empty",
        action="store_true",
        help="Also seed symbols with no existing 1D price rows.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show stale candidates without fetching data.",
    )
    return parser


async def _main() -> int:
    args = build_parser().parse_args()
    symbol_filters = parse_symbols(args.symbols)
    today = date.today()
    stale_cutoff = today - timedelta(days=max(args.max_stale_days, 0))

    coverage_rows = await load_price_coverage(symbol_filters or None)
    candidates = select_stale_candidates(
        coverage_rows=coverage_rows,
        stale_cutoff=stale_cutoff,
        include_empty=args.include_empty or bool(symbol_filters),
    )

    if args.max_symbols and args.max_symbols > 0:
        candidates = candidates[: args.max_symbols]

    print(f"# Fill Stock Price Gaps")
    print(f"- stale_cutoff: {stale_cutoff.isoformat()}")
    print(f"- candidate_count: {len(candidates)}")

    if not candidates:
        print("- status: no stale symbols found")
        return 0

    for row in candidates:
        print(
            f"- {row.symbol}: earliest={row.earliest_date} "
            f"latest={row.latest_date} trading_days={row.trading_days}"
        )

    if args.dry_run:
        return 0

    total_rows_synced = 0
    print("")
    for row in candidates:
        synced_rows = await refill_symbol(
            symbol=row.symbol,
            latest_date=row.latest_date,
            end_date=today,
            bootstrap_days=max(args.bootstrap_days, 1),
        )
        total_rows_synced += synced_rows

        refreshed = await load_price_coverage([row.symbol])
        after = refreshed[0] if refreshed else row
        print(
            f"  synced {row.symbol}: fetched_rows={synced_rows} "
            f"latest_before={row.latest_date} latest_after={after.latest_date} "
            f"trading_days_after={after.trading_days}"
        )

    print(f"- total_rows_synced: {total_rows_synced}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
