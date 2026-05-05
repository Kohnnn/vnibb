"""
Complete Data Sync Pipeline for VNIBB

This service handles comprehensive data collection from vnstock,
storing all data in the database for offline access and faster queries.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import select, insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db_context
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.company import Company
from vnibb.providers.vnstock.listing import VnstockListingFetcher
from vnibb.providers.vnstock.equity_profile import VnstockProfileFetcher
from vnibb.providers.vnstock.equity_historical import VnstockHistoricalFetcher

logger = logging.getLogger(__name__)


class CompleteDataSyncPipeline:
    """
    Complete data synchronization from vnstock to database.
    
    Syncs:
    - All stock symbols (1700+)
    - Company profiles
    - Historical prices (5 years)
    - Financial statements
    """
    
    def __init__(self, batch_size: int = 20, max_symbols: Optional[int] = None):
        self.batch_size = batch_size
        self.max_symbols = max_symbols
        self.stats = {
            "stocks_synced": 0,
            "profiles_synced": 0,
            "prices_synced": 0,
            "errors": [],
            "start_time": None,
            "end_time": None,
        }
    
    async def sync_all_symbols(self) -> List[str]:
        """
        Sync all stock symbols from vnstock to database.
        Returns list of all symbols.
        """
        logger.info("Starting symbol sync...")
        try:
            # Fetch all symbols from vnstock
            symbols_data = await VnstockListingFetcher.fetch_all_symbols()
            
            if not symbols_data:
                logger.warning("No symbols returned from vnstock")
                return []
            
            async with get_db_context() as db:
                for item in symbols_data[:self.max_symbols] if self.max_symbols else symbols_data:
                    stmt = pg_insert(Stock).values(
                        symbol=item.symbol,
                        company_name=item.organ_name or item.organ_short_name,
                        exchange=item.com_group_code or "HOSE",
                    ).on_conflict_do_update(
                        index_elements=["symbol"],
                        set_={"company_name": item.organ_name, "updated_at": datetime.utcnow()}
                    )
                    await db.execute(stmt)
                await db.commit()
            
            symbols = [s.symbol for s in symbols_data]
            if self.max_symbols:
                symbols = symbols[:self.max_symbols]
            
            self.stats["stocks_synced"] = len(symbols)
            logger.info(f"Synced {len(symbols)} symbols to database")
            return symbols
            
        except Exception as e:
            logger.error(f"Symbol sync failed: {e}")
            self.stats["errors"].append(f"symbol_sync: {str(e)}")
            return []
    
    async def sync_profile(self, symbol: str) -> bool:
        """Sync company profile for a single symbol."""
        try:
            profile = await VnstockProfileFetcher.fetch(symbol)
            if not profile:
                return False
            
            async with get_db_context() as db:
                stmt = pg_insert(Company).values(
                    symbol=symbol,
                    company_name=profile.company_name,
                    exchange=profile.exchange,
                    industry=profile.industry,
                    sector=profile.sector,
                    business_description=profile.description,
                ).on_conflict_do_update(
                    index_elements=["symbol"],
                    set_={
                        "company_name": profile.company_name,
                        "industry": profile.industry,
                        "sector": profile.sector,
                        "updated_at": datetime.utcnow()
                    }
                )
                await db.execute(stmt)
                await db.commit()
            
            return True
        except Exception as e:
            logger.debug(f"Profile sync failed for {symbol}: {e}")
            return False
    
    async def sync_historical(self, symbol: str, years: int = 5) -> int:
        """Sync historical prices for a single symbol."""
        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=years * 365)
            
            data = await VnstockHistoricalFetcher.fetch(
                symbol=symbol,
                start_date=start_date.strftime("%Y-%m-%d"),
                end_date=end_date.strftime("%Y-%m-%d"),
                interval="1D"
            )
            
            if not data or not data.data:
                return 0
            
            count = 0
            async with get_db_context() as db:
                # Get stock ID
                result = await db.execute(
                    select(Stock.id).where(Stock.symbol == symbol)
                )
                stock = result.scalar_one_or_none()
                if not stock:
                    return 0
                
                for candle in data.data:
                    stmt = pg_insert(StockPrice).values(
                        stock_id=stock,
                        symbol=symbol,
                        time=candle.time,
                        open=candle.open,
                        high=candle.high,
                        low=candle.low,
                        close=candle.close,
                        volume=candle.volume,
                        interval="1D",
                    ).on_conflict_do_nothing()
                    await db.execute(stmt)
                    count += 1
                
                await db.commit()
            
            return count
        except Exception as e:
            logger.debug(f"Historical sync failed for {symbol}: {e}")
            return 0
    
    async def sync_batch_profiles(self, symbols: List[str]) -> int:
        """Sync profiles for a batch of symbols in parallel."""
        tasks = [self.sync_profile(s) for s in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return sum(1 for r in results if r is True)
    
    async def sync_batch_historical(self, symbols: List[str]) -> int:
        """Sync historical data for a batch of symbols."""
        total = 0
        for symbol in symbols:
            count = await self.sync_historical(symbol)
            total += count
            await asyncio.sleep(0.5)  # Rate limiting
        return total
    
    async def run_full_sync(self, sync_profiles: bool = True, sync_history: bool = True):
        """
        Run complete data synchronization.
        
        Args:
            sync_profiles: Whether to sync company profiles
            sync_history: Whether to sync historical prices
        """
        self.stats["start_time"] = datetime.utcnow()
        logger.info("=" * 50)
        logger.info("Starting FULL DATA SYNC")
        logger.info("=" * 50)
        
        # Step 1: Sync all symbols
        symbols = await self.sync_all_symbols()
        if not symbols:
            logger.error("No symbols to sync, aborting")
            return self.stats
        
        # Step 2: Sync profiles in batches
        if sync_profiles:
            logger.info(f"Syncing profiles for {len(symbols)} symbols...")
            for i in range(0, len(symbols), self.batch_size):
                batch = symbols[i:i + self.batch_size]
                count = await self.sync_batch_profiles(batch)
                self.stats["profiles_synced"] += count
                logger.info(f"Profiles: {self.stats['profiles_synced']}/{len(symbols)}")
                await asyncio.sleep(1)  # Rate limiting
        
        # Step 3: Sync historical prices
        if sync_history:
            logger.info(f"Syncing historical prices for {len(symbols)} symbols...")
            for i in range(0, len(symbols), self.batch_size):
                batch = symbols[i:i + self.batch_size]
                count = await self.sync_batch_historical(batch)
                self.stats["prices_synced"] += count
                progress = min(i + self.batch_size, len(symbols))
                logger.info(f"Historical: {progress}/{len(symbols)} ({self.stats['prices_synced']} prices)")
        
        self.stats["end_time"] = datetime.utcnow()
        duration = (self.stats["end_time"] - self.stats["start_time"]).total_seconds()
        
        logger.info("=" * 50)
        logger.info("SYNC COMPLETE")
        logger.info(f"Duration: {duration:.1f}s")
        logger.info(f"Stocks: {self.stats['stocks_synced']}")
        logger.info(f"Profiles: {self.stats['profiles_synced']}")
        logger.info(f"Prices: {self.stats['prices_synced']}")
        logger.info(f"Errors: {len(self.stats['errors'])}")
        logger.info("=" * 50)
        
        return self.stats


# CLI entry point
async def main():
    """Run sync from command line."""
    import argparse
    
    parser = argparse.ArgumentParser(description="VNIBB Data Sync Pipeline")
    parser.add_argument("--max-symbols", type=int, default=None, help="Limit symbols to sync")
    parser.add_argument("--batch-size", type=int, default=20, help="Batch size")
    parser.add_argument("--no-profiles", action="store_true", help="Skip profile sync")
    parser.add_argument("--no-history", action="store_true", help="Skip historical sync")
    
    args = parser.parse_args()
    
    logging.basicConfig(level=logging.INFO)
    
    pipeline = CompleteDataSyncPipeline(
        batch_size=args.batch_size,
        max_symbols=args.max_symbols
    )
    
    await pipeline.run_full_sync(
        sync_profiles=not args.no_profiles,
        sync_history=not args.no_history
    )


if __name__ == "__main__":
    asyncio.run(main())
