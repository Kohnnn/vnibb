"""Tests for cache TTL resolution and centralized-constant consistency.

Two invariants are enforced:

1. ``resolve_cache_ttl`` precedence: explicit ``ttl`` > centralized
   ``REDIS_CACHE_TTLS[key_prefix]`` > ``settings.redis_cache_ttl``.
2. No ``@cached(...)`` site may pass an explicit ``ttl=`` that *diverges*
   from a centralized ``REDIS_CACHE_TTLS`` value for the same ``key_prefix``.
   This catches the ``market_indices`` bug class where an inline magic TTL
   silently overrode the intended shared constant.
"""

from __future__ import annotations

import ast
import asyncio
from pathlib import Path

import pytest

from vnibb.core import cache
from vnibb.core.cache import RedisClient, cached, resolve_cache_ttl
from vnibb.core.cache_constants import REDIS_CACHE_TTLS
from vnibb.core.config import settings

API_V1_DIR = Path(__file__).resolve().parents[2] / "vnibb" / "api" / "v1"


class TestResolveCacheTtl:
    def test_explicit_ttl_wins(self):
        assert resolve_cache_ttl(15, "market_indices") == 15

    def test_falls_back_to_centralized_constant(self):
        assert resolve_cache_ttl(None, "market_indices") == REDIS_CACHE_TTLS["market_indices"]

    def test_unknown_prefix_falls_back_to_settings_default(self):
        assert resolve_cache_ttl(None, "not_a_real_prefix") == settings.redis_cache_ttl


def _iter_cached_decorators():
    """Yield (file, lineno, ttl_value, key_prefix) for every @cached(...) call."""
    for path in sorted(API_V1_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
            if name != "cached":
                continue
            ttl_value = None
            key_prefix = None
            for kw in node.keywords:
                if kw.arg == "ttl" and isinstance(kw.value, ast.Constant):
                    ttl_value = kw.value.value
                elif kw.arg == "key_prefix" and isinstance(kw.value, ast.Constant):
                    key_prefix = kw.value.value
            yield path.name, node.lineno, ttl_value, key_prefix


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


def test_global_redis_client_uses_configured_connection_limit():
    assert cache.redis_client.max_connections == cache.settings.redis_max_connections


class TestCachedSiteConsistency:
    def test_no_explicit_ttl_diverges_from_centralized_constant(self):
        divergences = []
        for filename, lineno, ttl_value, key_prefix in _iter_cached_decorators():
            if key_prefix is None or ttl_value is None:
                continue
            centralized = REDIS_CACHE_TTLS.get(key_prefix)
            if centralized is not None and ttl_value != centralized:
                divergences.append(
                    f"{filename}:{lineno} @cached(ttl={ttl_value}, "
                    f"key_prefix={key_prefix!r}) diverges from "
                    f"REDIS_CACHE_TTLS[{key_prefix!r}]={centralized}"
                )
        assert not divergences, (
            "Explicit @cached ttl diverges from centralized REDIS_CACHE_TTLS. "
            "Drop the inline ttl= to inherit the shared constant, or update the "
            "constant:\n" + "\n".join(divergences)
        )

    def test_scan_found_cached_sites(self):
        # Guards against the AST walker silently matching nothing (e.g. after a
        # refactor renames the decorator) and giving false confidence.
        assert any(kp is not None for _, _, _, kp in _iter_cached_decorators())
