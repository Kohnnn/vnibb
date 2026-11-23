from datetime import UTC, date, datetime
from unittest.mock import AsyncMock

import pytest
from vnibb.api.v1 import equity, microstructure
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.trading import IntradayTrade, OrderbookSnapshot
from vnibb.providers.vnstock.price_depth import PriceDepthData
from vnibb.services import microstructure_analysis
from vnibb.services.market_session import qualify_market_session
from vnibb.services.mongo_market_data_service import MongoReadError, MongoReadRows


@pytest.fixture
def intraday_clock(monkeypatch):
    def freeze(instant):
        class FrozenDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return instant.astimezone(tz)

        for module in (equity, microstructure, microstructure_analysis):
            monkeypatch.setattr(module, "datetime", FrozenDateTime)

    return freeze


@pytest.fixture(autouse=True)
def isolate_depth_provider(monkeypatch):
    monkeypatch.setattr(equity.settings, "orderbook_enabled", True)
    monkeypatch.setattr(equity.redis_client, "get_json", AsyncMock(return_value=None))
    monkeypatch.setattr(equity.redis_client, "set_json", AsyncMock())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "outcome", "instant", "session"),
    [
        ("orderbook", "timeout", datetime(2026, 11, 23, 6, 55, tzinfo=UTC), "unknown"),
        ("price-depth", "empty", datetime(2026, 11, 23, 6, 55, tzinfo=UTC), "unknown"),
        ("orderbook", "unsupported", datetime(2026, 11, 23, 6, 55, tzinfo=UTC), "unknown"),
        ("price-depth", "timeout", datetime(2026, 9, 1, 6, 55, tzinfo=UTC), "holiday"),
        ("price-depth", "timeout", datetime(2027, 3, 1, 10, tzinfo=UTC), "unknown"),
        ("price-depth", "timeout", datetime(2026, 11, 23, 9, tzinfo=UTC), "closed"),
    ],
)
async def test_depth_feed_outcome_is_independent_of_session(client, monkeypatch, intraday_clock, path, outcome, instant, session):
    intraday_clock(instant)
    fetch = AsyncMock(return_value=PriceDepthData(symbol="HPG", raw_levels=[]))
    if outcome == "timeout":
        fetch.side_effect = TimeoutError("upstream detail must not leak")
    elif outcome == "unsupported":
        monkeypatch.setattr(equity.settings, "orderbook_enabled", False)
    monkeypatch.setattr(equity.VnstockPriceDepthFetcher, "fetch", fetch)

    response = await client.get(f"/api/v1/equity/HPG/{path}")

    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]
    body = response.json()
    assert body["data"]["entries"] == []
    assert body["data"]["market_status"] == body["meta"]["market_session"]["state"] == session
    feed = body["meta"]["feed"]
    assert feed["status"] == outcome
    assert feed["source_as_of"] is feed["covered_window"] is None
    assert feed["fetched_at"] == instant.isoformat()
    assert feed["fallback"] is False
    if outcome == "unsupported":
        fetch.assert_not_awaited()
    assert body["error"] == {
        "timeout": "Request timed out",
        "empty": None,
        "unsupported": "The configured provider does not support this feed",
    }[outcome]


@pytest.mark.asyncio
async def test_depth_timeout_keeps_valid_snapshot_and_separate_observation_clocks(client, test_db, monkeypatch, intraday_clock):
    now = datetime(2026, 11, 23, 7, tzinfo=UTC)
    intraday_clock(now)
    monkeypatch.setattr(equity.VnstockPriceDepthFetcher, "fetch", AsyncMock(side_effect=TimeoutError))
    test_db.add(OrderbookSnapshot(
        id=19, symbol="HPG", snapshot_time=datetime(2026, 11, 20, 7, 31),
        price_depth={
            "entries": [{"level": 1, "price": 25.0, "bid_vol": 100, "ask_vol": 200}],
            "observed_at": "2026-11-20T07:30:00Z", "timestamp_meaning": "source_observation",
        },
    ))
    await test_db.commit()

    response = await client.get("/api/v1/equity/HPG/orderbook")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["entries"][0]["price"] == 25.0
    assert body["data"]["is_stale"] is True
    assert body["data"]["market_status"] == "unknown"
    assert body["error"] == "Request timed out"
    assert body["meta"]["feed"] == {
        "status": "timeout", "requested_source": "vnstock:VCI", "source": "postgres:orderbook_snapshots",
        "source_as_of": "2026-11-20T07:30:00+00:00", "fetched_at": now.isoformat(),
        "snapshot_at": "2026-11-20T07:31:00+00:00", "delivery": "retained", "fallback": True,
        "covered_window": None,
    }


def _zero_trade_snapshot():
    session = date(2026, 11, 23)
    clock = {"symbol": "HPG", "session": "ENDED", "time": "2026-11-23T08:00:00Z", "receivedTime": "2026-11-23T08:00:03Z"}
    raw = {
        "listingInfo": {
            "symbol": "HPG", "ticker": "HPG", "type": "STOCK", "stockType": "STOCK",
            "isDelisted": 0, "tradingDate": session.isoformat(), "receivedTime": "2026-11-23T01:44:00Z",
            "tradingStatus": "TRADING_ACTIVATED", "tradingStatusCode": "20", "securityStatus": "N",
        },
        "bidAsk": clock,
        "matchPrice": {**clock, "openPrice": None, "highest": 0, "lowest": 0, "matchPrice": 0, "accumulatedVolume": 0},
    }
    evidence = qualify_market_session(raw, "HPG", session, datetime(2026, 11, 23, 8, 12, tzinfo=UTC))
    assert evidence is not None and evidence["status"] == "no_trade"
    return ScreenerSnapshot(symbol="HPG", snapshot_date=session, volume=0, extended_metrics={"market_session": evidence})


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["no_coverage", "covered_zero", "contradictory_print", "provider_timeout"])
async def test_trade_tape_admits_zero_only_after_a_successful_read_with_session_evidence(client, test_db, monkeypatch, intraday_clock, case):
    intraday_clock(datetime(2026, 11, 23, 9, tzinfo=UTC))
    fetch = AsyncMock(return_value=[])
    if case != "no_coverage":
        test_db.add(_zero_trade_snapshot())
    if case in {"contradictory_print", "provider_timeout"}:
        trade_day = 23 if case == "contradictory_print" else 20
        test_db.add(IntradayTrade(id=19, symbol="HPG", trade_time=datetime(2026, 11, trade_day, 14, 10), price=25000.0, volume=300))
    if case == "provider_timeout":
        fetch.side_effect = TimeoutError
    await test_db.commit()
    monkeypatch.setattr(equity.VnstockIntradayFetcher, "fetch", fetch)

    response = await client.get("/api/v1/equity/HPG/intraday?limit=1000")

    assert response.status_code == 200
    assert fetch.await_args.args[0].limit == 500
    body = response.json()
    feed = body["meta"]["feed"]
    assert body["meta"]["market_session"]["state"] == "closed"
    assert feed["status"] == ("timeout" if case == "provider_timeout" else "empty")
    assert body["error"] == ("Request timed out" if case == "provider_timeout" else None)
    if case == "covered_zero":
        assert body["data"] == []
        assert feed["covered_window"] == {"session_date": "2026-11-23", "trade_count": 0, "basis": "vietcap_board"}
        assert feed["source_as_of"] == "2026-11-23"
        assert feed["delivery"] == "retained"
        assert feed["fallback"] is False
    else:
        assert feed["covered_window"] is None
        if case == "no_coverage":
            assert body["data"] == []
            assert feed["source_as_of"] is None
            assert feed["fallback"] is False
        else:
            assert body["data"][0]["volume"] == 300
            assert feed["source_as_of"] == body["data"][0]["time"]
            assert feed["delivery"] == "retained"
            assert feed["fallback"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("features,result_field", [("vwap", "points"), ("footprint", "bars")])
@pytest.mark.parametrize("failed", [True, False])
async def test_tick_proxies_distinguish_mongo_failure_from_missing_coverage(client, monkeypatch, intraday_clock, features, result_field, failed):
    intraday_clock(datetime(2026, 11, 23, 6, 55, tzinfo=UTC))
    read = AsyncMock(return_value=MongoReadRows([], {"latest_session_status": "empty"}))
    if failed:
        read.side_effect = MongoReadError("timeout")
    service = microstructure_analysis.MicrostructureAnalysisService()
    monkeypatch.setattr(service.mongo, "get_intraday_trades", read)
    monkeypatch.setattr(microstructure, "get_microstructure_analysis_service", lambda: service)

    response = await client.get(f"/api/v1/microstructure/HPG?features={features}&lookback_days=7")

    assert response.status_code == 200
    body = response.json()
    assert body["data"][features][result_field] == []
    assert body["meta"]["market_session"]["state"] == "unknown"
    assert body["meta"]["feed"]["status"] == ("timeout" if failed else "empty")
    assert body["meta"]["feed"]["covered_window"] is None
    assert body["error"] == ("Trade ticks: Request timed out" if failed else None)
