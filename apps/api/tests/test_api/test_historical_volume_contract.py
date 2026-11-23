from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from vnibb.api.v1 import equity


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
