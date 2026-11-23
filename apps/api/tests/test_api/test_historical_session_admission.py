"""Read-side fixtures; never connect to a provider or amend retained records."""

import json
import os
from datetime import date, datetime, time, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from vnibb.api.v1 import equity
from vnibb.models.news import CompanyEvent
from vnibb.models.stock import Stock, StockPrice
from vnibb.services.mongo_market_data_service import MongoMarketDataService


@pytest.fixture(autouse=True)
def offline_history(monkeypatch):
    monkeypatch.setattr(equity.settings, "market_holiday_dates", [])
    monkeypatch.setattr(equity, "_load_historical_from_recent_cache", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        equity.VnstockEquityHistoricalFetcher, "fetch", AsyncMock(side_effect=TimeoutError("fixture timeout"))
    )
    monkeypatch.setattr(equity, "_schedule_critical_reinforcement", AsyncMock())


@pytest.fixture
def bypass_sql_cache(monkeypatch):
    # Exercise the distinct retained SQL fallback as well as the normal cache path.
    monkeypatch.setattr(
        equity.CacheManager, "get_historical_prices", AsyncMock(return_value=SimpleNamespace(hit=False))
    )


def retained_bar(day, unit="VND", **extra):
    return {
        "symbol": "XYZ", "tradeDate": datetime.combine(day, time.min), "priceUnit": unit,
        "open": 1000, "high": 1020, "low": 980, "close": 1000,
        "adjusted_close": 1000, "volume": 0, "price_source": "vietcap_vnd", **extra,
    }


def mount_retained_prices(monkeypatch, docs):
    collection = MagicMock()
    reader = MongoMarketDataService()
    monkeypatch.setattr(equity.settings, "mongodb_enabled", True)
    monkeypatch.setattr(equity.settings, "mongodb_url", "mongodb://fixture")
    # Each API read must traverse the same retained records again, including after SQL replacement.
    collection.find.return_value.sort.side_effect = lambda *_: iter(sorted(docs, key=lambda row: row["tradeDate"]))
    monkeypatch.setattr(reader, "_get_collection", lambda _: collection)
    monkeypatch.setattr(equity, "get_mongo_market_data_service", lambda: reader)


async def historical(client, start, end, *, adjustment="adjusted", interval="1D"):
    response = await client.get("/api/v1/equity/historical", params={
        "symbol": "XYZ", "start_date": start, "end_date": end,
        "interval": interval, "adjustment_mode": adjustment,
    })
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_retained_rejections_and_same_session_replacement(client, test_db, monkeypatch, bypass_sql_cache):
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
    assert payload["meta"]["unresolved_session_count"] is None
    assert payload["meta"]["unresolved_excluded_dates"] is None
    assert payload["meta"]["excluded_row_count"] == 0
    assert payload["error"]


@pytest.mark.asyncio
async def test_admission_counts_physical_candidates_and_ignores_closures(client, test_db, monkeypatch):
    start, friday = date(2026, 6, 8), date(2026, 6, 12)
    thursday = friday - timedelta(days=1)
    saturday = friday + timedelta(days=1)
    mount_retained_prices(monkeypatch, [
        retained_bar(start, "unknown", volume=None),
        retained_bar(start, close=100, open=100, high=100, low=90, adjusted_close=29),
        retained_bar(thursday, "unknown"),
        retained_bar(thursday, high=10),
        retained_bar(friday, interval="1W"),
        retained_bar(saturday, "unknown"),
    ])
    stock = Stock(symbol="XYZ", exchange="HOSE")
    test_db.add(stock)
    await test_db.flush()
    for day, source in [(start + timedelta(days=1), "legacy"), (thursday, "vietcap_vnd")]:
        test_db.add(StockPrice(
            stock_id=stock.id, symbol="XYZ", time=day, interval="1D", source=source,
            open=1000, high=1020, low=980, close=1000, adj_close=1000, volume=0,
        ))
    await test_db.commit()
    payload = await historical(client, start, saturday)
    meta = payload["meta"]
    assert meta["excluded_row_count"] == 4
    assert meta["excluded_dates"] == ["2026-06-08", "2026-06-09", "2026-06-11", "2026-06-13"]
    assert meta["replaced_excluded_dates"] == ["2026-06-08", "2026-06-11"]
    assert meta["unresolved_excluded_dates"] == ["2026-06-09"]
    assert meta["unresolved_session_count"] == 1
    assert meta["missing_interior_sessions"] == 2
    assert meta["missing_trailing_sessions"] == 1
    assert [row["time"] for row in payload["data"]] == ["2026-06-08", "2026-06-11"]
    assert payload["data"][0]["close"] == payload["data"][0]["high"] == 29


@pytest.mark.asyncio
async def test_index_points_are_not_back_adjusted(client, monkeypatch):
    day = date(2026, 6, 8)
    mount_retained_prices(monkeypatch, [
        retained_bar(day, "index_points", adjusted_close=500, symbol="VN30"),
    ])
    response = await client.get("/api/v1/equity/historical", params={
        "symbol": "VN30", "start_date": day, "end_date": day, "adjustment_mode": "adjusted",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["meta"]["session_basis"] == "not_applicable"
    assert body["meta"]["adjustment_requested_count"] == 0
    assert body["data"][0]["close"] == 1000
    assert body["data"][0]["adjustment_applied"] is False


@pytest.mark.asyncio
async def test_retained_action_prevents_certifying_identity_adjustments(client, test_db, monkeypatch):
    before, ex_date = date(2026, 6, 8), date(2026, 6, 9)
    mount_retained_prices(monkeypatch, [
        retained_bar(before),
        retained_bar(ex_date, open=500, high=510, low=490, close=500, adjusted_close=500),
    ])
    test_db.add(CompanyEvent(id=1, symbol="XYZ", event_type="stock split", event_date=ex_date, ex_date=ex_date))
    await test_db.commit()
    payload = await historical(client, before, ex_date)
    assert [row["close"] for row in payload["data"]] == [1000, 500]
    assert payload["meta"]["missing_session_count"] == 0
    assert payload["meta"]["session_basis"] == "unverified"


@pytest.mark.asyncio
async def test_admits_usable_same_store_alternative(client, monkeypatch):
    session = date(2026, 6, 8)
    mount_retained_prices(monkeypatch, [
        retained_bar(session, "unknown", volume=None, source="vietcap"),
        retained_bar(session, high=1, source="vietcap"),
        retained_bar(session, "vnstock-derived", source="vnstock-data"),
        retained_bar(session, "THOUSAND_VND", open=1, high=1.02, low=0.98, close=1, adjusted_close=1, source="vnstock-data"),
    ])
    payload = await historical(client, session, session)
    assert len(payload["data"]) == 1
    assert payload["data"][0]["close"] == 1000
    assert payload["meta"]["excluded_row_count"] == 2
    assert payload["meta"]["replaced_excluded_dates"] == [session.isoformat()]
    assert payload["meta"]["unresolved_session_count"] == 0
