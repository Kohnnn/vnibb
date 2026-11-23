from datetime import UTC, datetime
from hashlib import md5
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from vnibb.api.v1 import microstructure
from vnibb.core import cache
from vnibb.services import microstructure_analysis
from vnibb.services.mongo_market_data_service import (
    MongoMarketDataService,
    MongoReadError,
    MongoReadRows,
)


@pytest.fixture
def microstructure_store(monkeypatch):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 23, 6, 55, tzinfo=UTC).astimezone(tz)

    store = SimpleNamespace(
        get_intraday_trades=AsyncMock(return_value=[]),
        get_price_depth=AsyncMock(return_value=[]),
        get_eod_prices=AsyncMock(return_value=[]),
    )
    service = microstructure_analysis.MicrostructureAnalysisService()
    service.mongo = store
    monkeypatch.setattr(microstructure_analysis, "datetime", FrozenDateTime)
    monkeypatch.setattr(microstructure, "get_microstructure_analysis_service", lambda: service)
    return store


@pytest.mark.asyncio
async def test_microstructure_partial_tick_timeout_preserves_depth_and_daily_series(client, microstructure_store):
    microstructure_store.get_intraday_trades.side_effect = MongoReadError("timeout")
    microstructure_store.get_price_depth.return_value = [
        {"symbol": "HPG", "priceUnit": "VND", "raw": {"price": 25_000, "volume": 100}},
    ]
    microstructure_store.get_eod_prices.return_value = [
        {"tradeDate": "2026-11-20", "open": 24_700, "high": 25_000, "low": 24_650, "close": 24_850},
    ]

    response = await client.get("/api/v1/microstructure/HPG")

    assert response.status_code == 200
    body = response.json()
    assert body["error"] == "Trade ticks: Request timed out"
    assert body["meta"]["input_errors"] == {"trade_ticks": "Request timed out"}
    assert body["meta"]["feed"]["status"] == "timeout"
    assert body["data"]["deep_trades"]["bars"] == []
    assert body["data"]["volume_profile"]["quality"] == "volume_at_price"
    assert body["data"]["volume_profile"]["bins"][0]["price"] == 25_000
    assert body["data"]["price_action"]["candles"][0]["close"] == 24_850


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "row,expected_as_of",
    [
        pytest.param(
            {"tradeTime": "2026-11-23T02:13:46Z", "sourceCollection": "market_intraday_trades"},
            "2026-11-23T09:13:46+07:00", id="explicit-offset",
        ),
        pytest.param(
            {"tradeTime": "2026-11-23T09:13:46", "sourceCollection": "market_intraday_trades",
             "sourceDataset": "equity.intraday", "sourceRecordKey": "matched-trade:HPG:2026-11-23:id:12",
             "timestampMeaning": "source_trade_time"},
            "2026-11-23T09:13:46+07:00", id="known-sql-wall-clock-writer",
        ),
        pytest.param(
            {"tradeTime": "2026-11-23T02:13:46", "sourceCollection": "market_intraday_trades",
             "sourceDataset": "quote.intraday", "timestampMeaning": "source_trade_time"},
            None, id="legacy-derived-clock-without-zone-basis",
        ),
    ],
)
async def test_microstructure_does_not_infer_a_legacy_trade_clock(client, microstructure_store, row, expected_as_of):
    microstructure_store.get_intraday_trades.return_value = [
        {**row, "symbol": "HPG", "priceUnit": "VND", "raw": {"time": row["tradeTime"], "price": 25_000, "volume": 100}},
    ]

    response = await client.get("/api/v1/microstructure/HPG?features=vwap")

    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["feed"]["source_as_of"] == expected_as_of
    assert body["meta"]["trade_as_of_basis"] == ("admitted_trade_time" if expected_as_of else None)
    if expected_as_of is None:
        assert body["meta"]["feed"]["status"] == "unusable"
        assert "trade_ticks" in body["meta"]["input_errors"]
        assert body["data"]["vwap"]["points"] == []
    else:
        assert body["error"] is None
        assert body["data"]["vwap"]["points"][0]["time"] == "2026-11-23T09:10:00+07:00"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["no_rows", "explicit_empty_receipt", "rejected_price", "rejected_shape", "unverified_units"])
async def test_depth_rejection_is_not_a_successful_empty_read(client, microstructure_store, monkeypatch, case):
    class DepthRows(list):
        def sort(self, *_):
            return self

        def limit(self, limit):
            return self[:limit]

    batch = datetime(2026, 11, 23, 6, tzinfo=UTC)
    row = {"dataset": "equity.price_depth", "symbol": "HPG", "updatedAt": batch}
    rows = DepthRows()
    if case == "explicit_empty_receipt":
        rows.append({**row, "batchReceipt": True, "rowCount": 0, "latestSessionStatus": "empty"})
        rows.append({**row, "updatedAt": datetime(2026, 11, 20, 6, tzinfo=UTC),
                     "priceUnit": "VND", "raw": {"price": 25_000, "volume": 100}})
    elif case == "rejected_price":
        rows.append({**row, "priceUnit": "VND", "raw": {"price": 0, "volume": 100}})
    elif case == "rejected_shape":
        rows.append({**row, "priceUnit": "VND", "raw": [25_000, 100]})
    elif case == "unverified_units":
        rows.append({**row, "priceUnit": "unknown", "raw": {"price": 25, "volume": 100}})

    mongo = MongoMarketDataService()
    collection = SimpleNamespace(find=lambda *_: rows)
    monkeypatch.setattr(mongo, "_get_collection", lambda name: collection)
    microstructure_store.get_price_depth.side_effect = mongo.get_price_depth

    response = await client.get("/api/v1/microstructure/HPG?features=volume_profile")

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["volume_profile"]["bins"] == []
    assert body["meta"]["feed"]["status"] == "empty"
    assert body["meta"]["feed"]["covered_window"] is None
    if case.startswith(("rejected", "unverified")):
        assert body["meta"]["input_errors"] == {"price_depth": "The feed returned no usable observations"}
        assert body["error"] == "Price depth: The feed returned no usable observations"
    else:
        assert body["meta"]["input_errors"] == {}
        assert body["error"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("exact", [True, False], ids=["exact-receipt", "mismatched-receipt"])
async def test_microstructure_distinguishes_a_covered_zero_from_an_empty_batch(client, microstructure_store, exact):
    day = "2026-11-20"
    receipt = {
        "batchReceipt": True, "symbol": "HPG", "sourceDate": day, "rowCount": 0,
        "coverage": {
            "session_date": day, "requested_session_date": day, "scope": "full_session",
            "status": "complete_session", "completed_session": True, "provider_exhausted": True,
            "observed_trade_count": 0, "denominator_trade_count": 0 if exact else 1,
        },
    }
    microstructure_store.get_intraday_trades.return_value = MongoReadRows([], {"batch_receipt": receipt})

    response = await client.get("/api/v1/microstructure/HPG?features=vwap")

    assert response.status_code == 200
    body = response.json()
    assert body["error"] is None and body["meta"]["feed"]["status"] == "empty"
    if exact:
        assert body["meta"]["trade_as_of_basis"] == "completed_tick_session"
        assert body["meta"]["feed"]["source_as_of"] == day
        assert body["meta"]["feed"]["covered_window"] == {
            "session_date": day, "trade_count": 0, "basis": "completed_tick_session",
        }
    else:
        assert body["meta"]["trade_as_of_basis"] is None
        assert body["meta"]["feed"]["source_as_of"] is None
        assert body["meta"]["feed"]["covered_window"] is None


@pytest.mark.asyncio
async def test_microstructure_leaves_old_cache_unused_and_does_not_cache_failed_reads(client, microstructure_store, monkeypatch):
    # Key and payload written by 7f1cdd6f, including a wrongly zoned naive clock.
    prior_key = "v:mi:" + md5(b"microstructure-availability:HPG:vwap:5m:7:0.7:2:3.0").hexdigest()
    prior_body = {"error": None, "data": {"vwap": {"points": [{"time": "2026-11-23T09:10:00+07:00"}]}},
                  "feed": {"status": "available", "source_as_of": "2026-11-23T09:13:46+07:00"}}
    entries = {prior_key: prior_body}

    async def store(key, value, *, ttl):
        assert ttl == 60
        entries[key] = value
        return True

    read_cache = AsyncMock(side_effect=entries.get)
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache.settings, "cache_backend", "redis")
    monkeypatch.setattr(cache.settings, "redis_url", "redis://fixture")
    monkeypatch.setattr(cache.redis_client, "_client", object())
    monkeypatch.setattr(cache.redis_client, "get_json", read_cache)
    monkeypatch.setattr(cache.redis_client, "set_json", store)
    read_ticks = microstructure_store.get_intraday_trades
    read_ticks.side_effect = [MongoReadError("timeout"), []]
    path = "/api/v1/microstructure/HPG?features=vwap"

    failure = await client.get(path)
    assert failure.status_code == 200 and failure.json()["meta"]["feed"]["status"] == "timeout"
    assert entries == {prior_key: prior_body}
    empty = await client.get(path)
    assert empty.status_code == 200 and empty.json()["meta"]["feed"]["status"] == "empty"
    assert empty.json()["meta"]["feed"]["source_as_of"] is None
    assert empty.json()["meta"]["trade_as_of_basis"] is None
    assert len(entries) == 2 and entries[prior_key] == prior_body
    keys_read = {call.args[0] for call in read_cache.await_args_list}
    assert keys_read == set(entries) - {prior_key}
    hit = await client.get(path)
    assert hit.status_code == 200 and hit.json()["meta"]["feed"] == empty.json()["meta"]["feed"]
    assert read_ticks.await_count == 2
