#!/usr/bin/env python3
"""V68 screener enrichment utility.

Refreshes yearly financial ratios and screener snapshots for selected symbols.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select

from vnibb.core.database import async_session_maker
from vnibb.models.stock import Stock
from vnibb.services.data_pipeline import DataPipeline

logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="V68 screener enrichment")
    parser.add_argument(
        "--symbols",
        default="ALL",
        help="Comma-separated symbols or ALL",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional cap on number of symbols (0 means no cap)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Chunk size for screener sync",
    )
    parser.add_argument(
        "--skip-ratios",
        action="store_true",
        help="Skip yearly ratio refresh before screener enrichment",
    )
    return parser.parse_args()


async def load_symbols(symbols_arg: str, limit: int) -> list[str]:
    if symbols_arg.strip().upper() != "ALL":
        symbols = [symbol.strip().upper() for symbol in symbols_arg.split(",") if symbol.strip()]
        deduped = list(dict.fromkeys(symbols))
        return deduped[:limit] if limit > 0 else deduped

    async with async_session_maker() as session:
        rows = await session.execute(select(Stock.symbol).where(Stock.is_active == 1))
        symbols = [str(row[0]).strip().upper() for row in rows.fetchall() if row[0]]

    deduped = list(dict.fromkeys(symbols))
    return deduped[:limit] if limit > 0 else deduped


async def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

    symbols = await load_symbols(args.symbols, args.limit)
    if not symbols:
        logger.warning("No symbols to enrich")
        return 0

    pipeline = DataPipeline()
    started_at = datetime.now(UTC)

    ratio_synced = 0
    if not args.skip_ratios:
        ratio_synced = await pipeline.sync_financial_ratios(symbols=symbols, period="year")
        logger.info("Yearly ratios refreshed for %d symbols", ratio_synced)

    screener_synced = 0
    for start in range(0, len(symbols), args.batch_size):
        batch = symbols[start : start + args.batch_size]
        synced = await pipeline.sync_screener_data(symbols=batch, limit=len(batch))
        screener_synced += synced
        logger.info(
            "Screener batch %d-%d synced: %d/%d symbols",
            start + 1,
            min(start + len(batch), len(symbols)),
            synced,
            len(batch),
        )

    completed_at = datetime.now(UTC)
    duration_seconds = (completed_at - started_at).total_seconds()

    print("# V68 Screener Enrichment")
    print(f"- symbols_requested: {args.symbols}")
    print(f"- symbols_total: {len(symbols)}")
    print(f"- ratios_refreshed: {ratio_synced}")
    print(f"- screener_rows_synced: {screener_synced}")
    print(f"- started_at: {started_at.isoformat()}")
    print(f"- completed_at: {completed_at.isoformat()}")
    print(f"- duration_seconds: {duration_seconds:.2f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
