"""
RED-phase tests for /api/v1/market/heatmap daily-change preservation.

Bug: _normalize_screener_row() never reads ``change_1d`` (only
``price_change_1d_pct`` / ``change_pct`` / …), and the cached ORM→ScreenerData
conversion (lines ~2506-2521 of market.py) does not forward extended_metrics.
Both paths silently drop the daily change so the heatmap always shows 0 %.

These tests assert the CORRECT behaviour and are expected to FAIL until
market.py is fixed.
"""

from datetime import date, datetime

import pytest

from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.equity_screener import ScreenerData
from vnibb.services.cache_manager import CacheResult


@pytest.mark.asyncio
async def test_heatmap_preserves_change_1d_from_provider_screener_data(client, monkeypatch):
    """ScreenerData(change_1d=3.2, price=100) → heatmap stock change_pct==3.2, change==3.2."""
    # ---- mocks ----
    async def _fake_cache_miss(*args, **kwargs):
        return CacheResult(data=None, is_stale=False, cached_at=None, hit=False)

    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        _fake_cache_miss,
    )

    async def _fake_db_rows(limit=500):
        return []

    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_screener_rows_from_db",
        _fake_db_rows,
    )

    async def _fake_fetch(params):
        return [
            ScreenerData(
                symbol="VNM",
                organ_name="Vinamilk",
                exchange="HOSE",
                industry_name="Food",
                price=100.0,
                change_1d=3.2,
                price_unit="VND",
                market_cap=150_000_000_000.0,
                volume=1_000_000,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockScreenerFetcher.fetch",
        _fake_fetch,
    )

    # Isolate enrichment: no DB metadata or change_map to override our test data
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))

    # ---- act ----
    response = await client.get(
        "/api/v1/market/heatmap?use_cache=false&limit=10&exchange=ALL"
    )
    assert response.status_code == 200

    payload = response.json()
    assert payload["count"] > 0, "heatmap should contain at least one stock"

    # ---- assert ----
    vnm_stock = _find_stock(payload, "VNM")
    assert vnm_stock is not None, "VNM should appear in heatmap response"

    # These assertions describe the CORRECT behaviour.
    # They FAIL until _normalize_screener_row (or the cache-conversion path)
    # learns to read ``change_1d``.
    assert (
        vnm_stock["change_pct"] == 3.2
    ), f"Expected change_pct=3.2 but got {vnm_stock['change_pct']}"
    assert (
        vnm_stock["change"] == 3.2
    ), f"Expected change=3.2 (100 * 3.2/100) but got {vnm_stock['change']}"


@pytest.mark.asyncio
async def test_heatmap_preserves_change_1d_from_cached_snapshot(client, monkeypatch):
    """Cached SreenerSnapshot w/ extended_metrics={'change_1d': 4.5} → change_pct==4.5, cached==True."""
    # ---- mocks ----
    snapshot = ScreenerSnapshot(
        symbol="VNM",
        snapshot_date=date.today(),
        company_name="Vinamilk",
        exchange="HOSE",
        industry="Food",
        price=100.0,
        volume=1_000_000,
        market_cap=150_000_000_000.0,
        pe=15.0,
        pb=3.0,
        extended_metrics={"change_1d": 4.5, "price_unit": "VND"},
        source="KBS",
    )

    async def _fake_cache_hit(*args, **kwargs):
        return CacheResult(
            data=[snapshot],
            is_stale=False,
            cached_at=datetime.utcnow(),
            hit=True,
        )

    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        _fake_cache_hit,
    )

    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))

    # ---- act ----
    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL")
    assert response.status_code == 200

    payload = response.json()
    assert payload["cached"] is True, "response should be flagged as cached"
    assert payload["count"] > 0, "heatmap should contain at least one stock"

    # ---- assert ----
    vnm_stock = _find_stock(payload, "VNM")
    assert vnm_stock is not None, "VNM should appear in heatmap response"

    # These assertions describe the CORRECT behaviour.
    # They FAIL until the ORM → ScreenerData conversion in get_heatmap_data
    # reads extended_metrics.change_1d (or _normalize_screener_row handles it).
    assert (
        vnm_stock["change_pct"] == 4.5
    ), f"Expected change_pct=4.5 but got {vnm_stock['change_pct']}"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

async def _async(val):
    """Wrap a plain value so it can be ``await`` ed (sync → coroutine)."""
    return val

def _find_stock(payload: dict, symbol: str) -> dict | None:
    """Return the first heatmap stock dict matching *symbol*."""
    for sector in payload.get("sectors", []):
        for stock in sector.get("stocks", []):
            if stock.get("symbol") == symbol:
                return stock
    return None


@pytest.mark.parametrize(
    ("source", "close", "expected_close"),
    [("vnstock_vnd:KBS", 32_000.0, 32_000.0), ("VCI", 32.0, 32_000.0),
     ("vnstock", 32.0, None), ("ohlcv_backfill_full", 32_000.0, None)],
)
def test_money_flow_frame_requires_source_backed_currency(source, close, expected_close):
    from vnibb.api.v1.market import _canonical_price_frame
    from vnibb.models.stock import StockPrice

    frame = _canonical_price_frame([StockPrice(symbol="VCI", time=date.today(), close=close, source=source)])
    if expected_close is None:
        assert frame.empty
    else:
        assert frame.iloc[0]["close"] == expected_close


def test_money_flow_frame_preserves_index_points():
    from vnibb.api.v1.market import _canonical_price_frame
    from vnibb.models.stock import StockPrice

    frame = _canonical_price_frame([StockPrice(symbol="VNINDEX", time=date.today(), close=1250, source="KBS")])
    assert frame.iloc[0]["close"] == 1250


@pytest.mark.asyncio
async def test_daily_change_normalizes_each_persisted_source(test_engine, test_db, monkeypatch):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1.market import _load_change_pct_map
    from vnibb.models.stock import Stock, StockPrice

    stock_ids = {"VCI": 1, "FPT": 2}
    test_db.add_all([Stock(id=sid, symbol=sym) for sym, sid in stock_ids.items()])
    rows = [
        ("VCI", "KBS", date(2026, 9, 1), 32.0),
        ("VCI", "vnstock_vnd:KBS", date(2026, 9, 2), 35_200.0),
        ("FPT", "KBS", date(2026, 9, 1), 100.0),
        ("FPT", "vnstock", date(2026, 9, 2), 110.0),
    ]
    for price_id, (symbol, source, day, close) in enumerate(rows, start=1):
        test_db.add(StockPrice(id=price_id, symbol=symbol, stock_id=stock_ids[symbol], time=day, interval="1D", source=source,
                               open=close, high=close, low=close, close=close, volume=100))
    await test_db.commit()
    monkeypatch.setattr("vnibb.api.v1.market.async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    assert await _load_change_pct_map(["VCI", "FPT"]) == {"VCI": pytest.approx(10.0)}


@pytest.mark.asyncio
async def test_breadth_range_and_sma_use_only_canonical_history(test_engine, test_db, monkeypatch):
    from datetime import timedelta
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1.market import _load_52_week_range_map, _load_latest_technical_indicator_map
    from vnibb.models.stock import Stock, StockPrice

    test_db.add(Stock(id=1, symbol="VCI"))
    for offset in range(50):
        legacy = offset < 25
        close = 32.0 if legacy else 32_000.0
        test_db.add(StockPrice(id=offset + 1, symbol="VCI", stock_id=1, time=date.today() - timedelta(days=offset + 1),
                               interval="1D", source="KBS" if legacy else "vnstock_vnd:KBS",
                               open=close, high=close, low=close, close=close, volume=100))
    test_db.add(StockPrice(id=51, symbol="VCI", stock_id=1, time=date.today(), interval="1D", source="vnstock",
                           open=1, high=999_999, low=1, close=1, volume=100))
    await test_db.commit()
    monkeypatch.setattr("vnibb.api.v1.market.async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    assert await _load_52_week_range_map(["VCI"]) == {"VCI": {"high_52w": 32_000.0, "low_52w": 32_000.0}}
    indicators = await _load_latest_technical_indicator_map(["VCI"])
    assert indicators["VCI"]["sma_20"] == 32_000.0
    assert indicators["VCI"]["sma_50"] == 32_000.0


@pytest.mark.parametrize("unit,expected_price", [("THOUSAND_VND", 32_000), ("VND", 32), ("unknown", None)])
def test_screener_prices_preserve_declared_units(unit, expected_price):
    from vnibb.api.v1.market import _normalize_screener_row

    row = _normalize_screener_row({"symbol": "VCI", "price": 32, "extended_metrics": {"price_unit": unit}})
    assert row["price"] == expected_price
    assert row["price_unit"] == ("unknown" if unit == "unknown" else "VND")


@pytest.mark.asyncio
async def test_daily_change_snapshot_fallback_retains_unit_metadata(test_engine, test_db, monkeypatch):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1.market import _load_change_pct_map

    test_db.add_all([
        ScreenerSnapshot(symbol="VCI", snapshot_date=date(2026, 9, 1), price=32,
                         extended_metrics={"price_unit": "THOUSAND_VND"}),
        ScreenerSnapshot(symbol="VCI", snapshot_date=date(2026, 9, 2), price=35_200,
                         extended_metrics={"price_unit": "VND"}),
        ScreenerSnapshot(symbol="FPT", snapshot_date=date(2026, 9, 1), price=100),
        ScreenerSnapshot(symbol="FPT", snapshot_date=date(2026, 9, 2), price=110),
    ])
    await test_db.commit()
    monkeypatch.setattr("vnibb.api.v1.market.async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    assert await _load_change_pct_map(["VCI", "FPT"]) == {"VCI": pytest.approx(10.0)}


def test_snapshot_mover_price_replacement_does_not_reuse_other_unit_change():
    from vnibb.api.v1.market import _apply_snapshot_metrics_to_movers

    result = _apply_snapshot_metrics_to_movers(
        [{"symbol": "VCI", "last_price": None, "price_change": 3.2}],
        {"VCI": {"price": 35_200.0, "price_unit": "VND", "change_pct": 10.0}},
    )
    assert result[0]["last_price"] == 35_200.0
    assert result[0]["price_change"] == pytest.approx(3_200.0)
    assert result[0]["price_unit"] == "VND"


@pytest.mark.asyncio
async def test_last_session_movers_normalize_sources_and_exclude_unknown(test_engine, test_db, monkeypatch):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1.market import _build_last_session_top_movers
    from vnibb.models.stock import Stock, StockPrice

    for index in range(10):
        symbol = f"T{index:02}"
        test_db.add(Stock(id=index + 1, symbol=symbol, exchange="HOSE"))
        for day_index, (day, close, source) in enumerate([
            (date(2026, 9, 1), 32.0, "KBS"),
            (date(2026, 9, 2), 35_200.0, "vnstock_vnd:KBS" if index else "vnstock"),
        ]):
            test_db.add(StockPrice(id=index * 2 + day_index + 1, symbol=symbol, stock_id=index + 1, time=day, interval="1D", source=source,
                                   open=close, high=close, low=close, close=close, volume=100))
    await test_db.commit()
    monkeypatch.setattr("vnibb.api.v1.market.async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    result = await _build_last_session_top_movers("VNINDEX", "gainer", 20)
    assert len(result) == 9
    assert all(row["symbol"] != "T00" for row in result)
    assert all(row["last_price"] == 35_200.0 and row["price_unit"] == "VND" for row in result)
    assert all(row["price_change"] == 3_200.0 and row["price_change_pct"] == 10.0 for row in result)
