#!/usr/bin/env python
"""
Historical Data Seeder - Bulk populate database from VNStock (Golden Sponsor)

Golden Sponsor Rate Limit: 600 req/min (10 req/sec)
Appwrite population is enabled by default so Appwrite stays warm as the
primary runtime datastore while Supabase/Postgres remains the fallback source.

Usage:
    python scripts/seed_historical.py --days 365 --include-financials
    python scripts/seed_historical.py --symbols VCI,ACB --days 30
    python scripts/seed_historical.py --full
"""

import argparse
import asyncio
import logging
import os
import sys
from datetime import date, timedelta

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.core.database import async_session_maker
from vnibb.services.appwrite_population import (
    populate_appwrite_tables,
    populate_primary_appwrite_data,
)
from vnibb.services.data_pipeline import DataPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


async def seed_stocks(populate_appwrite: bool = True) -> int:
    """Seed all stock symbols."""
    logger.info("🔄 Seeding stock list...")
    pipeline = DataPipeline()
    count = await pipeline.sync_stock_list()
    if populate_appwrite:
        await populate_appwrite_tables(["stocks"], full_refresh=True)
    logger.info(f"✅ Synced {count} stocks")
    return count


async def seed_prices(
    days: int = 365,
    symbols: list[str] | None = None,
    populate_appwrite: bool = True,
) -> int:
    """Seed historical price data."""
    logger.info(f"🔄 Seeding {days} days of price history...")
    pipeline = DataPipeline()

    start_date = date.today() - timedelta(days=days)
    end_date = date.today()

    count = await pipeline.sync_daily_prices(
        symbols=symbols,
        start_date=start_date,
        end_date=end_date,
    )
    if populate_appwrite:
        await populate_appwrite_tables(["stock_prices"])
    logger.info(f"✅ Synced {count} price records")
    return count


async def seed_index_prices(days: int = 365) -> int:
    """Seed market index prices."""
    logger.warning("Index price sync is not implemented in DataPipeline. Skipping.")
    return 0


async def seed_screener() -> int:
    """Seed screener data (84 metrics per stock)."""
    logger.info("🔄 Seeding screener data...")

    try:
        # Use the sync_screener_data method from data_pipeline
        from datetime import datetime

        from sqlalchemy.dialects.sqlite import insert
        from vnstock import Screener

        from vnibb.models.screener import ScreenerSnapshot

        screener = Screener()
        df = screener.stock(params={"exchangeName": "HOSE,HNX,UPCOM"}, limit=1700)

        if df is None or df.empty:
            logger.warning("No screener data returned")
            return 0

        async with async_session_maker() as session:
            count = 0
            for _, row in df.iterrows():
                stmt = insert(ScreenerSnapshot).values(
                    symbol=row.get("ticker"),
                    fetched_at=datetime.utcnow(),
                    data=row.to_dict(),
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["symbol"],
                    set_={"fetched_at": datetime.utcnow(), "data": row.to_dict()},
                )
                await session.execute(stmt)
                count += 1

            await session.commit()
            logger.info(f"✅ Synced {count} screener records")
            return count
    except Exception as e:
        logger.error(f"Screener sync failed: {e}")
        return 0


async def seed_company_profiles(
    symbols: list[str] | None = None,
    populate_appwrite: bool = True,
) -> int:
    """Seed company profiles."""
    logger.info("🔄 Seeding company profiles...")
    pipeline = DataPipeline()
    count = await pipeline.sync_company_profiles(symbols=symbols)
    if populate_appwrite:
        await populate_appwrite_tables(["stocks"], full_refresh=True)
    logger.info(f"✅ Synced {count} company profiles")
    return count


async def seed_full(
    days: int = 365,
    include_financials: bool = True,
    populate_appwrite: bool = True,
):
    """Run complete database seeding using DataPipeline with resume support."""
    logger.info("=" * 60)
    logger.info("🚀 FULL DATABASE SEEDING STARTED (Golden Sponsor)")
    logger.info("=" * 60)

    pipeline = DataPipeline()
    await pipeline.run_full_seeding(days=days, include_prices=True, resume=True)
    if populate_appwrite:
        await populate_primary_appwrite_data()

    logger.info("=" * 60)
    logger.info("✅ SEEDING COMPLETE")
    logger.info("=" * 60)
    return {"status": "completed", "days": days, "include_financials": include_financials}


def main():
    parser = argparse.ArgumentParser(description="VNStock Historical Data Seeder (Golden Sponsor)")
    parser.add_argument("--days", type=int, default=365, help="Days of history to fetch")
    parser.add_argument("--symbols", type=str, help="Comma-separated list of symbols")
    parser.add_argument(
        "--include-financials",
        action="store_true",
        help="Include financial statements",
    )
    parser.add_argument("--full", action="store_true", help="Run full seeding")
    parser.add_argument(
        "--type",
        type=str,
        choices=["stocks", "prices", "screener", "profiles"],
        help="Seed specific data type",
    )
    parser.add_argument(
        "--skip-appwrite-populate",
        action="store_true",
        help="Skip Appwrite population after seeding",
    )

    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else None
    populate_appwrite = not args.skip_appwrite_populate

    if args.full:
        asyncio.run(seed_full(args.days, args.include_financials, populate_appwrite))
    elif args.type == "stocks":
        asyncio.run(seed_stocks(populate_appwrite=populate_appwrite))
    elif args.type == "prices":
        asyncio.run(seed_prices(args.days, symbols, populate_appwrite))
    elif args.type == "screener":
        asyncio.run(seed_screener())
    elif args.type == "profiles":
        asyncio.run(seed_company_profiles(symbols, populate_appwrite))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
