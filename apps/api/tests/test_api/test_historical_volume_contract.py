from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from vnibb.api.v1 import equity
from vnibb.models.stock import StockPrice
from vnibb.services.cache_manager import CacheResult


@pytest.mark.asyncio
@pytest.mark.parametrize("read_source", ["retained", "provider"])
async def test_history_keeps_prices_without_a_valid_volume(client, monkeypatch, read_source):
    start = date(2026, 6, 8)
    omitted = object()
    raw_volumes = [
        omitted, None, 0, 120.0, "125.0", -1, True, 1.5,
        float("nan"), float("inf"), "unknown", "1.0000000000000001",
    ]
    sessions = [start + timedelta(days=offset) for offset in range(16)
                if (start + timedelta(days=offset)).weekday() < 5]
    docs = [
        {
            "symbol": "XYZ", "time": day.isoformat(), "price_unit": "VND",
            "open": 100, "high": 110, "low": 90, "close": 95,
            **({} if volume is omitted else {"volume": volume}),
        }
        for day, volume in zip(sessions, raw_volumes, strict=True)
    ]
    fetch = AsyncMock(return_value=docs if read_source == "provider" else [])

    monkeypatch.setattr(equity.settings, "market_holiday_dates", [])
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: SimpleNamespace(
        enabled=True,
        get_eod_prices_between=AsyncMock(return_value=docs if read_source == "retained" else []),
    ))
    monkeypatch.setattr(equity.CacheManager, "get_historical_prices", AsyncMock(
        return_value=SimpleNamespace(hit=False, data=None),
    ))
    monkeypatch.setattr(equity, "_load_historical_from_recent_cache", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity, "_load_historical_from_db", AsyncMock(return_value=[]))
    monkeypatch.setattr(equity.VnstockEquityHistoricalFetcher, "extract_data", fetch)
    monkeypatch.setattr(equity, "_schedule_critical_reinforcement", AsyncMock())

    response = await client.get("/api/v1/equity/historical", params={
        "symbol": "XYZ", "start_date": start.isoformat(), "end_date": sessions[-1].isoformat(),
    })

    assert response.status_code == 200
    assert response.json()["error"] is None
    rows = response.json()["data"]
    assert [row["time"] for row in rows] == [day.isoformat() for day in sessions]
    assert all(row["price_unit"] == "VND" and row["close"] == 95 for row in rows)
    assert [row["volume"] for row in rows] == [None, None, 0, 120, 125] + [None] * 7
    assert type(rows[2]["volume"]) is int
    if read_source == "provider":
        fetch.assert_awaited_once()
    else:
        fetch.assert_not_awaited()


_DAY = date(2026, 6, 8)
_OHLC = {"open": 100_000, "high": 110_000, "low": 90_000, "close": 95_000}
_REQUEST = {"symbol": "XYZ", "start_date": _DAY.isoformat(), "end_date": _DAY.isoformat()}


def _mongo_bar(**overrides):
    return {
        "symbol": "XYZ",
        "tradeDate": _DAY.isoformat(),
        "priceUnit": "VND",
        "providerSource": "vietcap",
        "volume": None,
        "value": 500,
        **_OHLC,
        **overrides,
    }


def _cache_bar(**overrides):
    return StockPrice(**{
        "symbol": "XYZ",
        "time": _DAY,
        "interval": "1D",
        "source": "vnstock_vnd:VCI",
        "volume": 100,
        "value": 800,
        **_OHLC,
        **overrides,
    })


def _stub_stored_history(monkeypatch, mongo_rows, cache_rows, *, recent_rows=None):
    mongo = SimpleNamespace(enabled=True, get_eod_prices_between=AsyncMock(return_value=mongo_rows))
    cache = CacheResult(data=cache_rows, hit=True, is_stale=False, cached_at=None)
    provider = AsyncMock(side_effect=AssertionError("Covered price bars must not trigger acquisition"))
    monkeypatch.setattr(equity.settings, "market_holiday_dates", [])
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: mongo)
    monkeypatch.setattr(equity.CacheManager, "get_historical_prices", AsyncMock(return_value=cache))
    monkeypatch.setattr(equity.redis_client, "get_json", AsyncMock(return_value=recent_rows))
    monkeypatch.setattr(equity.VnstockEquityHistoricalFetcher, "fetch", provider)
    return provider


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mongo_fields", "cache_row", "adjustment_mode", "expected_volume", "volume_source"),
    [
        pytest.param(
            {},
            _cache_bar(source="VCI", open=100, high=110, low=90, close=95, volume=0),
            "raw", 0, "vnstock_history:VCI", id="canonicalized-zero",
        ),
        pytest.param({}, _cache_bar(adj_close=90_000), "raw", 100, "vnstock_vnd:VCI", id="positive"),
        pytest.param({"volume": 0}, _cache_bar(), "raw", 0, None, id="winner-zero"),
        pytest.param({}, _cache_bar(open=101_000), "raw", None, None, id="different-open"),
        pytest.param({}, _cache_bar(symbol="ABC"), "raw", None, None, id="different-symbol"),
        pytest.param({}, _cache_bar(volume=-1), "raw", None, None, id="invalid-volume"),
        pytest.param({}, _cache_bar(source="vnstock"), "raw", None, None, id="uncertified-unit"),
        pytest.param(
            {}, _cache_bar(source="vnstock_points:VCI"), "raw", None, None, id="wrong-unit",
        ),
        pytest.param(
            {"adjClose": 95_000}, _cache_bar(adj_close=95_000),
            "adjusted", 100, "vnstock_vnd:VCI", id="matching-adjustment",
        ),
        pytest.param(
            {}, _cache_bar(adj_close=95_000), "adjusted", None, None, id="raw-vs-adjusted-identity",
        ),
        pytest.param(
            {"adjClose": 95_000},
            _cache_bar(open=200_000, high=220_000, low=180_000, close=190_000, adj_close=95_000),
            "adjusted", None, None, id="same-adjusted-prices-different-raw-basis",
        ),
    ],
)
async def test_history_preserves_volume_only_for_the_same_bar(
    client, monkeypatch, mongo_fields, cache_row, adjustment_mode, expected_volume, volume_source
):
    provider = _stub_stored_history(monkeypatch, [_mongo_bar(**mongo_fields)], [cache_row])

    response = await client.get(
        "/api/v1/equity/historical", params={**_REQUEST, "adjustment_mode": adjustment_mode}
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] is None
    (row,) = payload["data"]
    assert row["symbol"] == "XYZ" and row["time"] == _DAY.isoformat()
    assert {field: row[field] for field in _OHLC} == _OHLC
    assert row["price_unit"] == "VND" and row["price_source"] == "vietcap"
    assert row["value"] == 500 and row["raw_close"] == 95_000
    assert row["adjusted_close"] == mongo_fields.get("adjClose")
    assert row["adjustment_mode"] == adjustment_mode
    assert row["adjustment_applied"] is ("adjClose" in mongo_fields)
    assert row["volume"] == expected_volume
    assert row.get("volume_source") == volume_source
    assert row.get("volume_resolution_source") == ("cache" if volume_source else None)
    assert payload["meta"]["source_counts"] == {"mongo": 1}
    assert payload["meta"]["source_mode"] == "mongo"
    assert payload["meta"]["fallback_used"] is False
    provider.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("reverse_recent", [False, True])
async def test_history_volume_donor_order_and_reader_fallback(client, monkeypatch, reverse_recent):
    second_day = "2026-06-09"
    third_day = "2026-06-10"
    fourth_day = "2026-06-11"
    recent_bar = {"price_unit": "VND", **_OHLC}
    recent_rows = [
        {**recent_bar, "time": _DAY.isoformat(), "volume": 90},
        {**recent_bar, "time": second_day, "volume": 30},
        {**recent_bar, "time": second_day, "volume": 17},
        {**recent_bar, "time": fourth_day, "volume": 45},
    ]
    provider = _stub_stored_history(
        monkeypatch,
        [_mongo_bar(), _mongo_bar(tradeDate=second_day), _mongo_bar(tradeDate=third_day)],
        [_cache_bar(volume=100)],
        recent_rows=recent_rows[::-1] if reverse_recent else recent_rows,
    )

    response = await client.get("/api/v1/equity/historical", params={**_REQUEST, "end_date": fourth_day})

    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] is None
    first, second, third, fourth = payload["data"]
    assert (first["time"], first["volume"], first["volume_resolution_source"]) == (
        _DAY.isoformat(), 100, "cache",
    )
    assert (second["time"], second["volume"], second["volume_source"], second["volume_resolution_source"]) == (
        second_day, 17, "recent_cache", "recent_cache",
    )
    assert first["price_source"] == second["price_source"] == "vietcap"
    assert (third["time"], third["volume"], third.get("volume_source")) == (third_day, None, None)
    assert (fourth["time"], fourth["volume"]) == (fourth_day, 45)
    assert payload["meta"]["source_counts"] == {"mongo": 3, "recent_cache": 1}
    provider.assert_not_awaited()
