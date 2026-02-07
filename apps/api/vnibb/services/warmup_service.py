"""
Warmup Service

Pre-populates caches on application startup to ensure sub-second response times
for frequently accessed endpoints like the screener.
"""

import asyncio
import logging
from typing import List

from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher, StockScreenerParams
from vnibb.services.cache_manager import CacheManager
from vnibb.core.database import async_session_maker

logger = logging.getLogger(__name__)

# Maximum time to attempt warmup for a single exchange
WARMUP_TIMEOUT = 5  # seconds per exchange (reduced for faster startup)

from vnibb.core.config import settings

async def _warmup_exchange(exchange: str):
    """Helper to warm up a single exchange."""
    from vnibb.providers.vnstock.equity_screener import VnstockScreenerFetcher, StockScreenerParams
    from vnibb.services.cache_manager import CacheManager
    from vnibb.core.database import async_session_maker
    
    async with async_session_maker() as db:
        cache_manager = CacheManager(db)
        logger.info(f"Warming up screener data for exchange: {exchange}")
        params = StockScreenerParams(
            exchange=exchange,
            limit=1000,
            source=settings.vnstock_source
        )
        
        data = await VnstockScreenerFetcher.fetch(params)
        
        if data:
            await cache_manager.store_screener_data(
                data=[d.model_dump() for d in data],
                source=settings.vnstock_source
            )
            logger.info(f"Warmed up {len(data)} records for {exchange}")

async def warmup_cache():
    """
    Main warmup task. Executes multiple warming routines in background.
    
    CRITICAL: This function MUST NOT block server startup.
    All errors are caught and logged, never propagated.
    """
    logger.info("Starting cache warmup...")
    
    exchanges = ["HOSE", "HNX", "UPCOM"]
    
    for exchange in exchanges:
        try:
            await asyncio.wait_for(
                _warmup_exchange(exchange),
                timeout=WARMUP_TIMEOUT
            )
            await asyncio.sleep(1)  # Reduced from 3 to 1 second
        except asyncio.TimeoutError:
            logger.warning(f"Warmup timeout for {exchange}")
        except BaseException as e:
            if isinstance(e, asyncio.CancelledError):
                raise
            error_str = str(e).lower()
            if any(x in error_str for x in ["quá nhiều", "rate limit", "429", "too many"]):
                logger.warning(f"Rate limit hit on {exchange}, stopping warmup early")
                break
            if isinstance(e, SystemExit):
                logger.warning(f"Warmup aborted by provider for {exchange}: {e}")
                break
            logger.error(f"Warmup error for {exchange}: {e}")

    logger.info("Cache warmup completed (or skipped due to errors).")

if __name__ == "__main__":
    # Allow manual run
    asyncio.run(warmup_cache())
