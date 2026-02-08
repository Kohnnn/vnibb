"""
Redis cache client and utilities.

Provides async Redis connection pool and common caching patterns
for VNIBB data providers and API responses.
"""

import json
import logging
import asyncio
from datetime import datetime, timedelta

from typing import Any, Optional, TypeVar, Union, Dict, List

import redis.asyncio as redis
from pydantic import BaseModel

from vnibb.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R")

CACHE_TTLS: Dict[str, int] = {
    "screener": 3600,
    "quote": 60,
    "ratios": 86400,
    "ratios_history": 86400,
    "financials": 86400,
    "income_statement": 86400,
    "balance_sheet": 86400,
    "cash_flow": 86400,
    "news": 1800,
    "company_news_v26": 1800,
    "company_events_v26": 1800,
    "profile": 604800,
}

CACHE_PREFIX_SHORT = {
    "screener": "sc",
    "quote": "q",
    "ratios": "r",
    "ratios_history": "rh",
    "financials": "f",
    "income_statement": "is",
    "balance_sheet": "bs",
    "cash_flow": "cf",
    "news": "n",
    "company_news_v26": "cn",
    "company_events_v26": "ce",
    "profile": "p",
}

# In-memory fallback cache: {key: (data, expiry)}
_memory_cache: Dict[str, tuple[Any, datetime]] = {}
_memory_cache_lock = asyncio.Lock()


def cached(
    ttl: Optional[int] = None,
    key_prefix: str = "cache",
    exclude_args: Optional[List[int]] = None,
    exclude_kwargs: Optional[List[str]] = None,
):
    """
    Decorator for caching async function results in Redis.

    Args:
        ttl: Time to live in seconds (defaults to settings.redis_cache_ttl)
        key_prefix: Prefix for the cache key
        exclude_args: List of argument indices to exclude from cache key
        exclude_kwargs: List of keyword argument names to exclude from cache key
    """
    import functools
    import hashlib
    import inspect

    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Check if redis is enabled
            if not settings.redis_url:
                return await func(*args, **kwargs)

            effective_ttl = (
                ttl if ttl is not None else CACHE_TTLS.get(key_prefix, settings.redis_cache_ttl)
            )

            # Build cache key
            key_parts = [key_prefix]

            # Filter args
            filtered_args = []
            for i, arg in enumerate(args):
                if exclude_args and i in exclude_args:
                    continue
                # Skip the first arg if it's 'self' or 'cls' (instance methods)
                # But here we don't know for sure, so we include it unless excluded
                # Except if it's Request, Response, BackgroundTasks etc (FastAPI deps)
                from fastapi import Request, Response, BackgroundTasks

                if isinstance(arg, (Request, Response, BackgroundTasks)):
                    continue
                filtered_args.append(arg)

            key_parts.extend([str(a) for a in filtered_args])

            # Filter kwargs
            filtered_kwargs = {}
            for k, v in sorted(kwargs.items()):
                if exclude_kwargs and k in exclude_kwargs:
                    continue
                # Skip FastAPI dependencies
                from fastapi import Request, Response, BackgroundTasks
                from sqlalchemy.orm import Session
                from sqlalchemy.ext.asyncio import AsyncSession

                if isinstance(v, (Request, Response, BackgroundTasks, Session, AsyncSession)):
                    continue
                if k in ("db", "request", "background_tasks"):
                    continue
                filtered_kwargs[k] = v

            if filtered_kwargs:
                key_parts.append(str(filtered_kwargs))

            # Generate stable hash to avoid key length issues
            key_string = ":".join(key_parts)
            short_prefix = CACHE_PREFIX_SHORT.get(key_prefix, key_prefix[:2])
            cache_key = f"v:{short_prefix}:{hashlib.md5(key_string.encode()).hexdigest()}"

            # Helper for memory fallback
            def get_mem_cache():
                if cache_key in _memory_cache:
                    data, expiry = _memory_cache[cache_key]
                    if datetime.now() < expiry:
                        return data
                return None

            def set_mem_cache(data):
                expiry = datetime.now() + timedelta(seconds=effective_ttl)
                _memory_cache[cache_key] = (data, expiry)

            try:
                # Try Redis first
                if settings.redis_url:
                    try:
                        cached_data = await redis_client.get_json(cache_key)
                        if cached_data is not None:
                            logger.info(f"Cache HIT (Redis) for {func.__name__}: {cache_key}")
                            return cached_data
                    except Exception as redis_err:
                        logger.warning(f"Redis error, falling back to memory: {redis_err}")

                # Check memory fallback
                mem_data = get_mem_cache()
                if mem_data is not None:
                    logger.info(f"Cache HIT (Memory) for {func.__name__}: {cache_key}")
                    return mem_data

                # Cache miss
                logger.info(f"Cache MISS for {func.__name__}: {cache_key}")
                result = await func(*args, **kwargs)

                # Store in Redis
                if settings.redis_url:
                    try:
                        await redis_client.set_json(cache_key, result, ttl=effective_ttl)
                    except Exception as redis_err:
                        logger.warning(f"Failed to set Redis cache: {redis_err}")

                # Store in memory anyway as second layer
                set_mem_cache(result)

                return result
            except Exception as e:
                logger.warning(f"Caching logic error for {func.__name__}: {e}")
                return await func(*args, **kwargs)

        return wrapper

    return decorator


class RedisClient:
    """
    Async Redis client wrapper with JSON serialization support.

    Handles connection pooling and provides typed get/set operations
    for Pydantic models.
    """

    def __init__(self, url: str = settings.redis_url, max_connections: int = 10):
        self.url = url
        self.max_connections = max_connections
        self._pool: Optional[redis.ConnectionPool] = None
        self._client: Optional[redis.Redis] = None

    async def connect(self) -> None:
        """Initialize Redis connection pool."""
        if self._pool is None:
            self._pool = redis.ConnectionPool.from_url(
                self.url,
                max_connections=self.max_connections,
                decode_responses=True,
            )
            self._client = redis.Redis(connection_pool=self._pool)
            # Test connection
            await self._client.ping()
            logger.info("Redis connection established")

    async def disconnect(self) -> None:
        """Close Redis connection pool."""
        if self._client:
            await self._client.close()
            self._client = None
        if self._pool:
            await self._pool.disconnect()
            self._pool = None
            logger.info("Redis connection closed")

    @property
    def client(self) -> redis.Redis:
        """Get Redis client, raise if not connected."""
        if self._client is None:
            raise RuntimeError("Redis client not initialized. Call connect() first.")
        return self._client

    async def get(self, key: str) -> Optional[str]:
        """Get raw string value from cache."""
        try:
            return await self.client.get(key)
        except redis.RedisError as e:
            logger.warning(f"Redis GET error for key {key}: {e}")
            return None

    async def set(
        self,
        key: str,
        value: str,
        ttl: Optional[int] = None,
    ) -> bool:
        """Set raw string value with optional TTL."""
        try:
            ttl = ttl or settings.redis_cache_ttl
            await self.client.setex(key, ttl, value)
            return True
        except redis.RedisError as e:
            logger.warning(f"Redis SET error for key {key}: {e}")
            return False

    async def get_json(self, key: str) -> Optional[Any]:
        """Get JSON-deserialized value from cache."""
        raw = await self.get(key)
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON in cache for key {key}")
        return None

    async def get_multiple(self, keys: List[str]) -> Dict[str, Optional[Any]]:
        """Batch get JSON values from cache."""
        if not keys:
            return {}
        try:
            raw_values = await self.client.mget(keys)
            results: Dict[str, Optional[Any]] = {}
            for key, raw in zip(keys, raw_values):
                if raw is None:
                    results[key] = None
                    continue
                try:
                    results[key] = json.loads(raw)
                except json.JSONDecodeError:
                    results[key] = None
            return results
        except redis.RedisError as e:
            logger.warning(f"Redis MGET error: {e}")
            return {key: None for key in keys}

    async def set_json(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
    ) -> bool:
        """Set JSON-serialized value with optional TTL."""
        try:
            # Handle Pydantic models
            if isinstance(value, BaseModel):
                value = value.model_dump(mode="json")
            elif isinstance(value, list) and value and isinstance(value[0], BaseModel):
                value = [v.model_dump(mode="json") for v in value]

            def custom_serializer(obj):
                if isinstance(obj, BaseModel):
                    return obj.model_dump(mode="json")
                return str(obj)

            serialized = json.dumps(value, default=custom_serializer)
            success = await self.set(key, serialized, ttl)
            if success:
                logger.info(f"Successfully stored {len(serialized)} bytes in cache for key {key}")
            else:
                logger.warning(f"Failed to store data in cache for key {key}")
            return success
        except (TypeError, ValueError) as e:
            logger.warning(f"JSON serialization error for key {key}: {e}")
            return False

    async def set_multiple(self, values: Dict[str, Any], ttl: Optional[int] = None) -> bool:
        """Batch set JSON values with optional TTL."""
        if not values:
            return True
        ttl_value = ttl or settings.redis_cache_ttl
        try:
            serialized: Dict[str, str] = {}
            for key, value in values.items():
                if isinstance(value, BaseModel):
                    value = value.model_dump(mode="json")
                serialized[key] = json.dumps(value, default=str)
            await self.client.mset(serialized)
            if ttl_value:
                for key in values.keys():
                    await self.client.expire(key, ttl_value)
            return True
        except redis.RedisError as e:
            logger.warning(f"Redis MSET error: {e}")
            return False

    async def get_model(self, key: str, model_class: type[T]) -> Optional[T]:
        """Get Pydantic model from cache."""
        data = await self.get_json(key)
        if data:
            try:
                return model_class.model_validate(data)
            except Exception as e:
                logger.warning(f"Model validation error for key {key}: {e}")
        return None

    async def set_model(
        self,
        key: str,
        model: BaseModel,
        ttl: Optional[int] = None,
    ) -> bool:
        """Set Pydantic model in cache."""
        return await self.set_json(key, model.model_dump(mode="json"), ttl)

    async def delete(self, key: str) -> bool:
        """Delete a key from cache."""
        try:
            await self.client.delete(key)
            return True
        except redis.RedisError as e:
            logger.warning(f"Redis DELETE error for key {key}: {e}")
            return False

    async def exists(self, key: str) -> bool:
        """Check if key exists in cache."""
        try:
            return bool(await self.client.exists(key))
        except redis.RedisError:
            return False

    async def flush_prefix(self, prefix: str) -> int:
        """Delete all keys matching a prefix pattern."""
        try:
            if not self._client:
                await self.connect()
            keys = []
            async for key in self.client.scan_iter(f"{prefix}*"):
                keys.append(key)
            if keys:
                return await self.client.delete(*keys)
            return 0
        except redis.RedisError as e:
            logger.warning(f"Redis FLUSH error for prefix {prefix}: {e}")
            return 0

    async def clear_all(self) -> bool:
        """Clear all keys in the current database."""
        try:
            await self.client.flushdb()
            return True
        except redis.RedisError:
            return False


# Global Redis client instance
redis_client = RedisClient()


def build_cache_key(*parts: Union[str, int]) -> str:
    """
    Build a namespaced cache key from parts.

    Example:
        build_cache_key("vnibb", "equity", "VNM", "historical")
        => "vnibb:equity:VNM:historical"
    """
    return ":".join(str(p) for p in parts)
