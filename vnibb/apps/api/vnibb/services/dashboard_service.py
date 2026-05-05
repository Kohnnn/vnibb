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

    # Static fallback data for instant response
    _FALLBACK_INDICES = [
        MarketIndexData(index_name="VN-INDEX", current_value=1250.00, change=0.0, change_pct=0.0),
        MarketIndexData(index_name="VN30", current_value=1280.00, change=0.0, change_pct=0.0),
        MarketIndexData(index_name="HNX", current_value=230.00, change=0.0, change_pct=0.0),
        MarketIndexData(index_name="UPCOM", current_value=92.00, change=0.0, change_pct=0.0),
    ]

    async def get_market_overview(self) -> List[MarketIndexData]:
        """
        Get current market indices with caching.
        Returns cached/fallback data immediately, fetches fresh data with timeout.
        """
        key = "market_overview"
        
        # Return cached data immediately if available
        cached_data = self._get_cached(key)
        if cached_data:
            return cached_data
        
        # Try to acquire lock without blocking
        try:
            # Use wait_for with short timeout to prevent blocking
            async with asyncio.timeout(0.1):
                async with self._locks["market_overview"]:
                    # Double-check cache after acquiring lock
                    cached_data = self._get_cached(key)
                    if cached_data:
                        return cached_data
                    
                    try:
                        # Fetch with 10 second timeout
                        indices = await asyncio.wait_for(
                            VnstockMarketOverviewFetcher.fetch(MarketOverviewQueryParams()),
                            timeout=10.0
                        )
                        if indices:
                            self._set_cached(key, indices, self._market_ttl)
                            return indices
                    except asyncio.TimeoutError:
                        logger.warning("Market overview fetch timed out after 10s")
                    except Exception as e:
                        logger.error(f"Failed to fetch market overview: {e}")
                    
                    # Return expired cache or fallback
                    if key in self._cache:
                        return self._cache[key][0]
                    return self._FALLBACK_INDICES
        except asyncio.TimeoutError:
            # Lock acquisition timed out - another request is fetching
            # Return cached or fallback data instead of blocking
            logger.info("Market overview lock busy, returning cached/fallback data")
            if key in self._cache:
                return self._cache[key][0]
            return self._FALLBACK_INDICES


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
