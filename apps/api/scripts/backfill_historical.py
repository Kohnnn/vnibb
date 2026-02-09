#!/usr/bin/env python
"""
Backfill historical prices for top stocks by market cap.

Usage:
  python scripts/backfill_historical.py --years 5 --limit 100
"""

import argparse
import asyncio
import logging
import os
import sys
from datetime import date, timedelta
from typing import List

from sqlalchemy import select, func, desc

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.core.database import async_session_maker
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.services.data_pipeline import DataPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


async def get_top_symbols(limit: int) -> List[str]:
    async with async_session_maker() as session:
        latest_date = await session.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
        snapshot_date = latest_date.scalar()
        if not snapshot_date:
            logger.warning("No screener snapshots found.")
            return []

        result = await session.execute(
            select(ScreenerSnapshot.symbol)
            .where(ScreenerSnapshot.snapshot_date == snapshot_date)
            .order_by(desc(ScreenerSnapshot.market_cap))
            .limit(limit)
        )
        symbols = [row[0] for row in result.fetchall() if row[0]]
        if symbols:
            return symbols

        fallback = await session.execute(
            select(Stock.symbol)
            .where(Stock.is_active == 1)
            .order_by(Stock.symbol.asc())
            .limit(limit)
        )
        return [row[0] for row in fallback.fetchall() if row[0]]


async def backfill_historical(years: int, limit: int):
    symbols = await get_top_symbols(limit)
    if not symbols:
        logger.warning("No symbols resolved for backfill.")
        return

    end_date = date.today()
    start_date = end_date - timedelta(days=years * 365)

    pipeline = DataPipeline()
    logger.info(f"Backfilling {len(symbols)} symbols from {start_date} to {end_date}")
    await pipeline.sync_daily_prices(symbols=symbols, start_date=start_date, end_date=end_date)


def main():
    parser = argparse.ArgumentParser(description="Backfill historical price data for top stocks")
    parser.add_argument("--years", type=int, default=5, help="Years of history to backfill")
    parser.add_argument("--limit", type=int, default=100, help="Number of top symbols by market cap")
    args = parser.parse_args()

    asyncio.run(backfill_historical(args.years, args.limit))


if __name__ == "__main__":
    main()
