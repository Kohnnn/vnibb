"""
Dashboard Service - Market Overview and Top Movers

Provides high-level data for the dashboard with in-memory caching.
Simple TTL-based caching to reduce load on providers.
"""

import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from vnibb.providers.vnstock.market_overview import (
    VnstockMarketOverviewFetcher,
    MarketOverviewQueryParams,
    MarketIndexData,
)
from vnibb.providers.vnstock.top_movers import VnstockTopMoversFetcher, TopMoverData

logger = logging.getLogger(__name__)


class DashboardService:
    """
    Service for dashboard data with in-memory caching.
    """
    
    def __init__(self):
        # Simple dict-based cache: {key: (data, expiry_timestamp)}
        self._cache: Dict[str, tuple[Any, datetime]] = {}
        
        # Cache TTLs
        self._market_ttl = 60  # seconds
        self._movers_ttl = 30  # seconds
        
        # Locks to prevent cache stampede
        self._locks: Dict[str, asyncio.Lock] = {
            "market_overview": asyncio.Lock(),
            "top_movers": asyncio.Lock()
        }

    def _get_cached(self, key: str) -> Optional[Any]:
        """Get data from cache if not expired."""
        if key in self._cache:
            data, expiry = self._cache[key]
            if datetime.now() < expiry:
                return data
            # Clean up expired entry
            del self._cache[key]
        return None

    def _set_cached(self, key: str, data: Any, ttl: int):
        """Set data in cache with TTL."""
        expiry = datetime.now() + timedelta(seconds=ttl)
        self._cache[key] = (data, expiry)

    def _last_known(self, key: str) -> List[Any]:
        """Last-cached value (even if expired), else empty; never fabricated."""
        if key in self._cache:
            return self._cache[key][0]
        return []

    async def get_market_overview(self) -> List[MarketIndexData]:
        """
        Get current market indices with caching.

        Serves fresh cache immediately. Otherwise acquires a short-lived lock (to
        avoid a fetch stampede) and fetches live data with a 10s budget. On lock
        contention or fetch failure it degrades to the last-known value, never to
        fabricated index numbers.
        """
        key = "market_overview"

        # Return cached data immediately if available
        cached_data = self._get_cached(key)
        if cached_data:
            return cached_data

        # Acquire the fetch lock quickly. The short timeout guards ONLY lock
        # acquisition -- not the fetch below -- so a slow fetch can still complete
        # and populate the cache. If another request already holds the lock, serve
        # the last-known value rather than piling up behind it.
        lock = self._locks["market_overview"]
        try:
            await asyncio.wait_for(lock.acquire(), timeout=0.1)
        except asyncio.TimeoutError:
            logger.info("Market overview lock busy, returning last-known data")
            return self._last_known(key)

        try:
            cached_data = self._get_cached(key)
            if cached_data:
                return cached_data

            try:
                indices = await asyncio.wait_for(
                    VnstockMarketOverviewFetcher.fetch(MarketOverviewQueryParams()),
                    timeout=10.0,
                )
                if indices:
                    self._set_cached(key, indices, self._market_ttl)
                    return indices
            except asyncio.TimeoutError:
                logger.warning("Market overview fetch timed out after 10s")
            except Exception as e:
                logger.error(f"Failed to fetch market overview: {e}")

            return self._last_known(key)
        finally:
            lock.release()


    async def get_top_movers(
        self, 
        mover_type: str = "gainer", 
        index: str = "VNINDEX", 
        limit: int = 10
    ) -> List[TopMoverData]:
        """
        Get market top movers with caching.
        """
        key = f"movers_{mover_type}_{index}_{limit}"
        
        cached_data = self._get_cached(key)
        if cached_data:
            return cached_data
        
        async with self._locks["top_movers"]:
            # Double check
            cached_data = self._get_cached(key)
            if cached_data:
                return cached_data
                
            try:
                data = await VnstockTopMoversFetcher.fetch(
                    type=mover_type,
                    index=index,
                    limit=limit
                )
                if data:
                    self._set_cached(key, data, self._movers_ttl)
                return data
            except Exception as e:
                logger.error(f"Failed to fetch top movers ({mover_type}): {e}")
                if key in self._cache:
                    return self._cache[key][0]
                return []

# Global instance
dashboard_service = DashboardService()
