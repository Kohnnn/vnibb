"""
Database Seeding CLI
Populates the database with initial stock data from vnstock.
Run with: python -m vnibb.cli.seed --full --days 30
"""

import asyncio
import logging
import sys
import argparse
from datetime import datetime, date, timedelta

from sqlalchemy import func, select

from vnibb.services.data_pipeline import data_pipeline
from vnibb.core.database import async_session_maker
from vnibb.core.config import settings
from vnibb.models.stock import Stock

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def check_database_status():
    """Check database status using health service."""
    from vnibb.services.health_service import get_health_service
    health = await get_health_service().get_database_health()
    return {
        "stock_count": health.get("database", {}).get("stock_count", 0),
        "needs_seed": health.get("status") == "needs_seed",
        "last_sync": health.get("sync", {}).get("last_sync_at"),
    }


async def seed_stock_symbols() -> dict:
    """Seed stock symbols and return summary stats for API usage."""
    success_count = await data_pipeline.sync_stock_list()
    exchanges = {}

    async with async_session_maker() as session:
        result = await session.execute(
            select(Stock.exchange, func.count(Stock.id)).group_by(Stock.exchange)
        )
        exchanges = {exchange: count for exchange, count in result.all() if exchange}

    return {
        "success_count": success_count,
        "error_count": 0,
        "exchanges": exchanges,
    }

async def run_seed(args):
    """Execute seeding based on CLI arguments."""
    if args.check:
        from vnibb.cli.seed import check_database_status
        status = await check_database_status()
        print("\n=== Database Status ===")
        print(f"Stock count:    {status['stock_count']}")
        print(f"Needs seeding:  {status['needs_seed']}")
        print(f"Last sync:      {status['last_sync'] or 'Never'}")
        return

    if args.full:
        logger.info(f"🚀 Starting FULL seeding pipeline for {args.days} days...")
        await data_pipeline.run_full_seeding(days=args.days, resume=not args.no_resume)
    elif args.type == "stocks":
        await data_pipeline.sync_stock_list()
    elif args.type == "prices":
        await data_pipeline.sync_daily_prices(days=args.days)
    elif args.type == "screener":
        await data_pipeline.sync_screener_data()
    else:
        logger.info("Please specify --full or --type. Use --help for options.")

def main():
    parser = argparse.ArgumentParser(description="VNIBB Database Seeding CLI")
    
    parser.add_argument("--full", action="store_true", help="Run full seeding pipeline")
    parser.add_argument(
        "--days",
        type=int,
        default=settings.price_history_years * 365,
        help="Number of days for historical data (default: 5 years)",
    )
    parser.add_argument("--type", type=str, choices=["stocks", "prices", "screener"], help="Seed specific data type")
    parser.add_argument("--check", action="store_true", help="Check database status")
    parser.add_argument("--no-resume", action="store_true", help="Disable resume for full seeding")
    
    # Keep backward compatibility for old flags if needed
    parser.add_argument("--with-prices", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--prices-days", type=int, help=argparse.SUPPRESS)

    args = parser.parse_args()
    
    # Handle suppress flags for backward compatibility
    if args.with_prices:
        args.type = "prices"
    if args.prices_days:
        args.days = args.prices_days

    asyncio.run(run_seed(args))

if __name__ == "__main__":
    main()
