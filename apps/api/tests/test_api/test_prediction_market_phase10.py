"""Regression tests for the Manifold ingest wiring.

Pins the documented ``/search-markets`` contract (``filter=open`` +
``contractType=BINARY``) and the ``probability`` -> Yes-price mapping at
the production HTTP mock + DB seam, so a regression back to the rejected
``/markets?filter=open`` route fails loudly.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from vnibb.models.prediction_market import PredictionMarket
from vnibb.services.manifold_service import (
    MANIFOLD_MAX_LIMIT,
    MANIFOLD_SEARCH_PATH,
    ManifoldMarketPayload,
    ingest_manifold_markets,
    normalize_manifold_market,
)
from vnibb.services.prediction_market_http import PredictionMarketFetchError


def test_manifold_uses_search_markets_route():
    assert MANIFOLD_SEARCH_PATH == "/search-markets"
    assert MANIFOLD_MAX_LIMIT == 1000


def test_manifold_normalizer_drops_resolved_market():
    payload = ManifoldMarketPayload(
        id="abc-1",
        question="Resolved market?",
        is_resolved=True,
        probability=0.5,
    )
    assert normalize_manifold_market(payload) is None


def test_manifold_normalizer_drops_unpriced_market():
    payload = ManifoldMarketPayload(id="abc-2", question="No probability yet", probability=None)
    assert normalize_manifold_market(payload) is None


def test_manifold_normalizer_drops_non_binary_market():
    payload = ManifoldMarketPayload(
        id="abc-4",
        question="Who wins?",
        outcome_type="MULTIPLE_CHOICE",
        probability=0.5,
    )
    assert normalize_manifold_market(payload) is None


def test_manifold_normalizer_maps_probability_to_yes_price():
    payload = ManifoldMarketPayload(
        id="abc-3",
        slug="will-it-rain",
        question="Will it rain tomorrow?",
        outcome_type="BINARY",
        probability=0.42,
        liquidity=1234.5,
    )
    market = normalize_manifold_market(payload)
    assert market is not None
    assert market.source == "manifold"
    assert market.outcome_prices[0] == pytest.approx(0.42, abs=0.001)
    assert market.outcome_prices[1] == pytest.approx(0.58, abs=0.001)
    assert market.liquidity == pytest.approx(1234.5)
    assert market.url is not None and "will-it-rain" in market.url


@pytest.mark.asyncio
async def test_manifold_ingest_uses_supported_listing_params_and_stores_rows(test_db):
    close_time = int((datetime.now(UTC) + timedelta(days=30)).timestamp() * 1000)
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json=[
                {
                    "id": "m-1",
                    "slug": "will-ai-pass-the-bar",
                    "question": "Will an AI pass the bar exam?",
                    "url": "https://manifold.markets/u/will-ai-pass-the-bar",
                    "outcomeType": "BINARY",
                    "probability": 0.61,
                    "totalLiquidity": 20916,
                    "volume": 14216771.9,
                    "isResolved": False,
                    "closeTime": close_time,
                },
                {
                    "id": "m-2",
                    "slug": "who-wins",
                    "question": "Who wins the election?",
                    "outcomeType": "MULTIPLE_CHOICE",
                    "totalLiquidity": 100,
                    "isResolved": False,
                },
            ],
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.manifold.markets/v0"
    ) as client:
        stored = await ingest_manifold_markets(test_db, client, limit=200)

    assert seen["path"] == "/v0/search-markets"
    assert seen["params"] == {
        "filter": "open",
        "contractType": "BINARY",
        "token": "ALL",
        "limit": "200",
    }
    assert stored == 1
    row = (
        await test_db.execute(
            select(PredictionMarket).where(PredictionMarket.source == "manifold")
        )
    ).scalar_one()
    assert row.source_id == "m-1"
    assert row.outcome_prices[0] == pytest.approx(0.61, abs=1e-6)
    assert row.liquidity == pytest.approx(20916)
    assert row.url == "https://manifold.markets/u/will-ai-pass-the-bar"
    assert row.active is True


@pytest.mark.asyncio
async def test_manifold_ingest_surfaces_rejected_filter_as_400(test_db):
    """The old ``/markets?filter=open`` route answered 400; keep it surfaced."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"message": "Invalid filter"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.manifold.markets/v0"
    ) as client:
        with pytest.raises(PredictionMarketFetchError) as excinfo:
            await ingest_manifold_markets(test_db, client, limit=50)
    assert excinfo.value.status == 400
    assert (await test_db.execute(select(PredictionMarket.id))).scalars().all() == []


@pytest.mark.asyncio
async def test_manifold_ingest_rejects_unexpected_envelope(test_db):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"markets": []})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="https://api.manifold.markets/v0"
    ) as client:
        with pytest.raises(PredictionMarketFetchError):
            await ingest_manifold_markets(test_db, client, limit=50)
