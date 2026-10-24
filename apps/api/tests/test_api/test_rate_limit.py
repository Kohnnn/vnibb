import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from httpx import ASGITransport, AsyncClient

from vnibb.core import cache
from vnibb.middleware.rate_limit import RateLimitMiddleware


class FakeRedis:
    def __init__(self):
        self.entries = {}

    async def eval(self, _script, _keys, key, window):
        entry = self.entries.get(key)
        if entry is None or entry[1] <= 0:
            entry = [0, int(window)]
            self.entries[key] = entry
        entry[0] += 1
        return entry

    def expire(self, key):
        self.entries[key][1] = 0


class FailingRedis:
    async def eval(self, *_args):
        raise RuntimeError("redis unavailable")


def build_request(path="/api/v1/market", method="GET", headers=None):
    return Request(
        {
            "type": "http",
            "headers": headers or [],
            "client": ("198.51.100.1", 12345),
            "method": method,
            "path": path,
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
        }
    )


async def call_next(_request):
    return Response(status_code=204)


@pytest.fixture
def rate_limit_settings(monkeypatch):
    monkeypatch.setattr("vnibb.middleware.rate_limit.settings.rate_limit_mode", "enforce")
    monkeypatch.setattr("vnibb.middleware.rate_limit.settings.rate_limit_window_seconds", 60)
    monkeypatch.setattr("vnibb.middleware.rate_limit.settings.rate_limit_key_prefix", "test:rate")
    monkeypatch.setattr("vnibb.middleware.rate_limit.settings.rate_limit_key_version", "v1")


@pytest.mark.asyncio
async def test_enforces_threshold_and_retry_after(rate_limit_settings):
    middleware = RateLimitMiddleware(SimpleNamespace(), redis=FakeRedis(), requests_per_minute=2)

    assert (await middleware.dispatch(build_request(), call_next)).status_code == 204
    assert (await middleware.dispatch(build_request(), call_next)).status_code == 204
    response = await middleware.dispatch(build_request(), call_next)

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"
    assert response.headers["X-RateLimit-Limit"] == "2"


@pytest.mark.asyncio
async def test_exempts_health_and_preflight_requests(rate_limit_settings):
    redis = FakeRedis()
    middleware = RateLimitMiddleware(SimpleNamespace(), redis=redis, requests_per_minute=1)

    assert (await middleware.dispatch(build_request("/health"), call_next)).status_code == 204
    assert (await middleware.dispatch(build_request("/metrics"), call_next)).status_code == 204
    assert (await middleware.dispatch(build_request(method="OPTIONS"), call_next)).status_code == 204
    assert redis.entries == {}


@pytest.mark.asyncio
async def test_enforced_429_preserves_cors_headers(rate_limit_settings):
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, redis=FakeRedis(), requests_per_minute=1)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://client.example"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/market")
    async def market():
        return {"ok": True}

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "https://client.example"}
    ) as client:
        assert (await client.get("/api/v1/market")).status_code == 200
        response = await client.get("/api/v1/market")

    assert response.status_code == 429
    assert response.headers["access-control-allow-origin"] == "https://client.example"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "origin,allowed",
    [
        ("https://web.vnibb.xyz", True),
        ("https://vnibb-web.vercel.app", True),
        ("https://vnibb.vercel.app", True),
        ("https://unrelated.example", False),
    ],
)
async def test_release_cors_policy_reaches_normal_error_and_preflight(origin, allowed, rate_limit_settings):
    from vnibb.api.main import CORSErrorMiddleware
    from vnibb.core.config import Settings

    policy = Settings(_env_file=None)
    app = FastAPI()
    app.add_middleware(CORSErrorMiddleware)
    app.add_middleware(RateLimitMiddleware, redis=FakeRedis(), requests_per_minute=1)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=policy.cors_origins,
        allow_origin_regex=policy.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/market")
    async def market():
        return {"ok": True}

    @app.get("/health/validation")
    async def validation(limit: int):
        return {"limit": limit}

    @app.get("/health/error")
    async def error():
        raise RuntimeError("controlled provider failure")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": origin}
    ) as client:
        responses = [
            (await client.get("/api/v1/market"), 200),
            (await client.get("/api/v1/market"), 429),
            (await client.get("/health/validation?limit=invalid"), 422),
            (await client.get("/health/error"), 500),
            (await client.options("/api/v1/market", headers={
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "X-VNIBB-Client-ID,Authorization",
            }), 200 if allowed else 400),
        ]
    for response, expected_status in responses:
        assert response.status_code == expected_status
        if allowed:
            assert response.headers["access-control-allow-origin"] == origin
            assert response.headers["access-control-allow-credentials"] == "true"
            assert "origin" in response.headers["vary"].lower()
        else:
            assert "access-control-allow-origin" not in response.headers


@pytest.mark.asyncio
async def test_instances_share_redis_quota(rate_limit_settings):
    redis = FakeRedis()
    first = RateLimitMiddleware(SimpleNamespace(), redis=redis, requests_per_minute=1)
    second = RateLimitMiddleware(SimpleNamespace(), redis=redis, requests_per_minute=1)

    assert (await first.dispatch(build_request(), call_next)).status_code == 204
    assert (await second.dispatch(build_request(), call_next)).status_code == 429


@pytest.mark.asyncio
async def test_expired_key_resets_quota(rate_limit_settings):
    redis = FakeRedis()
    middleware = RateLimitMiddleware(SimpleNamespace(), redis=redis, requests_per_minute=1)

    assert (await middleware.dispatch(build_request(), call_next)).status_code == 204
    redis.expire(next(iter(redis.entries)))
    assert (await middleware.dispatch(build_request(), call_next)).status_code == 204


@pytest.mark.asyncio
async def test_shadow_mode_observes_without_blocking(rate_limit_settings, monkeypatch):
    monkeypatch.setattr("vnibb.middleware.rate_limit.settings.rate_limit_mode", "shadow")
    middleware = RateLimitMiddleware(SimpleNamespace(), redis=FakeRedis(), requests_per_minute=1)

    assert (await middleware.dispatch(build_request(), call_next)).status_code == 204
    response = await middleware.dispatch(build_request(), call_next)

    assert response.status_code == 204
    assert response.headers["X-RateLimit-Status"] == "shadow-exceeded"


@pytest.mark.asyncio
async def test_redis_outage_fails_open_with_safe_status_header(rate_limit_settings):
    middleware = RateLimitMiddleware(SimpleNamespace(), redis=FailingRedis(), requests_per_minute=1)

    response = await middleware.dispatch(build_request(), call_next)

    assert response.status_code == 204
    assert response.headers["X-RateLimit-Status"] == "unavailable"


@pytest.fixture
def pooled_redis(monkeypatch, rate_limit_settings):
    state = SimpleNamespace(
        release=asyncio.Event(),
        entered=asyncio.Queue(),
        ping_release=asyncio.Event(),
        ping_entered=asyncio.Event(),
        ping_error=None,
        pings=0,
        disconnected=0,
        counts={},
    )
    state.ping_release.set()

    class Transport(cache.redis.Connection):
        async def connect(self):
            pass

        async def can_read(self):
            return False

        async def can_read_destructive(self):
            return False

        async def disconnect(self, *args, **kwargs):
            state.disconnected += 1

        async def send_command(self, *args, **kwargs):
            self.command = args

        async def read_response(self, **kwargs):
            command, *args = self.command
            if command == "PING":
                state.pings += 1
                state.ping_entered.set()
                await state.ping_release.wait()
                if state.ping_error:
                    raise state.ping_error
                return "PONG"
            if command == "GET":
                if args[0] == "held":
                    state.entered.put_nowait(args[0])
                    await state.release.wait()
                return "cached"
            if command == "EVAL":
                key, window = args[2:]
                state.counts[key] = state.counts.get(key, 0) + 1
                return [state.counts[key], int(window)]
            raise AssertionError(f"Unexpected command: {command}")

    from_url = cache.redis.ConnectionPool.from_url.__func__

    def transport_pool(cls, url, **kwargs):
        return from_url(cls, url, connection_class=Transport, **kwargs)

    monkeypatch.setattr(cache.redis.ConnectionPool, "from_url", classmethod(transport_pool))
    wrapper = cache.RedisClient(url="redis://localhost", max_connections=2)
    monkeypatch.setattr(cache, "redis_client", wrapper)
    monkeypatch.setattr("vnibb.middleware.rate_limit.redis_client", wrapper)
    middleware = RateLimitMiddleware(SimpleNamespace(), requests_per_minute=100)
    return wrapper, middleware, state


@pytest.mark.asyncio
async def test_cache_burst_shares_pool_with_rate_limit_without_unavailable(pooled_redis):
    wrapper, middleware, state = pooled_redis
    await wrapper.connect()
    holders = [asyncio.create_task(wrapper.get("held")) for _ in range(2)]
    pending = []
    try:
        for _ in holders:
            await asyncio.wait_for(state.entered.get(), 1)
        pending = [asyncio.create_task(middleware.dispatch(build_request(), call_next)) for _ in range(5)]
        reads = [asyncio.create_task(wrapper.get("quote")) for _ in range(5)]
        pending.extend(reads)
        await asyncio.sleep(0)
        assert not any(task.done() for task in pending)
        state.release.set()
        results = await asyncio.wait_for(asyncio.gather(*pending), 2)
        assert all(response.headers["X-RateLimit-Status"] == "enforced" for response in results[:5])
        assert results[5:] == ["cached"] * 5
        assert await asyncio.gather(*holders) == ["cached", "cached"]
    finally:
        state.release.set()
        await asyncio.gather(*holders, *pending, return_exceptions=True)
        await wrapper.disconnect()


@pytest.mark.asyncio
async def test_shared_redis_admission_wait_is_bounded(pooled_redis):
    wrapper, middleware, state = pooled_redis
    wrapper.max_connections = 1
    await wrapper.connect()
    holder = asyncio.create_task(wrapper.get("held"))
    try:
        await asyncio.wait_for(state.entered.get(), 1)
        started = asyncio.get_running_loop().time()
        response, value = await asyncio.wait_for(asyncio.gather(
            middleware.dispatch(build_request(), call_next), wrapper.get("quote")
        ), 2.5)
        assert 0.8 <= asyncio.get_running_loop().time() - started < 2.5
        assert response.headers["X-RateLimit-Status"] == "unavailable"
        assert value is None
        state.release.set()
        await holder
        assert await wrapper.get("quote") == "cached"
        assert (await middleware.dispatch(build_request(), call_next)).headers["X-RateLimit-Status"] == "enforced"
    finally:
        state.release.set()
        await holder
        await wrapper.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel_holder", [False, True])
async def test_shared_redis_cancellation_returns_admission_capacity(pooled_redis, cancel_holder):
    wrapper, middleware, state = pooled_redis
    wrapper.max_connections = 1
    await wrapper.connect()
    holder = asyncio.create_task(wrapper.get("held"))
    waiter = None
    try:
        await asyncio.wait_for(state.entered.get(), 1)
        waiter = asyncio.create_task(middleware.dispatch(build_request(), call_next))
        await asyncio.sleep(0)
        assert not waiter.done()
        cancelled = holder if cancel_holder else waiter
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled
        state.release.set()
        if cancel_holder:
            response = await asyncio.wait_for(waiter, 1)
            assert response.headers["X-RateLimit-Status"] == "enforced"
        else:
            assert await holder == "cached"
        assert await asyncio.wait_for(wrapper.get("quote"), 1) == "cached"
        assert (await middleware.dispatch(build_request(), call_next)).headers["X-RateLimit-Status"] == "enforced"
    finally:
        state.release.set()
        await asyncio.gather(holder, *([waiter] if waiter else []), return_exceptions=True)
        await wrapper.disconnect()


@pytest.mark.asyncio
async def test_redis_initialization_and_shutdown_share_one_ready_client(pooled_redis):
    wrapper, middleware, state = pooled_redis
    state.ping_release.clear()
    first = asyncio.create_task(wrapper.connect())
    second = None
    try:
        await asyncio.wait_for(state.ping_entered.wait(), 1)
        second = asyncio.create_task(wrapper.connect())
        await asyncio.sleep(0)
        assert not second.done()
        with pytest.raises(RuntimeError, match="not initialized"):
            _ = wrapper.client
        state.ping_release.set()
        await asyncio.gather(first, second)
        assert state.pings == 1
        assert await wrapper.get("quote") == "cached"
        assert (await middleware.dispatch(build_request(), call_next)).headers["X-RateLimit-Status"] == "enforced"
        await asyncio.gather(wrapper.disconnect(), wrapper.disconnect())
        assert state.disconnected == 1
        with pytest.raises(RuntimeError, match="not initialized"):
            _ = wrapper.client
        await wrapper.connect()
        assert state.pings == 2
        assert await wrapper.get("quote") == "cached"
    finally:
        state.ping_release.set()
        await asyncio.gather(first, *([second] if second else []), return_exceptions=True)
        await wrapper.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_interrupted_redis_initialization_cleans_up_and_can_reconnect(pooled_redis, cancel):
    wrapper, _, state = pooled_redis
    state.ping_release.clear()
    opening = asyncio.create_task(wrapper.connect())
    try:
        await asyncio.wait_for(state.ping_entered.wait(), 1)
        if cancel:
            opening.cancel()
            expected = asyncio.CancelledError
        else:
            state.ping_error = ValueError("handshake failed")
            state.ping_release.set()
            expected = ValueError
        with pytest.raises(expected):
            await opening
        with pytest.raises(RuntimeError, match="not initialized"):
            _ = wrapper.client
        assert state.disconnected == 1
        state.ping_error = None
        state.ping_release.set()
        await wrapper.connect()
        assert await wrapper.get("quote") == "cached"
    finally:
        state.ping_release.set()
        await asyncio.gather(opening, return_exceptions=True)
        await wrapper.disconnect()


@pytest.mark.asyncio
async def test_redis_shutdown_waits_for_shared_initialization(pooled_redis):
    wrapper, _, state = pooled_redis
    state.ping_release.clear()
    opening = asyncio.create_task(wrapper.connect())
    closing = None
    try:
        await asyncio.wait_for(state.ping_entered.wait(), 1)
        closing = asyncio.create_task(wrapper.disconnect())
        await asyncio.sleep(0)
        assert not closing.done()
        state.ping_release.set()
        await asyncio.wait_for(asyncio.gather(opening, closing), 1)
        assert state.pings == 1
        assert state.disconnected == 1
        with pytest.raises(RuntimeError, match="not initialized"):
            _ = wrapper.client
    finally:
        state.ping_release.set()
        await asyncio.gather(opening, *([closing] if closing else []), return_exceptions=True)
        await wrapper.disconnect()
