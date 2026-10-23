"""Behavioral tests for cache TTLs, batch writes and loader lifetimes."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from vnibb.core import cache
from vnibb.core.cache import RedisClient, cached, resolve_cache_ttl
from vnibb.core.cache_constants import REDIS_CACHE_TTLS
from vnibb.core.config import settings



class TestResolveCacheTtl:
    def test_explicit_ttl_wins(self):
        assert resolve_cache_ttl(15, "market_indices") == 15

    def test_falls_back_to_centralized_constant(self):
        assert resolve_cache_ttl(None, "market_indices") == REDIS_CACHE_TTLS["market_indices"]

    def test_unknown_prefix_falls_back_to_settings_default(self):
        assert resolve_cache_ttl(None, "not_a_real_prefix") == settings.redis_cache_ttl




@pytest.mark.asyncio
async def test_cached_singleflight_shares_one_loader_call(monkeypatch):
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)
    cache._memory_cache.clear()
    cache._inflight_cache_loads.clear()
    calls = 0
    started = asyncio.Event()
    release = asyncio.Event()

    @cached(key_prefix="quote")
    async def load(symbol):
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return {"symbol": symbol}

    first = asyncio.create_task(load("VNM"))
    await started.wait()
    second = asyncio.create_task(load("VNM"))
    await asyncio.sleep(0)
    release.set()

    assert await asyncio.gather(first, second) == [{"symbol": "VNM"}, {"symbol": "VNM"}]
    assert calls == 1
    assert not cache._inflight_cache_loads


@pytest.mark.asyncio
async def test_cached_singleflight_shares_loader_failure(monkeypatch):
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)
    cache._memory_cache.clear()
    cache._inflight_cache_loads.clear()
    calls = 0
    started = asyncio.Event()
    release = asyncio.Event()

    @cached(key_prefix="quote")
    async def load(symbol):
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        raise ValueError(symbol)

    first = asyncio.create_task(load("VNM"))
    await started.wait()
    second = asyncio.create_task(load("VNM"))
    await asyncio.sleep(0)
    release.set()

    results = await asyncio.gather(first, second, return_exceptions=True)
    assert all(isinstance(result, ValueError) and str(result) == "VNM" for result in results)
    assert calls == 1
    assert not cache._inflight_cache_loads


@pytest.mark.asyncio
async def test_cached_singleflight_survives_cancelled_creator(monkeypatch):
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)
    cache._memory_cache.clear()
    cache._inflight_cache_loads.clear()
    calls = 0
    started = asyncio.Event()
    release = asyncio.Event()

    @cached(key_prefix="quote")
    async def load(symbol):
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return {"symbol": symbol}

    creator = asyncio.create_task(load("VNM"))
    await started.wait()
    waiter = asyncio.create_task(load("VNM"))
    await asyncio.sleep(0)
    creator.cancel()
    with pytest.raises(asyncio.CancelledError):
        await creator

    release.set()
    assert await waiter == {"symbol": "VNM"}
    await asyncio.sleep(0)
    assert calls == 1
    assert not cache._inflight_cache_loads


@pytest.mark.asyncio
async def test_cached_error_result_is_not_cached(monkeypatch):
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)
    cache._memory_cache.clear()
    calls = 0

    @cached(key_prefix="quote")
    async def load(symbol):
        nonlocal calls
        calls += 1
        return {"symbol": symbol, "error": "upstream"}

    assert await load("VNM") == {"symbol": "VNM", "error": "upstream"}
    assert await load("VNM") == {"symbol": "VNM", "error": "upstream"}
    assert calls == 2


@pytest.mark.asyncio
async def test_cached_reuses_memory_when_connected_redis_get_and_set_fail(monkeypatch):
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache.settings, "cache_backend", "redis")
    monkeypatch.setattr(cache.settings, "redis_url", "redis://localhost:6379/0")
    monkeypatch.setattr(cache, "_memory_cache", {})
    monkeypatch.setattr(cache, "_inflight_cache_loads", {})
    redis_connection = MagicMock()
    redis_connection.get = AsyncMock(side_effect=cache.redis.ConnectionError("GET unavailable"))
    redis_connection.setex = AsyncMock(side_effect=cache.redis.ConnectionError("SET unavailable"))
    redis_client = RedisClient()
    redis_client._client = redis_connection
    monkeypatch.setattr(cache, "redis_client", redis_client)
    now = datetime(2026, 10, 23, 12)

    class Clock:
        @staticmethod
        def now():
            return now

    monkeypatch.setattr(cache, "datetime", Clock)
    calls = 0

    @cached(ttl=10, key_prefix="quote")
    async def load(symbol):
        nonlocal calls
        calls += 1
        return {"symbol": symbol, "price": 100 + calls}

    assert await load("VNM") == {"symbol": "VNM", "price": 101}
    assert await load("VNM") == {"symbol": "VNM", "price": 101}
    assert calls == 1
    assert redis_connection.setex.await_count == 1

    now += timedelta(seconds=10)
    assert await load("VNM") == {"symbol": "VNM", "price": 102}
    assert calls == 2

    redis_connection.get.side_effect = None
    redis_connection.get.return_value = '{"symbol": "VNM", "price": 103}'
    assert await load("VNM") == {"symbol": "VNM", "price": 103}
    assert calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("loader_error", ["response", "exception"])
async def test_cached_does_not_cache_loader_errors_when_connected_redis_fails(
    monkeypatch, loader_error
):
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache.settings, "cache_backend", "redis")
    monkeypatch.setattr(cache.settings, "redis_url", "redis://localhost:6379/0")
    monkeypatch.setattr(cache, "_memory_cache", {})
    monkeypatch.setattr(cache, "_inflight_cache_loads", {})
    redis_connection = MagicMock()
    redis_connection.get = AsyncMock(side_effect=cache.redis.ConnectionError("GET unavailable"))
    redis_connection.setex = AsyncMock(side_effect=cache.redis.ConnectionError("SET unavailable"))
    redis_client = RedisClient()
    redis_client._client = redis_connection
    monkeypatch.setattr(cache, "redis_client", redis_client)
    calls = 0

    @cached(ttl=10, key_prefix="quote")
    async def load(symbol):
        nonlocal calls
        calls += 1
        if loader_error == "exception":
            raise ValueError("upstream unavailable")
        return {"symbol": symbol, "error": "upstream unavailable"}

    for _ in range(2):
        if loader_error == "exception":
            with pytest.raises(ValueError, match="upstream unavailable"):
                await load("VNM")
        else:
            assert await load("VNM") == {"symbol": "VNM", "error": "upstream unavailable"}

    assert calls == 2
    redis_connection.setex.assert_not_awaited()


@pytest.mark.asyncio
async def test_flush_prefix_deletes_scan_batches(monkeypatch):
    class Client:
        def __init__(self):
            self.deleted = []

        async def scan_iter(self, pattern, count):
            assert pattern == "v:q:*"
            assert count == 2
            for key in ("v:q:1", "v:q:2", "v:q:3", "v:q:4", "v:q:5"):
                yield key

        async def delete(self, *keys):
            self.deleted.append(keys)
            return len(keys)

    client = Client()
    redis_client = RedisClient(url="redis://example", max_connections=7)
    redis_client._client = client
    redis_client.SCAN_BATCH_SIZE = 2
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: True)

    assert await redis_client.flush_prefix("v:q:") == 5
    assert client.deleted == [("v:q:1", "v:q:2"), ("v:q:3", "v:q:4"), ("v:q:5",)]


@pytest.mark.asyncio
async def test_set_multiple_interrupted_before_execution_preserves_existing_values_and_ttls():
    stored = {"quote:VNM": ('{"price": 100}', 30)}

    async def mset(values):
        stored.update({key: (value, None) for key, value in values.items()})

    client = MagicMock()
    client.mset = AsyncMock(side_effect=mset)
    client.expire = AsyncMock(side_effect=cache.redis.ConnectionError("disconnected"))
    pipeline = client.pipeline.return_value.__aenter__.return_value
    pipeline.set = MagicMock()
    pipeline.delete = MagicMock()
    pipeline.execute = AsyncMock(side_effect=cache.redis.ConnectionError("not sent"))
    redis_client = RedisClient(url="redis://example")
    redis_client._client = client

    assert not await redis_client.set_multiple({"quote:VNM": {"price": 200}}, ttl=60)
    assert stored == {"quote:VNM": ('{"price": 100}', 30)}


@pytest.mark.asyncio
@pytest.mark.parametrize("positional", [False, True])
async def test_cached_session_loader_stops_before_request_session_closes(monkeypatch, positional):
    from sqlalchemy.ext.asyncio import AsyncSession
    from vnibb.core import database

    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)
    cache._memory_cache.clear()
    cache._inflight_cache_loads.clear()
    started = asyncio.Event()
    stopped = asyncio.Event()
    session = AsyncSession()
    monkeypatch.setattr(database, "async_session_factory", lambda: session)

    @cached(key_prefix="request_session_lifetime")
    async def load(db):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    async def request():
        async with database.get_db_context() as db:
            if positional:
                await load(db)
            else:
                await load(db=db)

    caller = asyncio.create_task(request())
    await started.wait()
    caller.cancel()
    try:
        with pytest.raises(asyncio.CancelledError):
            await caller
        assert stopped.is_set(), "Loader outlived its request-owned database session"
    finally:
        tasks = list(cache._inflight_cache_loads.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


