"""Tests for the Kalshi ingestion normaliser."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from vnibb.models.prediction_market import PredictionMarket
from vnibb.services.kalshi_service import (
    KALSHI_BASE_URL,
    KALSHI_INGEST_BUDGET,
    KALSHI_MAX_PAGES,
    KALSHI_PAGE_LIMIT,
    KalshiMarketPayload,
    ingest_kalshi_markets,
    normalize_kalshi_market,
)


def test_kalshi_base_url_uses_public_trade_api():
    assert KALSHI_BASE_URL == "https://api.elections.kalshi.com/trade-api/v2"


@pytest.fixture
def sample_payload():
    return KalshiMarketPayload(
        ticker="KXINFLATION-26",
        event_ticker="KXINFLATION",
        title="Will Core CPI YoY > 3.0% by Dec 2026?",
        subtitle="Trimmed mean CPI for the trailing 12 months.",
        category="economics",
        tags=["cpi"],
        status="open",
        yes_bid=61.0,
        yes_ask=63.0,
        last_price=62.0,
        volume=12500,
        open_interest=5400,
        close_time=None,
    )


def test_normalize_kalshi_market_converts_price_to_probability(sample_payload):
    market = normalize_kalshi_market(sample_payload)
    assert market.source == "kalshi"
    assert market.source_id == "KXINFLATION-26"
    assert market.outcomes == ("Yes", "No")
    assert market.outcome_prices[0] == pytest.approx(0.62, abs=0.001)
    assert market.outcome_prices[1] == pytest.approx(0.38, abs=0.001)
    assert market.category == "economic"
    assert market.active is True
    assert market.url is not None and "kalshi.com" in market.url


def test_normalize_kalshi_market_accepts_active_status(sample_payload):
    market = normalize_kalshi_market(sample_payload.model_copy(update={"status": "active"}))
    assert market.active is True


def test_normalize_kalshi_handles_missing_yes_price():
    payload = KalshiMarketPayload(
        ticker="KXRECESSION-26",
        event_ticker="KXRECESSION",
        title="Will the US enter recession in 2026?",
        subtitle=None,
        category="economics",
        tags=["recession"],
        status="open",
        yes_bid=None,
        yes_ask=None,
        last_price=None,
        volume=None,
        open_interest=None,
        close_time=None,
    )
    market = normalize_kalshi_market(payload)
    assert market.outcome_prices[0] == 0.0
    assert market.outcome_prices[1] == 0.0


@pytest.mark.asyncio
async def test_kalshi_ingest_excludes_multivariate_rows_and_keeps_real_markets(test_db):
    now = datetime.now(UTC)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["mve_filter"] == "exclude"
        rows = [
            {"ticker": "KXMVECROSSCATEGORY-25", "event_ticker": "KXMVECROSSCATEGORY", "title": "Combo", "status": "open"},
            {"ticker": "KXREAL-1", "event_ticker": "KXREAL", "title": "Real", "status": "open", "close_time": (now + timedelta(days=1)).isoformat()},
            {"ticker": "KXHIDDEN-1", "event_ticker": "KXHIDDEN", "title": "Metadata combo", "status": "open", "mve_collection_ticker": "COLLECTION"},
            {"ticker": "KXCLOSED-1", "event_ticker": "KXCLOSED", "title": "Closed", "status": "closed"},
        ]
        return httpx.Response(200, json={"markets": rows, "cursor": ""})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=KALSHI_BASE_URL) as client:
        assert await ingest_kalshi_markets(test_db, client) == 1
    rows = (await test_db.execute(select(PredictionMarket.source_id))).scalars().all()
    assert rows == ["KXREAL-1"]


@pytest.mark.asyncio
async def test_kalshi_cursor_sweep_never_pages_the_whole_corpus(test_db) -> None:
    """A cycle must stop at the ingest budget, not follow the cursor forever.

    Kalshi's active corpus is far larger than anything the read path serves, so
    an unbounded sweep writes rows the product can never return. This pins both
    halves: the request never exceeds the page budget, and the sweep stops even
    when the API keeps handing back a cursor.
    """
    pages_requested: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        pages_requested.append(int(request.url.params["limit"]))
        page = len(pages_requested)
        rows = [
            {
                "ticker": f"KXBUDGET-{page}-{i}",
                "event_ticker": "KXBUDGET",
                "title": f"Budget market {page}-{i}",
                "status": "open",
                "close_time": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            }
            for i in range(KALSHI_PAGE_LIMIT)
        ]
        # Always hand back a cursor: only our own bound can stop the sweep.
        return httpx.Response(200, json={"markets": rows, "cursor": f"cursor-{page}"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=KALSHI_BASE_URL
    ) as client:
        stored = await ingest_kalshi_markets(test_db, client)

    assert len(pages_requested) <= KALSHI_MAX_PAGES, (
        f"cycle requested {len(pages_requested)} pages"
    )
    assert sum(pages_requested) <= KALSHI_INGEST_BUDGET
    assert stored <= KALSHI_INGEST_BUDGET
    assert stored > 0
