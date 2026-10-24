"""Retained movers follow completed configured market sessions, not server dates."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.api.v1 import market
from vnibb.models.stock import Stock, StockPrice


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "instant,observed,holidays,close_time,market_timezone,is_stale",
    [
        ("2026-10-19T00:30:00+00:00", "2026-10-16", [], "14:30", "Asia/Ho_Chi_Minh", False),
        ("2026-10-20T07:29:59+00:00", "2026-10-19", [], "14:30", "Asia/Ho_Chi_Minh", False),
        ("2026-10-20T07:30:00+00:00", "2026-10-19", [], "14:30", "Asia/Ho_Chi_Minh", True),
        ("2026-10-20T07:45:00+00:00", "2026-10-19", [], "15:00", "Asia/Ho_Chi_Minh", False),
        ("2026-10-24T03:00:00+00:00", "2026-10-23", [], "14:30", "Asia/Ho_Chi_Minh", False),
        ("2026-10-26T09:00:00+00:00", "2026-10-23", ["2026-10-26"], "14:30", "Asia/Ho_Chi_Minh", False),
        ("2026-10-27T00:30:00+00:00", "2026-10-23", ["2026-10-26"], "14:30", "Asia/Ho_Chi_Minh", False),
        ("2026-10-27T07:30:00+00:00", "2026-10-23", ["2026-10-26"], "14:30", "Asia/Ho_Chi_Minh", True),
        ("2026-10-23T15:00:00+00:00", "2026-10-22", [], "14:30", "America/New_York", False),
    ],
    ids=[
        "monday-premarket", "before-close", "at-close", "configured-close",
        "weekend", "configured-holiday", "after-holiday-premarket",
        "after-holiday-close", "configured-timezone",
    ],
)
async def test_public_retained_movers_follow_completed_session(
    client, test_db, test_engine, monkeypatch, instant, observed,
    holidays, close_time, market_timezone, is_stale,
):
    clock = datetime.fromisoformat(instant)
    session_day = date.fromisoformat(observed)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock.astimezone(tz) if tz else clock.replace(tzinfo=None)

        @classmethod
        def utcnow(cls):
            return clock.astimezone(UTC).replace(tzinfo=None)

    class FrozenDate(date):
        @classmethod
        def today(cls):
            return clock.date()

    monkeypatch.setattr(market, "datetime", FrozenDateTime)
    monkeypatch.setattr(market, "date", FrozenDate)
    monkeypatch.setattr(market.settings, "vn_timezone", market_timezone)
    monkeypatch.setattr(market.settings, "intraday_market_close", close_time)
    monkeypatch.setattr(market.settings, "market_holiday_dates", holidays)
    monkeypatch.setattr(
        market, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False)
    )

    async def provider(**kwargs):
        raise AssertionError("Retained sessions must not start a provider refresh")

    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", provider)
    for index in range(10):
        symbol = f"T{index:02}"
        test_db.add(Stock(id=index + 1, symbol=symbol, exchange="HOSE"))
        close = 35_200.0 if index % 2 or index == 0 else 28_800.0
        for offset, (day, price, source) in enumerate([
            (session_day - timedelta(days=1), 32.0, "KBS"),
            (session_day, close, "vietcap_vnd" if index else "vnstock"),
        ]):
            test_db.add(StockPrice(
                id=index * 2 + offset + 1, symbol=symbol, stock_id=index + 1,
                time=day, interval="1D", source=source,
                open=price, high=price, low=price, close=price,
                volume=100 + index, value=close * (100 + index),
            ))
    await test_db.commit()

    response = await client.get(
        "/api/v1/market/top-movers?type=gainer&index=VNINDEX&limit=20"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_stale"] is is_stale
    assert payload["is_last_session"] is True
    assert payload["session_label"] == observed
    assert payload["updated_at"] == f"{observed}T00:00:00"
    assert payload["source"] == "vietcap_vnd"
    assert payload["error"] is None
    assert payload["count"] == 5
    assert {row["symbol"] for row in payload["data"]} == {"T01", "T03", "T05", "T07", "T09"}
    for row in payload["data"]:
        index = int(row["symbol"][1:])
        assert index != 0  # Unknown source units remain inadmissible.
        assert row["last_price"] == (35_200.0 if index % 2 else 28_800.0)
        assert row["price_change"] == (3_200.0 if index % 2 else -3_200.0)
        assert row["price_change_pct"] == (10.0 if index % 2 else -10.0)
        assert row["price_unit"] == "VND"
        assert row["source"] == "vietcap_vnd"
        assert row["price_source"] is None
        assert row["volume"] == 100 + index
        assert row["value"] == row["last_price"] * (100 + index)
        assert row["is_stale"] is is_stale
        assert row["is_last_session"] is True
        assert row["session_label"] == observed
        assert row["updated_at"] == observed
