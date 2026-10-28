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
        "/api/v1/market/heatmap?use_cache=false&limit=10&exchange=ALL&size_metric=volume"
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
    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL&size_metric=volume")
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



@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("size_metric", "expected_count"),
    [("market_cap", 0), ("volume", 1), ("value_traded", 0)],
)
async def test_heatmap_quote_volume_cannot_become_missing_size_metric(
    client, monkeypatch, size_metric, expected_count
):
    async def quote_only_provider(params):
        return [ScreenerData(
            symbol="VNM", exchange="HOSE", price=100_000.0,
            price_unit="VND", volume=1_000_000,
        )]

    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_screener_rows_from_db",
        lambda **kwargs: _async([]),
    )
    monkeypatch.setattr("vnibb.api.v1.market.VnstockScreenerFetcher.fetch", quote_only_provider)
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_price_time", lambda _syms: _async(None))

    response = await client.get(
        "/api/v1/market/heatmap?use_cache=false&limit=10&exchange=ALL"
        f"&size_metric={size_metric}"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["size_metric"] == size_metric
    assert payload["count"] == expected_count
    if size_metric == "volume":
        stock = _find_stock(payload, "VNM")
        assert stock is not None
        assert stock["market_cap"] is None
        assert stock["market_cap_provenance"]["status"] == "unavailable"
        assert stock["size_value"] == stock["volume"] == 1_000_000
        assert payload["sectors"][0]["total_market_cap"] is None
        assert payload["sectors"][0]["total_size_value"] == 1_000_000
        assert payload["sectors"][0]["cap_count"] == 0
    else:
        assert payload["sectors"] == []

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


@pytest.mark.asyncio
@pytest.mark.parametrize("mover_type", ["gainer", "loser", "volume", "value"])
@pytest.mark.parametrize("provider_state", ["held", "error", "timeout"])
async def test_market_movers_serve_retained_without_starting_provider(
    client, test_engine, test_db, monkeypatch, mover_type, provider_state
):
    import asyncio

    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1 import market
    from vnibb.models.stock import Stock, StockPrice

    for index in range(10):
        symbol = f"T{index:02}"
        test_db.add(Stock(id=index + 1, symbol=symbol, exchange="HOSE"))
        for offset, (day, close) in enumerate([
            (date(2026, 9, 1), 100_000.0),
            (date(2026, 9, 2), 110_000.0 if index % 2 else 90_000.0),
        ]):
            test_db.add(StockPrice(
                id=index * 2 + offset + 1, symbol=symbol, stock_id=index + 1,
                time=day, interval="1D", source="vietcap_vnd" if index else "vnstock",
                open=close, high=close, low=close, close=close,
                volume=100 + index, value=close * (100 + index),
            ))
    await test_db.commit()
    monkeypatch.setattr(
        market, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False)
    )
    calls = []

    async def provider(*, type, index, limit):
        calls.append(type)
        if provider_state == "held":
            await asyncio.Event().wait()
        if provider_state == "error":
            raise RuntimeError("Primary provider unavailable")
        if provider_state == "timeout":
            raise TimeoutError()
        raise AssertionError("Retained observations must not start a provider refresh")

    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", provider)
    async with asyncio.timeout(0.75):
        response = await client.get(
            f"/api/v1/market/top-movers?type={mover_type}&index=VNINDEX&limit=3"
        )

    assert response.status_code == 200
    assert calls == []
    payload = response.json()
    assert payload["count"] == 3
    assert payload["is_last_session"] is True
    assert payload["session_label"] == "2026-09-02"
    assert payload["updated_at"] == "2026-09-02T00:00:00"
    assert payload["error"] is None
    assert payload["source"] == "vietcap_vnd"
    assert payload["is_stale"] is True
    for row in payload["data"]:
        assert row["symbol"] != "T00"
        assert row["price_unit"] == "VND"
        assert row["source"] == "vietcap_vnd"
        assert row["is_stale"] is True
        assert row["last_price"] in {90_000.0, 110_000.0}
        assert row["price_change_pct"] == pytest.approx(10.0 if int(row["symbol"][1:]) % 2 else -10.0)
        assert row["is_last_session"] is True
        assert row["session_label"] == "2026-09-02"
    if mover_type == "gainer":
        assert all(row["price_change_pct"] > 0 for row in payload["data"])
    elif mover_type == "loser":
        assert all(row["price_change_pct"] < 0 for row in payload["data"])
    else:
        values = [row[mover_type] for row in payload["data"]]
        assert values == sorted(values, reverse=True)


@pytest.mark.asyncio
async def test_market_movers_keep_provider_error_when_retained_prices_are_unavailable(
    client, test_engine, monkeypatch
):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1 import market

    calls = []

    async def provider(**kwargs):
        calls.append(kwargs["type"])
        raise RuntimeError("Primary provider unavailable")

    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", provider)
    monkeypatch.setattr(
        market, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False)
    )
    response = await client.get("/api/v1/market/top-movers?type=gainer&index=VNINDEX&limit=3")

    assert response.status_code == 200
    assert calls == ["gainer"]
    payload = response.json()
    assert payload["data"] == []
    assert payload["count"] == 0
    assert payload["error"] == "Primary provider unavailable"
    assert payload["is_last_session"] is False
    assert payload["session_label"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("mover_type", ["volume", "value"])
@pytest.mark.parametrize("membership_available", [True, False])
async def test_market_retained_vn30_movers_exclude_higher_ranked_nonmembers(
    client, test_engine, test_db, monkeypatch, mover_type, membership_available
):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1 import market
    from vnibb.models.stock import Stock, StockPrice

    for stock_index, symbol in enumerate(["VNM", *[f"X{i:02}" for i in range(9)]]):
        test_db.add(Stock(
            id=stock_index + 1, symbol=symbol,
            exchange="HOSE" if stock_index % 2 == 0 else "HNX",
        ))
        volume = 100 if symbol == "VNM" else 1_000_000
        for offset, (day, close) in enumerate([
            (date(2026, 9, 1), 100_000.0),
            (date(2026, 9, 2), 110_000.0),
        ]):
            test_db.add(StockPrice(
                id=stock_index * 2 + offset + 1, symbol=symbol, stock_id=stock_index + 1,
                time=day, interval="1D", source="vietcap_vnd",
                open=close, high=close, low=close, close=close,
                volume=volume, value=close * volume,
            ))
    await test_db.commit()

    async def unavailable_provider(**kwargs):
        raise RuntimeError("Primary provider unavailable")

    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", unavailable_provider)
    monkeypatch.setattr(
        market, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False)
    )
    if not membership_available:
        monkeypatch.delitem(market.VN_SECTORS, "vn30")
    response = await client.get(
        f"/api/v1/market/top-movers?type={mover_type}&index=VN30&limit=1"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["index"] == "VN30"
    if not membership_available:
        assert payload["data"] == []
        assert payload["count"] == 0
        assert payload["error"] == "Primary provider unavailable"
        assert payload["is_last_session"] is False
        return
    assert payload["count"] == 1
    assert [row["symbol"] for row in payload["data"]] == ["VNM"]
    assert payload["data"][0]["volume"] == 100
    assert payload["data"][0]["value"] == 11_000_000.0
    assert payload["data"][0]["price_unit"] == "VND"
    assert payload["is_last_session"] is True
    assert payload["session_label"] == "2026-09-02"

    broader = await client.get(
        f"/api/v1/market/top-movers?type={mover_type}&index=VNINDEX&limit=1"
    )
    assert broader.status_code == 200
    assert broader.json()["data"][0]["symbol"] != "VNM"
    assert broader.json()["data"][0]["volume"] == 1_000_000


@pytest.mark.asyncio
@pytest.mark.parametrize("mover_type", ["volume", "value"])
@pytest.mark.parametrize("selected_session_available", [True, False])
async def test_market_retained_movers_do_not_relabel_older_ranked_observations(
    client, test_engine, test_db, monkeypatch, mover_type, selected_session_available
):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1 import market
    from vnibb.models.stock import Stock, StockPrice

    price_id = 1
    for stock_index, symbol in enumerate([*[f"H{i:02}" for i in range(10)], "OLD", "VNM"]):
        test_db.add(Stock(
            id=stock_index + 1, symbol=symbol,
            exchange="HNX" if stock_index < 10 else "HOSE",
        ))
        if symbol == "VNM" and not selected_session_available:
            continue
        days = (
            [date(2026, 8, 31), date(2026, 9, 1)]
            if symbol == "OLD" else [date(2026, 9, 1), date(2026, 9, 2)]
        )
        volume = 1_000_000 if symbol == "OLD" else 100
        for day, close in zip(days, [100_000.0, 110_000.0], strict=True):
            test_db.add(StockPrice(
                id=price_id, symbol=symbol, stock_id=stock_index + 1,
                time=day, interval="1D", source="vietcap_vnd",
                open=close, high=close, low=close, close=close,
                volume=volume, value=close * volume,
            ))
            price_id += 1
    await test_db.commit()

    async def unavailable_provider(**kwargs):
        raise RuntimeError("Primary provider unavailable")

    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", unavailable_provider)
    monkeypatch.setattr(
        market, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False)
    )
    response = await client.get(
        f"/api/v1/market/top-movers?type={mover_type}&index=VNINDEX&limit=1"
    )

    assert response.status_code == 200
    payload = response.json()
    if not selected_session_available:
        assert payload["data"] == []
        assert payload["count"] == 0
        assert payload["error"] == "Primary provider unavailable"
        assert payload["is_last_session"] is False
        assert payload["session_label"] is None
        return
    assert payload["count"] == 1
    assert [row["symbol"] for row in payload["data"]] == ["VNM"]
    assert payload["data"][0]["volume"] == 100
    assert payload["data"][0]["value"] == 11_000_000.0
    assert payload["data"][0]["updated_at"] == "2026-09-02"
    assert payload["data"][0]["session_label"] == "2026-09-02"
    assert payload["session_label"] == "2026-09-02"
    assert payload["updated_at"] == "2026-09-02T00:00:00"


@pytest.mark.asyncio
@pytest.mark.parametrize("mover_type", ["volume", "value"])
@pytest.mark.parametrize("missing_metric", [None, float("nan"), float("inf"), -float("inf")])
@pytest.mark.parametrize("observed_zero_available", [True, False])
async def test_market_retained_movers_require_finite_observed_rank_metric(
    client, monkeypatch, mover_type, missing_metric, observed_zero_available
):
    from types import SimpleNamespace

    from vnibb.api.v1 import market

    session_date = date(2026, 9, 2)
    symbols = ["MISSING", *(["ZERO"] if observed_zero_available else [])]
    rows = [{
        "symbol": symbol, "time": session_date, "close": 100_000.0,
        "source": "vietcap_vnd", "volume": 100, "value": 10_000_000.0,
        "exchange": "HOSE", mover_type: missing_metric if symbol == "MISSING" else 0,
    } for symbol in symbols]

    class StoredSession:
        def __init__(self):
            self.results = iter([
                SimpleNamespace(scalar=lambda: session_date),
                SimpleNamespace(mappings=lambda: rows),
            ])

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def execute(self, *args, **kwargs):
            return next(self.results)

    async def unavailable_provider(**kwargs):
        raise RuntimeError("Primary provider unavailable")

    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", unavailable_provider)
    monkeypatch.setattr(market, "async_session_maker", StoredSession)
    response = await client.get(
        f"/api/v1/market/top-movers?type={mover_type}&index=VNINDEX&limit=1"
    )

    assert response.status_code == 200
    payload = response.json()
    if not observed_zero_available:
        assert payload["data"] == []
        assert payload["count"] == 0
        assert payload["error"] == "Primary provider unavailable"
        assert payload["session_label"] is None
        return
    assert payload["count"] == 1
    assert [row["symbol"] for row in payload["data"]] == ["ZERO"]
    assert payload["data"][0][mover_type] == 0
    assert payload["session_label"] == "2026-09-02"


@pytest.mark.asyncio
@pytest.mark.parametrize("mover_type", ["gainer", "loser", "volume", "value"])
@pytest.mark.parametrize("storage_error", ["Retained storage unavailable", ""])
@pytest.mark.parametrize("primary_failed", [False, True])
@pytest.mark.parametrize("secondary_failed", [False, True])
async def test_market_movers_disclose_retained_storage_failure_after_empty_provider(
    client, monkeypatch, mover_type, storage_error, primary_failed, secondary_failed
):
    from vnibb.api.v1 import market

    calls = []

    async def empty_provider(**kwargs):
        calls.append(kwargs["type"])
        if len(calls) == 1 and primary_failed:
            raise RuntimeError("Primary provider unavailable")
        if len(calls) > 1 and secondary_failed:
            raise RuntimeError("Secondary provider unavailable")
        return []

    class FailedStoredSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def execute(self, *args, **kwargs):
            if not storage_error:
                raise TimeoutError()
            raise RuntimeError(storage_error)

    async def empty_metrics(*args, **kwargs):
        return {}

    async def empty_snapshot(*args, **kwargs):
        return []

    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", empty_provider)
    monkeypatch.setattr(market, "async_session_maker", FailedStoredSession)
    monkeypatch.setattr(market, "_load_latest_snapshot_metrics", empty_metrics)
    monkeypatch.setattr(market, "_build_snapshot_top_movers", empty_snapshot)
    response = await client.get(
        f"/api/v1/market/top-movers?type={mover_type}&index=VNINDEX&limit=1"
    )

    assert response.status_code == 200
    uses_secondary = not primary_failed and mover_type in {"gainer", "loser"}
    assert calls == ([mover_type, "volume"] if uses_secondary else [mover_type])
    payload = response.json()
    assert payload["data"] == []
    assert payload["count"] == 0
    assert (storage_error or "TimeoutError") in payload["error"]
    if primary_failed:
        assert "Primary provider unavailable" in payload["error"]
    if uses_secondary and secondary_failed:
        assert "Secondary provider unavailable" in payload["error"]
    assert payload["is_last_session"] is False
    assert payload["session_label"] is None


@pytest.mark.asyncio
async def test_market_retained_inputs_share_sql_across_types_limits_and_aliases(
    client, test_engine, test_db, monkeypatch
):
    import asyncio

    from sqlalchemy import event
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1 import market
    from vnibb.core import cache
    from vnibb.models.stock import Stock, StockPrice

    price_id = 1
    for stock_index in range(10):
        symbol = f"R{stock_index:02}"
        test_db.add(Stock(id=stock_index + 1, symbol=symbol,
                          exchange="HOSE" if stock_index < 5 else "HNX"))
        history = [(date(2026, 1, day), 50_000.0) for day in range(1, 29)]
        history += [(date(2026, 8, 1) if stock_index == 0 else date(2026, 9, 1), 100_000.0),
                    (date(2026, 9, 2), 110_000.0 if stock_index % 2 else 90_000.0)]
        if stock_index == 1:
            history.append((date(2026, 9, 3), 999_000.0))
        for day, close in history:
            test_db.add(StockPrice(
                id=price_id, symbol=symbol, stock_id=stock_index + 1,
                time=day, interval="1D", source="vietcap_vnd",
                open=close, high=close, low=close, close=close,
                volume=stock_index * 10, value=close * stock_index * 10,
            ))
            price_id += 1
    await test_db.commit()
    monkeypatch.setattr(market, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)
    monkeypatch.setattr(cache, "_memory_cache", {})
    monkeypatch.setattr(cache, "_inflight_cache_loads", {})
    statements = []

    def record(_connection, _cursor, statement, _params, _context, _many):
        if "stock_prices" in statement:
            statements.append(statement)

    async def held_provider(**_kwargs):
        raise AssertionError("Admitted retained rows must not start live acquisition")

    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", held_provider)
    event.listen(test_engine.sync_engine, "before_cursor_execute", record)
    try:
        queries = ["type=gainer&limit=1", "type=gainers&limit=2", "mode=losers&limit=2",
                   "type=volume&limit=4", "type=value&limit=3"]
        async with asyncio.timeout(2):
            responses = await asyncio.gather(*(
                client.get(f"/api/v1/market/top-movers?index=VNINDEX&{query}")
                for query in queries
            ))
            repeat = await client.get("/api/v1/market/top-movers?type=gainer&index=VNINDEX&limit=1")
        for response in [*responses, repeat]:
            assert response.status_code == 200
            payload = response.json()
            assert payload["error"] is None
            assert payload["session_label"] == "2026-09-02"
            assert all(row["symbol"] in {"R00", "R01", "R02", "R03", "R04"} for row in payload["data"])
            assert all(abs(row["price_change_pct"]) == 10.0 for row in payload["data"])
        assert responses[0].json()["data"][0]["symbol"] == "R01"
        assert len(statements) == 2
        assert all("ROW_NUMBER" not in statement.upper() for statement in statements)
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", record)


@pytest.mark.asyncio
async def test_market_movers_share_occupied_raw_provider_after_cancellation_and_deadline(
    client, test_engine, monkeypatch
):
    import asyncio
    import threading

    from sqlalchemy.ext.asyncio import async_sessionmaker
    from vnibb.api.v1 import market
    from vnibb.core import cache
    from vnibb.providers.vnstock import runtime as provider_runtime

    monkeypatch.setattr(market, "async_session_maker", async_sessionmaker(test_engine, expire_on_commit=False))
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache.settings, "vnstock_timeout", 0.02)
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)
    monkeypatch.setattr(cache, "_memory_cache", {})
    monkeypatch.setattr(cache, "_inflight_cache_loads", {})
    release = threading.Event()
    provider_calls = []

    class Listing:
        def __init__(self, **_kwargs):
            pass

        def symbols_by_group(self, **_kwargs):
            import pandas as pd

            return pd.Series(["FPT"])

    class Trading:
        def __init__(self, **_kwargs):
            pass

        def price_board(self, **_kwargs):
            provider_calls.append("price_board")
            release.wait(timeout=5)
            raise RuntimeError("Held provider unavailable")

    monkeypatch.setattr(provider_runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(provider_runtime, "get_trading_class", lambda: Trading)
    request = asyncio.create_task(client.get("/api/v1/market/top-movers?type=gainer&index=VNINDEX&limit=1"))
    try:
        async with asyncio.timeout(2):
            while not provider_calls:
                await asyncio.sleep(0.01)
            request.cancel()
            with pytest.raises(asyncio.CancelledError):
                await request
            responses = await asyncio.gather(*(
                client.get(f"/api/v1/market/top-movers?index=VNINDEX&type={kind}&limit={limit}")
                for kind, limit in [("gainers", 2), ("loser", 3), ("volume", 4), ("value", 5)]
                for _ in range(5)
            ))
            retry = await client.get("/api/v1/market/top-movers?type=gainer&index=VNINDEX&limit=1")
        assert provider_calls == ["price_board"]
        for response in [*responses, retry]:
            assert response.status_code == 200
            assert response.json()["data"] == []
            assert "Timeout" in response.json()["error"]
    finally:
        release.set()
        await asyncio.gather(request, return_exceptions=True)
        await asyncio.sleep(0.05)
    monkeypatch.setattr(cache.settings, "vnstock_timeout", 1)
    response = await client.get("/api/v1/market/top-movers?type=value&index=VNINDEX&limit=5")
    assert response.status_code == 200
    assert "Held provider unavailable" in response.json()["error"]
    assert provider_calls == ["price_board", "price_board"]


@pytest.mark.asyncio
async def test_market_movers_do_not_cache_failed_retained_reads_as_success(client, monkeypatch):
    from types import SimpleNamespace

    from vnibb.api.v1 import market
    from vnibb.core import cache

    attempts = 0

    class RecoveringSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            pass

        async def execute(self, *_args, **_kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("Retained storage unavailable")
            if attempts == 2:
                return SimpleNamespace(scalar=lambda: date(2026, 9, 2))
            return SimpleNamespace(mappings=lambda: [{
                "symbol": "VNM", "time": date(2026, 9, 2), "exchange": "HOSE", "rn": 1,
                "close": 110_000.0, "source": "vietcap_vnd", "volume": 0, "value": 0,
                "previous_close": 100_000.0, "previous_source": "vietcap_vnd",
            }], all=lambda: [("VNM", "HOSE")])

    async def empty_provider(**_kwargs):
        return []

    monkeypatch.setattr(market, "async_session_maker", RecoveringSession)
    monkeypatch.setattr(market.VnstockTopMoversFetcher, "fetch", empty_provider)
    monkeypatch.setattr(cache.settings, "environment", "development")
    monkeypatch.setattr(cache, "_redis_cache_enabled", lambda: False)
    monkeypatch.setattr(cache, "_memory_cache", {})
    monkeypatch.setattr(cache, "_inflight_cache_loads", {})
    url = "/api/v1/market/top-movers?type=volume&index=VNINDEX&limit=1"
    failed = await client.get(url)
    assert failed.status_code == 200
    assert failed.json()["error"] == "Retained storage unavailable"
    recovered = await client.get(url)
    assert recovered.status_code == 200
    assert recovered.json()["error"] is None
    assert recovered.json()["data"][0]["volume"] == 0
    assert recovered.json()["data"][0]["price_change_pct"] == 10.0
    assert attempts == 3
