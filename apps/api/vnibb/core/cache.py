"""
Redis cache client and utilities.

Provides async Redis connection pool and common caching patterns
for VNIBB data providers and API responses.

This module also hosts the prediction-market estimation cache
(:data:`estimation_cache` / :func:`coerce_estimator_payload`) which keeps
the p95 of ``/estimate/*`` endpoints under 200 ms by avoiding DB / HTTP
round-trips when a result is fresh.
"""

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

from typing import Any, Awaitable, Callable, Optional, TypeVar, Union, Dict, List

import redis.asyncio as redis
from fastapi import HTTPException
from pydantic import BaseModel

from vnibb.core.config import settings
from vnibb.core.cache_constants import (
    REDIS_CACHE_TTLS as CACHE_TTLS,
    REDIS_CACHE_PREFIX_SHORT as CACHE_PREFIX_SHORT,
)

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R")

# In-memory fallback cache: {key: (data, expiry)}
_memory_cache: Dict[str, tuple[Any, datetime]] = {}
_memory_cache_lock = asyncio.Lock()
_warned_appwrite_cache_fallback = False


def _env_int(name: str, default: int, minimum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(minimum, int(raw))
    except ValueError:
        logger.warning("Invalid %s=%s. Falling back to %s", name, raw, default)
        return default


_MEMORY_CACHE_MAX_ENTRIES = _env_int("MEMORY_CACHE_MAX_ENTRIES", 500, 50)
_MEMORY_CACHE_MAX_ENTRY_BYTES = _env_int("MEMORY_CACHE_MAX_ENTRY_BYTES", 1_048_576, 4_096)


async def _prune_memory_cache_locked(now: datetime) -> None:
    expired_keys = [key for key, (_, expiry) in _memory_cache.items() if expiry <= now]
    for key in expired_keys:
        _memory_cache.pop(key, None)

    if len(_memory_cache) <= _MEMORY_CACHE_MAX_ENTRIES:
        return

    target_size = int(_MEMORY_CACHE_MAX_ENTRIES * 0.9)
    while len(_memory_cache) > target_size:
        oldest_key = next(iter(_memory_cache), None)
        if oldest_key is None:
            break
        _memory_cache.pop(oldest_key, None)


def _redis_cache_enabled() -> bool:
    """Determine whether Redis should be used for cache operations."""
    global _warned_appwrite_cache_fallback

    backend = settings.resolved_cache_backend

    if backend == "appwrite":
        if not _warned_appwrite_cache_fallback:
            logger.warning(
                "CACHE_BACKEND=appwrite configured but Appwrite cache adapter is not yet active; "
                "falling back to in-memory cache"
            )
            _warned_appwrite_cache_fallback = True
        return False

    return backend == "redis" and bool(settings.redis_url)


def _has_error_result(result: Any) -> bool:
    error = result.get("error") if isinstance(result, dict) else getattr(result, "error", None)
    return bool(error)


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

    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            if settings.environment == "test":
                return await func(*args, **kwargs)

            redis_enabled = _redis_cache_enabled()
            redis_available = redis_enabled and redis_client._client is not None

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
            async def get_mem_cache():
                now = datetime.now()
                async with _memory_cache_lock:
                    cached_entry = _memory_cache.get(cache_key)
                    if not cached_entry:
                        return None
                    data, expiry = cached_entry
                    if now < expiry:
                        return data
                    _memory_cache.pop(cache_key, None)
                    return None

            async def set_mem_cache(data):
                try:
                    payload_size = len(json.dumps(data, default=str))
                except (TypeError, ValueError):
                    payload_size = 0

                if payload_size > _MEMORY_CACHE_MAX_ENTRY_BYTES:
                    logger.debug(
                        "Skipping in-memory cache for %s (%s bytes > %s bytes)",
                        func.__name__,
                        payload_size,
                        _MEMORY_CACHE_MAX_ENTRY_BYTES,
                    )
                    return

                expiry = datetime.now() + timedelta(seconds=effective_ttl)
                async with _memory_cache_lock:
                    _memory_cache.pop(cache_key, None)
                    _memory_cache[cache_key] = (data, expiry)
                    await _prune_memory_cache_locked(datetime.now())

            try:
                if redis_available:
                    try:
                        cached_data = await redis_client.get_json(cache_key)
                        if cached_data is not None:
                            logger.info(f"Cache HIT (Redis) for {func.__name__}: {cache_key}")
                            return cached_data
                    except Exception as redis_err:
                        redis_available = False
                        logger.warning(f"Redis error, falling back to memory: {redis_err}")

                if not redis_available:
                    mem_data = await get_mem_cache()
                    if mem_data is not None:
                        logger.info(f"Cache HIT (Memory) for {func.__name__}: {cache_key}")
                        return mem_data

                logger.info(f"Cache MISS for {func.__name__}: {cache_key}")
                result = await func(*args, **kwargs)
                if _has_error_result(result):
                    return result

                stored_in_redis = False
                if redis_available:
                    try:
                        stored_in_redis = await redis_client.set_json(
                            cache_key, result, ttl=effective_ttl
                        )
                    except Exception as redis_err:
                        logger.warning(f"Failed to set Redis cache: {redis_err}")
                        stored_in_redis = False

                if not stored_in_redis:
                    await set_mem_cache(result)

                return result
            except HTTPException:
                raise
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
        if (
            not _redis_cache_enabled()
            and settings.rate_limit_mode == "off"
            and not settings.scheduler_lock_enabled
        ):
            return

        if not self.url:
            logger.warning("Redis URL is empty; skipping Redis connection")
            return

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
        except (redis.RedisError, RuntimeError) as e:
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
        except (redis.RedisError, RuntimeError) as e:
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
        except (redis.RedisError, RuntimeError) as e:
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
        except (redis.RedisError, RuntimeError) as e:
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
        except (redis.RedisError, RuntimeError) as e:
            logger.warning(f"Redis DELETE error for key {key}: {e}")
            return False

    async def exists(self, key: str) -> bool:
        """Check if key exists in cache."""
        try:
            return bool(await self.client.exists(key))
        except (redis.RedisError, RuntimeError):
            return False

    async def flush_prefix(self, prefix: str) -> int:
        """Delete all keys matching a prefix pattern."""
        if not _redis_cache_enabled():
            return 0

        try:
            if not self._client:
                await self.connect()
            keys = []
            async for key in self.client.scan_iter(f"{prefix}*"):
                keys.append(key)
            if keys:
                return await self.client.delete(*keys)
            return 0
        except (redis.RedisError, RuntimeError) as e:
            logger.warning(f"Redis FLUSH error for prefix {prefix}: {e}")
            return 0

    async def clear_all(self) -> bool:
        """Clear all keys in the current database."""
        if not _redis_cache_enabled():
            return True

        try:
            await self.client.flushdb()
            return True
        except (redis.RedisError, RuntimeError):
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


# ---------------------------------------------------------------------------
# Prediction-market estimation cache
# ---------------------------------------------------------------------------
#
# Keeps the p95 of ``/estimate/*`` endpoints under 200 ms by avoiding the DB /
# HTTP round-trips when the result is fresh. Keys are pure string identifiers
# (``prediction-markets:estimate:cpi`` etc.); values are arbitrary
# JSON-serialisable dicts.
#
# Two backends are supported:
#   * In-process :class:`TtlCache` (the default). Fast, single-worker.
#   * Redis-backed when ``CACHE_BACKEND=redis`` and ``REDIS_URL`` is set. This
#     keeps the per-worker 600s stale window consistent across uvicorn workers
#     on the OCI host.


@dataclass(slots=True)
class CacheEntry:
    value: Any
    expires_at: float


class TtlCache:
    def __init__(self, default_ttl: float = 600.0) -> None:
        self._default_ttl = default_ttl
        self._store: dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()

    async def get_or_set(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        ttl: float | None = None,
    ) -> Any:
        now = time.monotonic()
        existing = self._store.get(key)
        if existing is not None and existing.expires_at > now:
            return existing.value
        async with self._lock:
            existing = self._store.get(key)
            if existing is not None and existing.expires_at > time.monotonic():
                return existing.value
            value = await loader()
            self._store[key] = CacheEntry(
                value=value,
                expires_at=time.monotonic() + (ttl or self._default_ttl),
            )
            return value

    def invalidate(self, key: str) -> None:
        self._store.pop(key, None)


def _use_redis_backend() -> bool:
    return (
        os.getenv("CACHE_BACKEND", "").lower() == "redis"
        and bool(os.getenv("REDIS_URL"))
    )


class _RedisTtlCache:
    """Thin async Redis adapter; falls back to :class:`TtlCache` if unavailable."""

    def __init__(self, redis_url: str, default_ttl: float) -> None:
        self._url = redis_url
        self._default_ttl = default_ttl
        self._client = None
        self._fallback = TtlCache(default_ttl=default_ttl)

    async def _ensure_client(self):
        if self._client is not None:
            return self._client
        try:
            from redis.asyncio import from_url  # type: ignore[import-not-found]

            self._client = from_url(self._url, encoding="utf-8", decode_responses=True)
            await self._client.ping()
        except Exception as exc:
            logger.warning(
                "Redis cache unavailable (%s); falling back to in-process", exc
            )
            self._client = None
        return self._client

    async def get_or_set(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        ttl: float | None = None,
    ) -> Any:
        client = await self._ensure_client()
        if client is None:
            return await self._fallback.get_or_set(key, loader, ttl=ttl)
        ttl_seconds = int(ttl or self._default_ttl)
        try:
            cached = await client.get(key)
            if cached is not None:
                return json.loads(cached)
        except Exception as exc:
            logger.warning("Redis GET failed for %s: %s; refilling", key, exc)
        value = await loader()
        try:
            await client.set(key, json.dumps(value), ex=ttl_seconds)
        except Exception as exc:
            logger.warning("Redis SET failed for %s: %s", key, exc)
        return value

    def invalidate(self, key: str) -> None:
        self._fallback.invalidate(key)
        if self._client is not None:
            try:
                # Best-effort; fire-and-forget.
                asyncio.create_task(self._client.delete(key))
            except Exception:
                pass


def _build_default_cache() -> TtlCache | _RedisTtlCache:
    if _use_redis_backend():
        return _RedisTtlCache(
            redis_url=os.getenv("REDIS_URL", ""), default_ttl=600.0
        )
    return TtlCache(default_ttl=600.0)


estimation_cache = _build_default_cache()


def coerce_estimator_payload(payload: Any) -> dict[str, Any]:
    """Best-effort coercion for estimator payloads.

    Estimator outputs get new fields over time (e.g. Phase 8 adds
    ``confidence``). When the cache returns a payload from an older worker
    that hasn't picked up the new schema yet, callers can call this to
    ensure the response shape stays stable.
    """
    if not isinstance(payload, dict):
        return {}
    coerced = dict(payload)
    coerced.setdefault("last_updated", None)
    coerced.setdefault("confidence", 0.0)
    coerced.setdefault("schema_version", 8)
    # Percentile fields must always be present so downstream widgets and the
    # `/estimate/*` response models never KeyError on a stale-schema cache hit.
    for _pctl in ("p10", "p25", "p50", "p75", "p90"):
        coerced.setdefault(_pctl, None)
    return coerced
