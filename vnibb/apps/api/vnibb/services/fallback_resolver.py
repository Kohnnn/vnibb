"""
Fallback Resolver Service

Orchestrates data retrieval with fallback chain:
1. Primary Provider (vnstock) -> 2. Scraper Fallback -> 3. Cache/Database

This pattern ensures high data availability even when primary sources fail.
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Generic, List, Optional, Type, TypeVar

from pydantic import BaseModel

from vnibb.providers.base import BaseFetcher
from vnibb.core.cache import redis_client, build_cache_key
from vnibb.core.exceptions import (
    ProviderError,
    DataNotFoundError,
    StaleDataError,
)

logger = logging.getLogger(__name__)

QueryT = TypeVar("QueryT", bound=BaseModel)
DataT = TypeVar("DataT", bound=BaseModel)


class FallbackResolver(Generic[QueryT, DataT]):
    """
    Data resolution chain with caching and fallback support.
    
    Resolution order:
    1. Check Redis cache for fresh data
    2. Try primary provider (e.g., vnstock)
    3. On failure, try scraper fallback (if configured)
    4. On all failures, return stale cache data
    
    All successful fetches are cached in Redis and optionally
    persisted to PostgreSQL for long-term storage.
    
    Example:
        resolver = FallbackResolver(
            primary_fetcher=VnstockEquityHistoricalFetcher,
            scraper_fetcher=Cophieu68HistoricalScraper,  # optional
            cache_prefix="equity:historical",
            cache_ttl_seconds=300,
        )
        
        data = await resolver.resolve(params)
    """
    
    def __init__(
        self,
        primary_fetcher: Type[BaseFetcher[QueryT, DataT]],
        data_model: Type[DataT],
        scraper_fetcher: Optional[Type[BaseFetcher[QueryT, DataT]]] = None,
        cache_prefix: str = "vnibb",
        cache_ttl_seconds: int = 300,
        stale_ttl_seconds: int = 86400,  # 24 hours for stale data
    ):
        """
        Initialize the fallback resolver.
        
        Args:
            primary_fetcher: Primary data provider (e.g., vnstock)
            data_model: Pydantic model class for deserialization
            scraper_fetcher: Optional fallback scraper
            cache_prefix: Redis key prefix
            cache_ttl_seconds: Fresh cache TTL (default: 5 minutes)
            stale_ttl_seconds: Stale cache TTL (default: 24 hours)
        """
        self.primary = primary_fetcher
        self.data_model = data_model
        self.scraper = scraper_fetcher
        self.cache_prefix = cache_prefix
        self.cache_ttl = cache_ttl_seconds
        self.stale_ttl = stale_ttl_seconds
    
    def _build_cache_key(self, params: QueryT) -> str:
        """Generate a unique cache key from query params."""
        # Create deterministic hash of params
        params_json = params.model_dump_json(exclude_none=True)
        params_hash = hashlib.md5(params_json.encode()).hexdigest()[:12]
        return build_cache_key(self.cache_prefix, params_hash)
    
    async def resolve(
        self,
        params: QueryT,
        credentials: Optional[dict[str, str]] = None,
        skip_cache: bool = False,
    ) -> List[DataT]:
        """
        Execute the fallback resolution chain.
        
        Args:
            params: Query parameters
            credentials: Optional provider credentials
            skip_cache: If True, bypass cache and force fresh fetch
        
        Returns:
            List of data models from the first successful source
        
        Raises:
            DataNotFoundError: If all sources fail and no stale data available
        """
        cache_key = self._build_cache_key(params)
        
        # Step 1: Check Redis cache (unless skip_cache)
        if not skip_cache:
            cached_data = await self._get_from_cache(cache_key)
            if cached_data:
                logger.debug(f"Cache HIT: {cache_key}")
                return cached_data
        
        # Step 2: Try primary provider
        primary_error: Optional[Exception] = None
        try:
            logger.debug(f"Fetching from primary: {self.primary.provider_name}")
            result = await self.primary.fetch(params, credentials)
            
            if result:
                await self._cache_result(cache_key, result)
                return result
                
        except Exception as e:
            primary_error = e
            logger.warning(f"Primary provider failed: {e}")
        
        # Step 3: Try scraper fallback (if configured)
        if self.scraper:
            try:
                logger.info(f"Trying scraper fallback: {self.scraper.provider_name}")
                result = await self.scraper.fetch(params, credentials)
                
                if result:
                    await self._cache_result(cache_key, result)
                    return result
                    
            except Exception as e:
                logger.warning(f"Scraper fallback failed: {e}")
        
        # Step 4: Return stale cache data if available
        stale_key = f"{cache_key}:stale"
        stale_data = await self._get_from_cache(stale_key)
        if stale_data:
            logger.warning(f"Returning stale data for {cache_key}")
            return stale_data
        
        # Step 5: All sources failed
        raise DataNotFoundError(
            resource_type=self.cache_prefix,
            identifier=str(params.model_dump()),
            details={"primary_error": str(primary_error) if primary_error else None},
        )
    
    async def _get_from_cache(self, key: str) -> Optional[List[DataT]]:
        """Retrieve and deserialize data from cache."""
        try:
            cached = await redis_client.get_json(key)
            if cached and isinstance(cached, list):
                return [self.data_model.model_validate(item) for item in cached]
        except Exception as e:
            logger.debug(f"Cache retrieval error: {e}")
        return None
    
    async def _cache_result(self, key: str, data: List[DataT]) -> None:
        """
        Cache result with both fresh and stale keys.
        
        Fresh data expires after cache_ttl_seconds.
        Stale data expires after stale_ttl_seconds (fallback).
        """
        try:
            serialized = [item.model_dump(mode="json") for item in data]
            
            # Set fresh cache with short TTL
            await redis_client.set_json(key, serialized, ttl=self.cache_ttl)
            
            # Set stale cache with long TTL (for fallback)
            stale_key = f"{key}:stale"
            await redis_client.set_json(stale_key, serialized, ttl=self.stale_ttl)
            
            logger.debug(f"Cached {len(data)} items at {key}")
            
        except Exception as e:
            logger.warning(f"Cache write error: {e}")
    
    async def invalidate(self, params: QueryT) -> bool:
        """Invalidate cache for specific query params."""
        cache_key = self._build_cache_key(params)
        try:
            await redis_client.delete(cache_key)
            await redis_client.delete(f"{cache_key}:stale")
            return True
        except Exception as e:
            logger.warning(f"Cache invalidation error: {e}")
            return False
    
    @property
    def provider_info(self) -> dict[str, Any]:
        """Get info about configured providers."""
        return {
            "primary": self.primary.get_provider_info(),
            "scraper": self.scraper.get_provider_info() if self.scraper else None,
            "cache_prefix": self.cache_prefix,
            "cache_ttl": self.cache_ttl,
        }
