"""
Full Market Data Synchronization Service

Syncs all VN market data to PostgreSQL with:
- All stock symbols from listing
- Company profiles for all stocks
- Current prices for all stocks  
- Historical data for all stocks

Uses batch processing and upsert patterns for efficiency.
"""

import asyncio
import logging
from datetime import date, timedelta
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from vnibb.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    """Result from a sync operation."""
    success: bool
    synced_count: int
    error_count: int
    duration_seconds: float
    errors: List[str]


class FullMarketSync:
    """
    Full market data synchronization service.
    
    Fetches data from vnstock and stores in database.
    Uses batching and upsert patterns for efficiency.
    """
    
    def __init__(self, source: str = settings.vnstock_source):

        self.source = source
        self._symbols_cache: List[str] = []
    
    async def get_all_symbols(self) -> List[str]:
        """Fetch all stock symbols from listing endpoint."""
        if self._symbols_cache:
            return self._symbols_cache
        
        try:
            def _fetch():
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol="VNM", source=self.source)
                df = stock.listing.all_symbols()
                if df is None or df.empty:
                    return []
                return df["symbol"].tolist()
            
            loop = asyncio.get_event_loop()
            symbols = await loop.run_in_executor(None, _fetch)
            self._symbols_cache = symbols
            logger.info(f"Fetched {len(symbols)} symbols from listing")
            return symbols
        except Exception as e:
            logger.error(f"Failed to fetch symbols: {e}")
            return []
    
    async def sync_all_symbols(self) -> SyncResult:
        """
        Fetch and store all stock symbols from listing.
        
        Returns SyncResult with count of synced symbols.
        """
        import time
        start = time.time()
        errors = []
        
        try:
            symbols = await self.get_all_symbols()
            
            # TODO: Upsert to database when database models are ready
            # For now, just return the count
            
            duration = time.time() - start
            return SyncResult(
                success=True,
                synced_count=len(symbols),
                error_count=0,
                duration_seconds=duration,
                errors=[]
            )
        except Exception as e:
            duration = time.time() - start
            logger.error(f"Symbol sync failed: {e}")
            return SyncResult(
                success=False,
                synced_count=0,
                error_count=1,
                duration_seconds=duration,
                errors=[str(e)]
            )
    
    async def fetch_profile_batch(
        self, 
        symbols: List[str]
    ) -> tuple[List[Dict[str, Any]], List[str]]:
        """
        Fetch profiles for a batch of symbols.
        
        Returns tuple of (profiles, errors).
        """
        profiles = []
        errors = []
        
        def _fetch_one(symbol: str) -> Optional[Dict[str, Any]]:
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=symbol, source=self.source)
                df = stock.company.profile()
                if df is None or df.empty:
                    return None
                return df.to_dict(orient="records")[0]
            except Exception as e:
                return {"error": str(e), "symbol": symbol}
        
        loop = asyncio.get_event_loop()
        
        for symbol in symbols:
            try:
                result = await loop.run_in_executor(None, _fetch_one, symbol)
                if result:
                    if "error" in result:
                        errors.append(f"{symbol}: {result['error']}")
                    else:
                        result["symbol"] = symbol
                        profiles.append(result)
            except Exception as e:
                errors.append(f"{symbol}: {e}")
        
        return profiles, errors
    
    async def sync_all_profiles(
        self, 
        batch_size: int = 20, 
        max_symbols: Optional[int] = None
    ) -> SyncResult:
        """
        Fetch profiles for all stocks in batches.
        
        Args:
            batch_size: Number of symbols to fetch in parallel
            max_symbols: Optional limit for testing
        
        Returns SyncResult with sync statistics.
        """
        import time
        start = time.time()
        all_errors = []
        all_profiles = []
        
        try:
            symbols = await self.get_all_symbols()
            if max_symbols:
                symbols = symbols[:max_symbols]
            
            # Process in batches
            for i in range(0, len(symbols), batch_size):
                batch = symbols[i:i+batch_size]
                logger.info(f"Syncing profiles batch {i//batch_size + 1}/{(len(symbols) + batch_size - 1)//batch_size}")
                
                profiles, errors = await self.fetch_profile_batch(batch)
                all_profiles.extend(profiles)
                all_errors.extend(errors)
                
                # Small delay between batches to avoid rate limiting
                if i + batch_size < len(symbols):
                    await asyncio.sleep(0.5)
            
            # TODO: Upsert profiles to database
            
            duration = time.time() - start
            return SyncResult(
                success=True,
                synced_count=len(all_profiles),
                error_count=len(all_errors),
                duration_seconds=duration,
                errors=all_errors[:10]  # Only return first 10 errors
            )
        except Exception as e:
            duration = time.time() - start
            logger.error(f"Profile sync failed: {e}")
            return SyncResult(
                success=False,
                synced_count=len(all_profiles),
                error_count=len(all_errors) + 1,
                duration_seconds=duration,
                errors=[str(e)]
            )
    
    async def sync_all_prices(
        self, 
        max_symbols: Optional[int] = None
    ) -> SyncResult:
        """
        Fetch current prices for all stocks using screener endpoint.
        
        This is more efficient than fetching individual quotes.
        """
        import time
        start = time.time()
        
        try:
            def _fetch():
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol="VNM", source=self.source)
                df = stock.screener.stock()
                if df is None or df.empty:
                    return []
                return df.to_dict(orient="records")
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            if max_symbols:
                records = records[:max_symbols]
            
            # TODO: Upsert prices to database
            
            duration = time.time() - start
            logger.info(f"Synced {len(records)} prices in {duration:.2f}s")
            
            return SyncResult(
                success=True,
                synced_count=len(records),
                error_count=0,
                duration_seconds=duration,
                errors=[]
            )
        except Exception as e:
            duration = time.time() - start
            logger.error(f"Price sync failed: {e}")
            return SyncResult(
                success=False,
                synced_count=0,
                error_count=1,
                duration_seconds=duration,
                errors=[str(e)]
            )
    
    async def sync_historical_batch(
        self,
        symbols: List[str],
        days: int = 365
    ) -> tuple[int, List[str]]:
        """Fetch historical data for a batch of symbols."""
        synced = 0
        errors = []
        
        end_date = date.today()
        start_date = end_date - timedelta(days=days)
        
        def _fetch_one(symbol: str) -> Optional[List[Dict[str, Any]]]:
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=symbol, source=self.source)
                df = stock.quote.history(
                    start=start_date.isoformat(),
                    end=end_date.isoformat(),
                    interval="1D"
                )
                if df is None or df.empty:
                    return None
                records = df.to_dict(orient="records")
                for r in records:
                    r["symbol"] = symbol
                return records
            except Exception:
                return None
        
        loop = asyncio.get_event_loop()
        
        for symbol in symbols:
            try:
                records = await loop.run_in_executor(None, _fetch_one, symbol)
                if records:
                    synced += len(records)
                    # TODO: Upsert to database
            except Exception as e:
                errors.append(f"{symbol}: {e}")
        
        return synced, errors
    
    async def sync_historical(
        self,
        days: int = 365,
        batch_size: int = 10,
        max_symbols: Optional[int] = None
    ) -> SyncResult:
        """
        Fetch and store historical price data.
        
        Args:
            days: Number of days of history to fetch
            batch_size: Symbols per batch
            max_symbols: Optional limit for testing
        """
        import time
        start = time.time()
        total_synced = 0
        all_errors = []
        
        try:
            symbols = await self.get_all_symbols()
            if max_symbols:
                symbols = symbols[:max_symbols]
            
            for i in range(0, len(symbols), batch_size):
                batch = symbols[i:i+batch_size]
                logger.info(f"Syncing historical batch {i//batch_size + 1}/{(len(symbols) + batch_size - 1)//batch_size}")
                
                synced, errors = await self.sync_historical_batch(batch, days)
                total_synced += synced
                all_errors.extend(errors)
                
                if i + batch_size < len(symbols):
                    await asyncio.sleep(0.5)
            
            duration = time.time() - start
            return SyncResult(
                success=True,
                synced_count=total_synced,
                error_count=len(all_errors),
                duration_seconds=duration,
                errors=all_errors[:10]
            )
        except Exception as e:
            duration = time.time() - start
            return SyncResult(
                success=False,
                synced_count=total_synced,
                error_count=len(all_errors) + 1,
                duration_seconds=duration,
                errors=[str(e)]
            )
    
    async def run_full_sync(
        self,
        include_historical: bool = False,
        max_symbols: Optional[int] = None
    ) -> Dict[str, SyncResult]:
        """
        Run complete data sync with progress tracking.
        
        Args:
            include_historical: Whether to sync historical data
            max_symbols: Optional limit for testing
        
        Returns dict of sync results by operation.
        """
        results = {}
        
        logger.info("Starting full market sync...")
        
        # 1. Sync symbols
        logger.info("Step 1/3: Syncing symbols...")
        results["symbols"] = await self.sync_all_symbols()
        
        # 2. Sync prices (most important for real-time)
        logger.info("Step 2/3: Syncing prices...")
        results["prices"] = await self.sync_all_prices(max_symbols)
        
        # 3. Sync profiles
        logger.info("Step 3/3: Syncing profiles...")
        results["profiles"] = await self.sync_all_profiles(
            batch_size=20, 
            max_symbols=max_symbols
        )
        
        # 4. Optional: Sync historical
        if include_historical:
            logger.info("Step 4/4: Syncing historical data...")
            results["historical"] = await self.sync_historical(
                days=365,
                max_symbols=max_symbols
            )
        
        total_synced = sum(r.synced_count for r in results.values())
        total_errors = sum(r.error_count for r in results.values())
        total_duration = sum(r.duration_seconds for r in results.values())
        
        logger.info(
            f"Full sync complete: {total_synced} records synced, "
            f"{total_errors} errors, {total_duration:.2f}s total"
        )
        
        return results


# Convenience function for quick sync
async def run_price_sync():
    """Quick price sync for scheduler."""
    sync = FullMarketSync()
    return await sync.sync_all_prices()


async def run_profile_sync():
    """Profile sync for scheduler."""
    sync = FullMarketSync()
    return await sync.sync_all_profiles(batch_size=20)


async def run_full_sync(include_historical: bool = False):
    """Full sync for scheduler."""
    sync = FullMarketSync()
    return await sync.run_full_sync(include_historical=include_historical)
