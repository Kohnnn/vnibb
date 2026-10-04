"""Regression tests for the PredictIt and Limitless ingest wiring.

These pin the *real* provider contracts (endpoints, query params, price
units, active flags) through the production ingest HTTP mock + DB seam,
so a future edit that drifts back to the old broken routes fails loudly:

  * PredictIt must read the official ``/marketdata/all/`` feed and take
    the wire ``lastTradePrice`` / ``Open`` status fields.
  * Limitless must page ``/markets/active`` at ``limit=25``, flatten
    ladder groups, and convert AMM cents to probabilities.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select

from vnibb.models.prediction_market import PredictionMarket
from vnibb.services.limitless_service import (
    LIMITLESS_ACTIVE_PATH,
    LIMITLESS_BASE_URL,
    LIMITLESS_PAGE_SIZE,
    LimitlessMarketPayload,
    ingest_limitless_markets,
    normalize_limitless_market,
)
from vnibb.services.prediction_market_http import PredictionMarketFetchError
from vnibb.services.predictit_service import (
    PREDICTIT_MARKETDATA_PATH,
    PredictItContractPayload,
    PredictItMarketPayload,
    ingest_predictit_markets,
    normalize_predictit_market,
)


@pytest.fixture(autouse=True)
def _no_retry_sleep(monkeypatch):
    """Keep the retry-path tests fast: the 4xx tests must not really sleep."""

    async def _sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("vnibb.services.prediction_market_http.asyncio.sleep", _sleep)


# --------------------------------------------------------------------------
# PredictIt
# --------------------------------------------------------------------------


def test_predictit_endpoint_is_the_official_marketdata_feed():
    assert PREDICTIT_MARKETDATA_PATH == "/marketdata/all/"


def test_predictit_normalizer_drops_market_without_priced_contracts():
    payload = PredictItMarketPayload(id=1, name="Will X happen?", contracts=[])
    assert normalize_predictit_market(payload) is None


def test_predictit_normalizer_averages_contracts_and_tracks_open_status():
    payload = PredictItMarketPayload(
        id=42,
        name="Will it rain in DC tomorrow?",
        shortName="Rain in DC",
        contracts=[
            PredictItContractPayload(id=101, name="Rain 1+ inch", lastTradePrice=0.30),
            PredictItContractPayload(id=102, name="Rain < 1 inch", lastTradePrice=0.55),
        ],
    )
    market = normalize_predictit_market(payload)
    assert market is not None
    assert market.source == "predictit"
    assert market.source_id == "42"
    assert market.category in ("general", "politics", "sports", "economic")
    assert market.outcome_prices[0] == pytest.approx((0.30 + 0.55) / 2, abs=0.001)
    assert market.outcome_prices[1] == pytest.approx(1.0 - (0.30 + 0.55) / 2, abs=0.001)
    # A contract with no published status is not treated as open.
    assert market.active is False


def test_predictit_normalizer_marks_market_active_when_any_contract_is_open():
    payload = PredictItMarketPayload(
        id=43,
        name="Will it snow?",
        contracts=[
            PredictItContractPayload(id=201, name="Yes", status="Closed", lastTradePrice=0.10),
            PredictItContractPayload(id=202, name="No", status="Open", lastTradePrice=0.90),
        ],
    )
    market = normalize_predictit_market(payload)
    assert market is not None
    assert market.active is True
    assert market.closed is False


def test_predictit_normalizer_prefers_last_trade_over_close():
    payload = PredictItMarketPayload(
        id=44,
        name="Price precedence?",
        contracts=[
            PredictItContractPayload(
                id=301, status="Open", lastTradePrice=None, bestBuyYesCost=0.62, lastClosePrice=0.58
            ),
        ],
    )
    market = normalize_predictit_market(payload)
    assert market is not None
    assert market.outcome_prices[0] == pytest.approx(0.62, abs=0.001)


@pytest.mark.asyncio
async def test_predictit_ingest_hits_official_feed_and_stores_real_contracts(test_db):
    """Production-shaped: mock the wire feed, ingest, read back the DB row."""
    end_date = datetime.now(UTC) + timedelta(days=3)
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "markets": [
                    {
                        "id": 7001,
                        "name": "Which party wins the 2026 Senate race?",
                        "shortName": "Senate 2026",
                        "url": "https://www.predictit.org/markets/detail/7001",
                        "timeStamp": "2026-10-04T12:00:00",
                        "contracts": [
                            {
                                "id": 90001,
                                "name": "Democrat",
                                "status": "Open",
                                "lastTradePrice": 0.54,
                                "bestBuyYesCost": 0.56,
                                "bestSellYesCost": 0.52,
                                "lastClosePrice": 0.53,
                                "dateEnd": end_date.isoformat(),
                            },
                            {
                                "id": 90002,
                                "name": "Republican",
                                "status": "Open",
                                "lastTradePrice": 0.46,
                                "dateEnd": end_date.isoformat(),
                            },
                        ],
                    },
                    {
                        # A fully closed market must not be admitted.
                        "id": 7002,
                        "name": "Closed market",
                        "contracts": [
                            {
                                "id": 90003,
                                "name": "Yes",
                                "status": "Closed",
                                "lastTradePrice": 0.99,
                                "dateEnd": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
                            },
                        ],
                    },
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="https://www.predictit.org/api",
    ) as client:
        stored = await ingest_predictit_markets(test_db, client, limit=50)

    assert seen["path"] == "/api/marketdata/all/"
    assert seen["params"] == {}
    assert stored == 1

    row = (
        await test_db.execute(
            select(PredictionMarket).where(PredictionMarket.source == "predictit")
        )
    ).scalar_one()
    assert row.source_id == "7001"
    assert row.question == "Which party wins the 2026 Senate race?"
    assert row.outcome_prices[0] == pytest.approx(0.50, abs=0.001)
    assert row.outcome_prices[1] == pytest.approx(0.50, abs=0.001)
    assert row.active is True
    assert row.closed is False
    assert row.url == "https://www.predictit.org/markets/detail/7001"


@pytest.mark.asyncio
async def test_predictit_ingest_surfaces_real_403_without_writing_rows(test_db):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="Forbidden", headers={"content-type": "text/html"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://www.predictit.org/api",
    ) as client:
        with pytest.raises(PredictionMarketFetchError) as excinfo:
            await ingest_predictit_markets(test_db, client, limit=50)
    assert excinfo.value.status == 403
    assert (await test_db.execute(select(PredictionMarket.id))).scalars().all() == []


@pytest.mark.asyncio
async def test_predictit_ingest_rejects_unexpected_envelope(test_db):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://www.predictit.org/api",
    ) as client:
        with pytest.raises(PredictionMarketFetchError):
            await ingest_predictit_markets(test_db, client, limit=50)
    assert (await test_db.execute(select(PredictionMarket.id))).scalars().all() == []


# --------------------------------------------------------------------------
# Limitless
# --------------------------------------------------------------------------


def test_limitless_endpoint_is_the_documented_active_route():
    assert LIMITLESS_ACTIVE_PATH == "/markets/active"
    assert LIMITLESS_PAGE_SIZE == 25
    assert LIMITLESS_BASE_URL == "https://api.limitless.exchange"


def test_limitless_normalizer_reads_clob_fraction_prices():
    payload = LimitlessMarketPayload(
        id=7,
        title="BTC > 100k by year-end",
        slug="btc-100k",
        stableSlug="btc-100k-stable",
        status="FUNDED",
        prices=[0.65, 0.35],
    )
    market = normalize_limitless_market(payload)
    assert market is not None
    assert market.source == "limitless"
    assert market.outcome_prices[0] == 0.65
    assert market.outcome_prices[1] == pytest.approx(0.35, abs=0.001)
    assert market.url == "https://limitless.exchange/markets/btc-100k"


def test_limitless_normalizer_converts_amm_cents_to_probabilities():
    """Observed AMM markets quote ``[50, 50]`` cents, not fractions."""
    payload = LimitlessMarketPayload(
        id=9,
        title="Will ETH close above $4k?",
        slug="eth-4k",
        status="FUNDED",
        prices=[50.5, 49.5],
    )
    market = normalize_limitless_market(payload)
    assert market is not None
    assert market.outcome_prices[0] == pytest.approx(0.505, abs=1e-6)
    assert market.outcome_prices[1] == pytest.approx(0.495, abs=1e-6)


@pytest.mark.parametrize(
    ("trade_type", "prices", "expected"),
    [
        ("amm", [0.4, 0.3], (0.004, 0.003)),
        ("clob", [0.4, 0.3], (0.4, 0.3)),
        ("clob", [50.0, 50.0], None),
    ],
)
def test_limitless_explicit_trade_type_controls_quote_units(trade_type, prices, expected):
    payload = LimitlessMarketPayload(
        id=11,
        title="Unit boundary",
        status="FUNDED",
        tradeType=trade_type,
        prices=prices,
    )
    market = normalize_limitless_market(payload)
    if expected is None:
        assert market is None
    else:
        assert market is not None
        assert market.outcome_prices == pytest.approx(expected)


def test_limitless_normalizer_drops_unpriced_and_inactive_markets():
    assert normalize_limitless_market(
        LimitlessMarketPayload(id=8, title="No prices", status="FUNDED", prices=None)
    ) is None
    assert normalize_limitless_market(
        LimitlessMarketPayload(id=8, title="Expired", status="FUNDED", expired=True, prices=[0.5, 0.5])
    ) is None
    assert normalize_limitless_market(
        LimitlessMarketPayload(id=8, title="Not funded", status="RESOLVED", prices=[0.5, 0.5])
    ) is None


def test_limitless_normalizer_strips_html_descriptions():
    payload = LimitlessMarketPayload(
        id=10,
        title="HTML description",
        status="FUNDED",
        slug="html-desc",
        prices=[0.4, 0.6],
        description="<p>Resolves &quot;Yes&quot; if X.</p><p><br></p>",
    )
    market = normalize_limitless_market(payload)
    assert market is not None
    assert market.description == 'Resolves "Yes" if X.'


@pytest.mark.asyncio
async def test_limitless_ingest_pages_active_endpoint_and_flattens_groups(test_db):
    expiration = int((datetime.now(UTC) + timedelta(days=2)).timestamp() * 1000)
    requests: list[tuple[int, int]] = []

    def single(market_id: int, title: str) -> dict:
        return {
            "id": market_id,
            "title": title,
            "slug": f"slug-{market_id}",
            "stableSlug": f"stable-{market_id}",
            "status": "FUNDED",
            "hidden": False,
            "expired": False,
            "marketType": "single",
            "prices": [0.31, 0.69],
            "volumeFormatted": "1.5",
            "liquidityFormatted": "2.5",
            "expirationTimestamp": expiration,
            "categories": ["Crypto"],
            "description": "<p>Resolves if BTC &gt; 100k.</p>",
        }

    def handler(request: httpx.Request) -> httpx.Response:
        limit = int(request.url.params["limit"])
        page = int(request.url.params["page"])
        requests.append((limit, page))
        if page == 1:
            data = [single(i, f"Market {i}") for i in range(LIMITLESS_PAGE_SIZE - 1)]
            data.append(
                {
                    "id": 900,
                    "title": "Ladder: ETH price",
                    "slug": "ladder-eth",
                    "status": "FUNDED",
                    "marketType": "group",
                    "expirationTimestamp": expiration,
                    "categories": ["Crypto"],
                    "prices": None,
                    "markets": [
                        {
                            "id": 901,
                            "title": "↑ 4,000",
                            "slug": "eth-4000",
                            "status": "FUNDED",
                            "marketType": "single",
                            "prices": [0.008, 0.992],
                            "expirationTimestamp": expiration,
                            "categories": ["Crypto"],
                        },
                        {
                            "id": 902,
                            "title": "↑ 5,000",
                            "slug": "eth-5000",
                            "status": "FUNDED",
                            "marketType": "single",
                            "prices": [0.005, 0.995],
                            "expirationTimestamp": expiration,
                            "categories": [],
                        },
                    ],
                }
            )
            return httpx.Response(200, json={"data": data, "totalMarketsCount": 100})
        # Second page is short, so pagination must stop.
        return httpx.Response(200, json={"data": [single(999, "Last market")], "totalMarketsCount": 100})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=LIMITLESS_BASE_URL
    ) as client:
        stored = await ingest_limitless_markets(test_db, client, limit=200)

    assert requests == [(LIMITLESS_PAGE_SIZE, 1), (LIMITLESS_PAGE_SIZE, 2)]
    rows = (
        await test_db.execute(
            select(PredictionMarket).where(PredictionMarket.source == "limitless")
        )
    ).scalars().all()
    assert stored == len(rows)
    # 24 singles + 2 flattened children + 1 short-page single.
    assert stored == LIMITLESS_PAGE_SIZE - 1 + 2 + 1
    by_id = {row.source_id: row for row in rows}
    assert "900" not in by_id  # the group itself carries no prices
    child = by_id["901"]
    assert child.question == "Ladder: ETH price - ↑ 4,000"
    assert child.outcome_prices[0] == pytest.approx(0.008, abs=1e-6)
    assert child.category == "general"
    assert child.active is True


@pytest.mark.asyncio
async def test_limitless_ingest_surfaces_legacy_404(test_db):
    def handler(request: httpx.Request) -> httpx.Response:
        # The old ``/markets`` route no longer serves active markets.
        return httpx.Response(404, json={"message": "Not found"})

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=LIMITLESS_BASE_URL
    ) as client:
        with pytest.raises(PredictionMarketFetchError) as excinfo:
            await ingest_limitless_markets(test_db, client, limit=50)
    assert excinfo.value.status == 404
    assert (await test_db.execute(select(PredictionMarket.id))).scalars().all() == []
