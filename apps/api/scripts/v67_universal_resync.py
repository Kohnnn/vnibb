#!/usr/bin/env python3
"""V67 universal financial resync utility.

Runs financial statement sync for all active symbols in batches.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.providers.vnstock.financials import StatementType
from vnibb.services.data_pipeline import DataPipeline

logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="V67 universal financial resync")
    parser.add_argument(
        "--target",
        default="all",
        choices=["all", "income", "balance", "cashflow"],
        help="Target statement type. Current pipeline syncs all statement types together.",
    )
    parser.add_argument(
        "--symbols",
        default="ALL",
        help="Comma-separated symbols or ALL",
    )
    parser.add_argument(
        "--period",
        default="year",
        choices=["year", "quarter"],
        help="Statement period",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Batch size for symbol chunks",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional cap on number of symbols (0 means no cap)",
    )
    parser.add_argument(
        "--start-index",
        type=int,
        default=0,
        help="0-based start index for resume support",
    )
    parser.add_argument(
        "--end-index",
        type=int,
        default=0,
        help="0-based exclusive end index (0 means until end)",
    )
    return parser.parse_args()


async def load_symbols(
    symbols_arg: str,
    limit: int,
    start_index: int,
    end_index: int,
) -> list[str]:
    if symbols_arg.strip().upper() != "ALL":
        symbols = [symbol.strip().upper() for symbol in symbols_arg.split(",") if symbol.strip()]
        deduped = list(dict.fromkeys(symbols))
        if limit > 0:
            deduped = deduped[:limit]
        if start_index > 0 or end_index > 0:
            deduped = deduped[start_index:end_index or None]
        return deduped

    async with async_session_maker() as session:
        rows = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
        symbols = [str(row[0]).strip().upper() for row in rows.fetchall() if row[0]]

    deduped = list(dict.fromkeys(symbols))
    if limit > 0:
        deduped = deduped[:limit]
    if start_index > 0 or end_index > 0:
        deduped = deduped[start_index:end_index or None]
    return deduped


async def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

    symbols = await load_symbols(
        args.symbols,
        args.limit,
        max(args.start_index, 0),
        max(args.end_index, 0),
    )
    if not symbols:
        logger.warning("No symbols to sync")
        return 0

    target_map = {
        "all": [StatementType.INCOME, StatementType.BALANCE, StatementType.CASHFLOW],
        "income": [StatementType.INCOME],
        "balance": [StatementType.BALANCE],
        "cashflow": [StatementType.CASHFLOW],
    }
    statement_types = target_map[args.target]

    pipeline = DataPipeline()
    started_at = datetime.now(UTC)

    total_synced = 0
    for start in range(0, len(symbols), args.batch_size):
        batch = symbols[start : start + args.batch_size]
        synced = await pipeline.sync_financials(
            symbols=batch,
            period=args.period,
            statement_types=statement_types,
        )
        total_synced += synced
        logger.info(
            "Synced batch %d-%d: %d/%d symbols",
            start + 1,
            min(start + len(batch), len(symbols)),
            synced,
            len(batch),
        )

    completed_at = datetime.now(UTC)
    duration_seconds = (completed_at - started_at).total_seconds()

    print("# V67 Universal Financial Resync")
    print(f"- target: {args.target}")
    print(f"- period: {args.period}")
    print(f"- symbols_requested: {args.symbols}")
    print(f"- start_index: {max(args.start_index, 0)}")
    print(f"- end_index: {max(args.end_index, 0) if args.end_index > 0 else 'end'}")
    print(f"- symbols_total: {len(symbols)}")
    print(f"- symbols_synced: {total_synced}")
    print(f"- started_at: {started_at.isoformat()}")
    print(f"- completed_at: {completed_at.isoformat()}")
    print(f"- duration_seconds: {duration_seconds:.2f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
