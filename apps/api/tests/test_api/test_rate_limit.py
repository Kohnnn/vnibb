from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from httpx import ASGITransport, AsyncClient

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
