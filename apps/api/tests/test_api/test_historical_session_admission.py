"""Read-side fixtures; never connect to a provider or amend retained records."""

import json
import os
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from vnibb.api.v1 import equity
from vnibb.models.stock import Stock, StockPrice


@pytest.fixture(autouse=True)
def offline_history(monkeypatch):
    monkeypatch.setattr(equity.settings, "market_holiday_dates", [])
    monkeypatch.setattr(
        equity.CacheManager, "get_historical_prices", AsyncMock(return_value=SimpleNamespace(hit=False))
    )
    monkeypatch.setattr(equity, "_load_historical_from_recent_cache", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        equity.VnstockEquityHistoricalFetcher, "fetch", AsyncMock(side_effect=TimeoutError("fixture timeout"))
    )
    monkeypatch.setattr(equity, "_schedule_critical_reinforcement", AsyncMock())


def retained_bar(day, unit="VND", **extra):
    return {
        "symbol": "XYZ", "tradeDate": day.isoformat(), "priceUnit": unit,
        "open": 1000, "high": 1020, "low": 980, "close": 1000,
        "adjusted_close": 1000, "volume": 0, "price_source": "vietcap_vnd", **extra,
    }


def mount_retained_prices(monkeypatch, docs):
    reader = SimpleNamespace(enabled=True, get_eod_prices_between=AsyncMock(return_value=docs))
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: reader)


async def historical(client, start, end, *, adjustment="adjusted", interval="1D"):
    response = await client.get("/api/v1/equity/historical", params={
        "symbol": "XYZ", "start_date": start, "end_date": end,
        "interval": interval, "adjustment_mode": adjustment,
    })
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_retained_rejections_and_same_session_replacement(client, test_db, monkeypatch):
    start, end = date(2026, 6, 8), date(2026, 7, 31)
    hole = date(2026, 7, 1)
    weekdays = [start + timedelta(days=i) for i in range((end - start).days + 1)
                if (start + timedelta(days=i)).weekday() < 5]
    gap = date(2026, 7, 2)
    docs = [retained_bar(day) for day in weekdays if day not in {hole, gap}]
    docs.append(retained_bar(hole, "unknown"))
    docs.append(retained_bar(hole, "unknown", volume=100))
    docs.append(retained_bar(gap, open=1100, high=1120, low=990))
    mount_retained_prices(monkeypatch, docs)

    unresolved = await historical(client, start, end)
    meta = unresolved["meta"]
    assert meta["unit_status"] == "confirmed_vnd"
    assert meta["excluded_row_count"] == 2
    assert meta["replaced_excluded_dates"] == []
    assert meta["unresolved_excluded_dates"] == [hole.isoformat()]
    assert meta["unresolved_session_count"] == 1
    assert meta["expected_session_dates"] == [day.isoformat() for day in weekdays]
    assert meta["missing_interior_sessions"] == meta["missing_session_count"] == 1
    assert meta["missing_leading_sessions"] == meta["missing_trailing_sessions"] == 0
    assert len(unresolved["data"]) == 39
    assert unresolved["data"][0]["volume"] == 0

    stock = Stock(symbol="XYZ", exchange="HOSE")
    test_db.add(stock)
    await test_db.flush()
    test_db.add(StockPrice(
        stock_id=stock.id, symbol="XYZ", time=hole, interval="1D", source="vietcap_vnd",
        open=1000, high=1020, low=980, close=1000, adj_close=1000, volume=0,
    ))
    await test_db.commit()
    replaced = await historical(client, start, end)
    meta = replaced["meta"]
    assert meta["excluded_row_count"] == 2
    assert meta["replaced_excluded_dates"] == [hole.isoformat()]
    assert meta["unresolved_excluded_dates"] == []
    assert meta["unresolved_session_count"] == meta["missing_session_count"] == 0
    assert meta["calendar_verified"] is True
    assert meta["session_basis"] == "adjusted"
    assert meta["completeness_status"] == "complete"
    assert meta["source_counts"] == {"mongo": 39, "db": 1}
    assert len(replaced["data"]) == 40

    # Keep the transport seam executable: Jest reads this exact serialized route output.
    if replay_path := os.environ.get("VNIBB_HISTORY_CONTRACT_REPLAY"):
        Path(replay_path).write_text(json.dumps({"unresolved": unresolved, "replaced": replaced}), encoding="utf-8")


@pytest.mark.asyncio
async def test_expected_closures_boundary_holes_and_mixed_basis(client, monkeypatch):
    # Thu Apr 30 and Fri May 1 are published closures; May 2–3 is a weekend.
    mount_retained_prices(monkeypatch, [
        retained_bar(date(2026, 4, 29)),
        retained_bar(date(2026, 5, 4), adjusted_close=None),
    ])
    payload = await historical(client, date(2026, 4, 28), date(2026, 5, 5))
    meta = payload["meta"]
    assert meta["expected_session_dates"] == ["2026-04-28", "2026-04-29", "2026-05-04", "2026-05-05"]
    assert meta["calendar_verified"] is True
    assert meta["missing_leading_sessions"] == meta["missing_trailing_sessions"] == 1
    assert meta["missing_interior_sessions"] == 0
    assert meta["unresolved_session_count"] == 0
    assert meta["session_basis"] == "mixed"


@pytest.mark.asyncio
@pytest.mark.parametrize("interval,year", [("1D", 2025), ("1W", 2026)])
async def test_only_verified_daily_ranges_expose_expected_sessions(client, monkeypatch, interval, year):
    mount_retained_prices(monkeypatch, [])
    payload = await historical(client, date(year, 6, 8), date(year, 6, 9), interval=interval)
    assert payload["meta"]["expected_session_dates"] is None
    assert payload["meta"]["calendar_verified"] is (None if interval == "1W" else False)
    assert payload["meta"]["missing_session_count"] is None
    assert payload["meta"]["excluded_row_count"] == 0
    assert payload["error"]
