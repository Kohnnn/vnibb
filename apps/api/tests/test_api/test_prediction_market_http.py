"""Regression tests for the shared prediction-market fetch helper.

The ingest adapters rely on this helper to surface the provider's *real*
HTTP status. These tests pin the error-propagation contract that the live
failures exposed (a 403 arriving as ``status=None``, a 429 losing its
status, and a non-JSON 200 body escaping as a raw decode error).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from vnibb.services.prediction_market_http import (
    PREDICTION_MARKET_MAX_RETRY_AFTER_SECONDS,
    PredictionMarketFetchError,
    fetch_json_with_retry,
)


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://example.test")


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
async def test_permanent_client_rejection_preserves_status_without_retry(monkeypatch, status):
    requests = []
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr("vnibb.services.prediction_market_http.asyncio.sleep", fake_sleep)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, text="Rejected", headers={"content-type": "text/html"})

    async with _client(handler) as client:
        with pytest.raises(PredictionMarketFetchError) as excinfo:
            await fetch_json_with_retry(client, "predictit", "/x")
    assert excinfo.value.status == status
    assert excinfo.value.source == "predictit"
    assert len(requests) == 1
    assert slept == []


@pytest.mark.asyncio
async def test_429_status_survives_all_attempts(monkeypatch):
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr("vnibb.services.prediction_market_http.asyncio.sleep", fake_sleep)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "slow down"}, headers={"Retry-After": "7"})

    async with _client(handler) as client:
        with pytest.raises(PredictionMarketFetchError) as excinfo:
            await fetch_json_with_retry(client, "demo", "/x", attempts=3, backoff=1)
    assert excinfo.value.status == 429
    # Two retry sleeps (not one per attempt) of the advertised delay.
    assert slept == [7.0, 7.0]


@pytest.mark.asyncio
async def test_retry_after_http_date_is_parsed_and_bounded(monkeypatch):
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr("vnibb.services.prediction_market_http.asyncio.sleep", fake_sleep)
    far_future = (datetime.now(UTC) + timedelta(days=1)).strftime("%a, %d %b %Y %H:%M:%S GMT")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={}, headers={"Retry-After": far_future})

    async with _client(handler) as client:
        with pytest.raises(PredictionMarketFetchError):
            await fetch_json_with_retry(client, "demo", "/x", attempts=2, backoff=1)
    assert slept == [PREDICTION_MARKET_MAX_RETRY_AFTER_SECONDS]


@pytest.mark.asyncio
async def test_non_json_body_improves_error_without_losing_status():
    def handler(request: httpx.Request) -> httpx.Response:
        # 200 + JSON content-type but a malformed body.
        return httpx.Response(200, text="<html>not json</html>", headers={"content-type": "application/json"})

    async with _client(handler) as client:
        with pytest.raises(PredictionMarketFetchError) as excinfo:
            await fetch_json_with_retry(client, "demo", "/x", attempts=1, backoff=0)
    assert excinfo.value.status == 200
    assert "not JSON" in str(excinfo.value)


@pytest.mark.asyncio
async def test_unexpected_content_type_is_rejected():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html/>", headers={"content-type": "text/html"})

    async with _client(handler) as client:
        with pytest.raises(PredictionMarketFetchError) as excinfo:
            await fetch_json_with_retry(client, "demo", "/x", attempts=1, backoff=0)
    assert "content-type" in str(excinfo.value)


@pytest.mark.asyncio
async def test_successful_json_is_returned_verbatim():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["a"] == "1"
        return httpx.Response(200, json={"data": [1, 2, 3]})

    async with _client(handler) as client:
        body = await fetch_json_with_retry(client, "demo", "/x", params={"a": 1})
    assert body == {"data": [1, 2, 3]}


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [408, 429, 500, 503])
async def test_transient_http_failure_retries_until_success(monkeypatch, status):
    requests = []
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr("vnibb.services.prediction_market_http.asyncio.sleep", fake_sleep)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(status, json={"error": "temporarily unavailable"})
        return httpx.Response(200, json={"markets": []})

    async with _client(handler) as client:
        body = await fetch_json_with_retry(client, "demo", "/x", backoff=1)
    assert body == {"markets": []}
    assert len(requests) == 2
    assert slept == [1]
