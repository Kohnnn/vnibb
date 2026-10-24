"""
Characterization tests for /api/v1/market/heatmap current behaviour.

These tests pin the production logic BEFORE any refactor so that
subsequent changes can be verified for behavioural preservation.
"""

import asyncio
from datetime import date, datetime, timedelta

import pytest

from vnibb.api.v1.market import _normalize_screener_row
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.equity_screener import ScreenerData
from vnibb.services.cache_manager import CacheResult


# ---------------------------------------------------------------------------
# Helpers
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


def _sector_names(payload: dict) -> list[str]:
    """Return the list of sector keys in the heatmap response."""
    return [sector.get("sector") for sector in payload.get("sectors", [])]


# ---------------------------------------------------------------------------
# Test 1 — Cached sparse/invalid heatmap retries fresh provider once
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_heatmap_cached_sparse_retries_fresh_and_returns_cached_false(
    client, monkeypatch
):
    """Cached data that produces empty groups triggers one fresh fetch and cached=False."""
    # ---- cached data: valid symbol but price==0 so _build_groups drops it ----
    stale_snapshot = ScreenerSnapshot(
        symbol="VNM",
        snapshot_date=date.today(),
        company_name="Vinamilk",
        exchange="HOSE",
        industry="Food",
        price=0.0,
        extended_metrics={"price_unit": "VND"},
        volume=1_000_000,
        market_cap=150_000_000_000.0,
        pe=15.0,
        pb=3.0,
        source="KBS",
    )

    async def _fake_cache_hit(*args, **kwargs):
        return CacheResult(
            data=[stale_snapshot],
            is_stale=False,
            cached_at=datetime.utcnow(),
            hit=True,
        )

    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        _fake_cache_hit,
    )

    # No DB fallback
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_screener_rows_from_db",
        lambda **kwargs: _async([]),
    )

    # Fresh fetch returns valid data
    async def _fake_fetch(params):
        return [
            ScreenerData(
                symbol="VNM",
                organ_name="Vinamilk",
                exchange="HOSE",
                industry_name="Food",
                price=100.0,
                price_unit="VND",
                change_1d=3.2,
                market_cap=150_000_000_000.0,
                volume=1_000_000,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockScreenerFetcher.fetch",
        _fake_fetch,
    )

    # Isolate enrichment
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_price_time", lambda _syms: _async(None))

    # ---- act ----
    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL")
    assert response.status_code == 200

    payload = response.json()

    # ---- assert ----
    assert payload["cached"] is False, f"expected cached=False after fresh retry, got {payload['cached']}"
    assert payload["count"] > 0, "heatmap should contain stocks after fresh fetch"

    vnm = _find_stock(payload, "VNM")
    assert vnm is not None, "VNM should appear after fresh fetch"
    assert vnm["price"] == 100.0


# ---------------------------------------------------------------------------
# Test 2 — group_by=industry groups by industry
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_heatmap_group_by_industry_groups_by_industry(client, monkeypatch):
    """group_by=industry uses the row's industry as the sector key."""
    # Cache miss
    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        lambda *args, **kwargs: _async(
            CacheResult(data=None, is_stale=False, cached_at=None, hit=False)
        ),
    )
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_screener_rows_from_db",
        lambda **kwargs: _async([]),
    )

    async def _fake_fetch(params):
        return [
            ScreenerData(
                symbol="VNM",
                organ_name="Vinamilk",
                exchange="HOSE",
                industry_name="Food",
                price=90.0,
                price_unit="VND",
                change_1d=1.5,
                market_cap=100_000_000_000.0,
                volume=500_000,
            ),
            ScreenerData(
                symbol="HPG",
                organ_name="Hoa Phat",
                exchange="HOSE",
                industry_name="Steel",
                price=25.0,
                price_unit="VND",
                change_1d=-0.5,
                market_cap=80_000_000_000.0,
                volume=1_000_000,
            ),
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockScreenerFetcher.fetch",
        _fake_fetch,
    )

    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_price_time", lambda _syms: _async(None))

    # ---- act ----
    response = await client.get(
        "/api/v1/market/heatmap?group_by=industry&limit=10&exchange=ALL&use_cache=false"
    )
    assert response.status_code == 200

    payload = response.json()
    sectors = _sector_names(payload)

    # ---- assert ----
    assert "Food" in sectors, f"expected 'Food' sector, got {sectors}"
    assert "Steel" in sectors, f"expected 'Steel' sector, got {sectors}"

    food_stock = _find_stock(payload, "VNM")
    assert food_stock is not None
    assert food_stock["sector"] == "Food"

    steel_stock = _find_stock(payload, "HPG")
    assert steel_stock is not None
    assert steel_stock["sector"] == "Steel"


@pytest.mark.asyncio
async def test_heatmap_filters_rows_after_metadata_enrichment(client, monkeypatch):
    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        lambda *args, **kwargs: _async(
            CacheResult(data=None, is_stale=False, cached_at=None, hit=False)
        ),
    )
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_screener_rows_from_db",
        lambda **kwargs: _async([]),
    )

    async def _fake_fetch(params):
        return [
            ScreenerData(
                symbol="HPG",
                organ_name="Hoa Phat",
                exchange=None,
                industry_name=None,
                price=25.0,
                price_unit="VND",
                change_1d=1.25,
                market_cap=80_000_000_000.0,
                volume=1_000_000,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockScreenerFetcher.fetch",
        _fake_fetch,
    )
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_stock_metadata",
        lambda _syms: _async(
            {"HPG": {"exchange": "HNX", "industry": "Steel", "sector": "Materials"}}
        ),
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_price_time", lambda _syms: _async(None))

    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=HOSE&use_cache=false")
    assert response.status_code == 200

    payload = response.json()
    assert payload["count"] == 0
    assert _find_stock(payload, "HPG") is None


@pytest.mark.asyncio
async def test_heatmap_cached_snapshot_preserves_price_change_1d_pct_alias(client, monkeypatch):
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
        extended_metrics={"price_change_1d_pct": 4.5, "price_unit": "VND"},
        source="KBS",
    )

    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        lambda *args, **kwargs: _async(
            CacheResult(data=[snapshot], is_stale=False, cached_at=datetime.utcnow(), hit=True)
        ),
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_price_time", lambda _syms: _async(None))

    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL")
    assert response.status_code == 200

    payload = response.json()
    vnm = _find_stock(payload, "VNM")
    assert vnm is not None
    assert vnm["change_pct"] == 4.5
    assert vnm["change"] == pytest.approx(4.5)


@pytest.mark.asyncio
async def test_heatmap_smoke_shape(client, monkeypatch):
    """Minimal end-to-end shape check with simple monkeypatching."""
    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        lambda *args, **kwargs: _async(
            CacheResult(data=None, is_stale=False, cached_at=None, hit=False)
        ),
    )
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_screener_rows_from_db",
        lambda **kwargs: _async([]),
    )

    async def _fake_fetch(params):
        return [
            ScreenerData(
                symbol="VNM",
                organ_name="Vinamilk",
                exchange="HOSE",
                industry_name="Food",
                price=85.0,
                price_unit="VND",
                change_1d=2.0,
                market_cap=120_000_000_000.0,
                volume=300_000,
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockScreenerFetcher.fetch",
        _fake_fetch,
    )

    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_price_time", lambda _syms: _async(None))

    # ---- act ----
    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL&use_cache=false")
    assert response.status_code == 200

    payload = response.json()

    # ---- top-level shape ----
    assert "count" in payload
    assert "group_by" in payload
    assert "color_metric" in payload
    assert "size_metric" in payload
    assert "sectors" in payload
    assert "cached" in payload
    assert "updated_at" in payload

    assert payload["count"] == 1
    assert payload["group_by"] == "sector"  # default
    assert payload["color_metric"] == "change_pct"  # default
    assert payload["size_metric"] == "market_cap"  # default
    assert payload["cached"] is False
    assert payload["partial"] is True
    assert payload["constituents_as_of"] is None
    assert payload["constituents_stale"] is False

    assert len(payload["sectors"]) > 0
    sector = payload["sectors"][0]

    # ---- sector shape ----
    assert "sector" in sector
    assert "stocks" in sector
    assert "total_market_cap" in sector
    assert "avg_change_pct" in sector
    assert "stock_count" in sector

    assert sector["stock_count"] == 1
    assert sector["total_market_cap"] > 0

    stock = sector["stocks"][0]

    # ---- stock shape ----
    assert "symbol" in stock
    assert "name" in stock
    assert "sector" in stock
    assert "industry" in stock
    assert "market_cap" in stock
    assert "price" in stock
    assert "change" in stock
    assert "change_pct" in stock
    assert "volume" in stock

    assert stock["symbol"] == "VNM"
    assert stock["price"] == 85.0
    assert stock["change_pct"] == 2.0
    assert stock["change"] == pytest.approx(85.0 * 2.0 / 100.0)

@pytest.mark.asyncio
async def test_heatmap_reports_oldest_included_constituent_separately_from_price(client, monkeypatch):
    old_day = date.today() - timedelta(days=14)
    recent_day = date.today()
    snapshots = [
        ScreenerSnapshot(
            symbol=symbol,
            snapshot_date=recent_day,
            trade_date=snapshot_day,
            company_name=symbol,
            exchange="HOSE",
            industry="Food",
            price=100.0,
            extended_metrics={"price_unit": "VND"},
            volume=1_000_000,
            market_cap=150_000_000_000.0,
            source="KBS",
        )
        for symbol, snapshot_day in [("VNM", old_day), ("MSN", recent_day)]
    ]
    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        lambda *args, **kwargs: _async(
            CacheResult(data=snapshots, is_stale=False, cached_at=datetime.utcnow(), hit=True)
        ),
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_price_time",
        lambda _syms: _async(recent_day.isoformat()),
    )

    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert payload["cached"] is True
    assert payload["partial"] is False
    assert payload["updated_at"] == recent_day.isoformat()
    assert payload["price_updated_at"] == recent_day.isoformat()
    assert payload["constituents_as_of"] == old_day.isoformat()
    assert payload["constituents_stale"] is True


@pytest.mark.asyncio
async def test_heatmap_db_rows_do_not_call_old_trades_current(client, monkeypatch):
    old_day = date.today() - timedelta(days=14)
    today = date.today()
    monkeypatch.setattr(
        "vnibb.api.v1.market.CacheManager.get_screener_data",
        lambda *args, **kwargs: _async(CacheResult(data=None, is_stale=False, cached_at=None, hit=False)),
    )
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_screener_rows_from_db",
        lambda **kwargs: _async([_normalize_screener_row({
            "symbol": "VNM", "company_name": "Vinamilk", "exchange": "HOSE", "industry_name": "Food",
            "price": 100.0, "volume": 1_000_000, "market_cap": 150_000_000_000.0,
            "price_unit": "VND",
            "snapshot_date": today, "trade_date": old_day,
        })]),
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_latest_price_time", lambda _syms: _async(today.isoformat()))

    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["price_updated_at"] == today.isoformat()
    assert payload["constituents_as_of"] == old_day.isoformat()
    assert payload["constituents_stale"] is True


@pytest.mark.asyncio
async def test_heatmap_current_provider_rows_keep_current_dates_without_cache(client, monkeypatch):
    today = date.today()
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_screener_rows_from_db",
        lambda **kwargs: _async([]),
    )
    monkeypatch.setattr(
        "vnibb.api.v1.market.VnstockScreenerFetcher.fetch",
        lambda _params: _async([
            ScreenerData(
                symbol="VNM", organ_name="Vinamilk", exchange="HOSE",
                industry_name="Food", price=100.0, volume=1_000_000,
                market_cap=150_000_000_000.0, trade_date=today,
                price_unit="VND",
            )
        ]),
    )
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    monkeypatch.setattr(
        "vnibb.api.v1.market._load_latest_price_time",
        lambda _syms: _async(today.isoformat()),
    )

    response = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL&use_cache=false")
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["cached"] is False
    assert payload["partial"] is True
    assert payload["price_updated_at"] == today.isoformat()
    assert payload["constituents_as_of"] == today.isoformat()
    assert payload["constituents_stale"] is False


@pytest.mark.asyncio
async def test_unverified_screener_rows_cannot_supply_market_heatmap_or_breadth(
    client, test_db, monkeypatch
):
    from vnibb.api.v1.market import _load_latest_screener_rows_from_db

    test_db.add(ScreenerSnapshot(
        symbol="VNM", snapshot_date=date.today(), trade_date=date.today(),
        company_name="Vinamilk", exchange="HOSE", industry="Food",
        price=100.0, volume=1_000_000, market_cap=150_000_000_000.0,
    ))
    await test_db.commit()
    assert await _load_latest_screener_rows_from_db() == []

    monkeypatch.setattr("vnibb.api.v1.market.VnstockScreenerFetcher.fetch", lambda _params: _async([]))
    monkeypatch.setattr("vnibb.api.v1.market._load_stock_metadata", lambda _syms: _async({}))
    monkeypatch.setattr("vnibb.api.v1.market._load_change_pct_map", lambda _syms: _async({}))
    heatmap = await client.get("/api/v1/market/heatmap?limit=10&exchange=ALL&use_cache=false")
    assert heatmap.status_code == 503
    assert heatmap.json()["error"] == "http_error"
    assert heatmap.json()["details"]["status_code"] == 503

    breadth = await client.get("/api/v1/market/breadth")
    assert breadth.status_code == 200
    assert breadth.json()["data"] == []
    assert breadth.json()["error"] == "Verified screener Universe unavailable"


@pytest.mark.asyncio
async def test_heatmap_slow_provider_is_bounded_and_shared(client, monkeypatch):
    from vnibb.api.v1 import market

    release = asyncio.Event()
    finished = asyncio.Event()
    calls = 0

    async def slow_provider(_params):
        nonlocal calls
        calls += 1
        try:
            await release.wait()
            return []
        finally:
            finished.set()

    monkeypatch.setattr(market, "HEATMAP_FETCH_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", lambda **_kw: _async([]))
    monkeypatch.setattr(market.VnstockScreenerFetcher, "fetch", slow_provider)
    try:
        async with asyncio.timeout(0.75):
            responses = await asyncio.gather(*(
                client.get("/api/v1/market/heatmap?exchange=HOSE&limit=500&use_cache=false")
                for _ in range(20)
            ))
            retry = await client.get(
                "/api/v1/market/heatmap?exchange=HOSE&limit=500&use_cache=false"
            )
        for response in [*responses, retry]:
            assert response.status_code == 503
            assert response.json()["error"] == "http_error"
            assert response.json()["details"]["status_code"] == 503
        assert calls == 1
    finally:
        release.set()
        await finished.wait()
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_heatmap_cache_lookup_obeys_whole_route_deadline(client, monkeypatch):
    from vnibb.api.v1 import market

    async def slow_cache(*_args, **_kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(market, "MARKET_ROUTE_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(market.CacheManager, "get_screener_data", slow_cache)
    async with asyncio.timeout(0.75):
        response = await client.get(
            "/api/v1/market/heatmap?exchange=HOSE&limit=500&use_cache=true"
        )
    assert response.status_code == 503
    assert response.json()["error"] == "http_error"
    assert response.json()["details"]["status_code"] == 503


@pytest.mark.asyncio
async def test_heatmap_reuses_executor_work_after_provider_deadline(client, monkeypatch):
    from concurrent.futures import Future

    from vnibb.api.v1 import market

    work = Future()
    submissions = []

    def hold_coordinator(executor, func, *args):
        submissions.append((executor, func))
        return asyncio.wrap_future(work)

    monkeypatch.setattr(asyncio.get_running_loop(), "run_in_executor", hold_coordinator)
    monkeypatch.setattr(market.settings, "vnstock_timeout", 0.02)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", lambda **_kw: _async([]))
    try:
        async with asyncio.timeout(0.75):
            for _ in range(3):
                response = await client.get(
                    "/api/v1/market/heatmap?exchange=HOSE&limit=500&use_cache=false"
                )
                assert response.status_code == 503
                await asyncio.sleep(0)
        assert len(submissions) == 1
        assert submissions[0][0] is None
        assert not work.cancelled()
    finally:
        work.set_result([])
        await asyncio.sleep(0)
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_heatmap_child_timeout_retains_batch_until_running_work_finishes(client, monkeypatch):
    from concurrent.futures import Future, ThreadPoolExecutor
    from types import SimpleNamespace

    import pandas as pd
    from vnibb.api.v1 import market
    from vnibb.providers.vnstock import equity_screener, runtime

    pool = ThreadPoolExecutor(max_workers=2)
    running = Future()
    running.set_running_or_notify_cancel()
    queued = Future()
    batches = []
    completions = []
    children = []

    def run_coordinator(executor, func, *args):
        assert executor is None
        batches.append(func)
        future = pool.submit(func, *args)
        completions.append(future)
        return asyncio.wrap_future(future)

    class ControlledExecutor:
        def submit(self, func, *args, **kwargs):
            children.append(args[0])
            if len(batches) == 1:
                return running if len(children) == 1 else queued
            done = Future()
            done.set_result({
                "ticker": args[0], "exchange": "HOSE", "price": 100.0,
                "price_unit": "VND", "market_cap": 150_000_000_000.0,
            })
            return done

    class Listing:
        def __init__(self, **kwargs):
            pass

        def symbols_by_exchange(self):
            return pd.DataFrame({
                "symbol": ["VNM", "FPT"], "exchange": "HOSE", "type": "STOCK",
            })

    monkeypatch.setattr(equity_screener, "_executor", ControlledExecutor())
    monkeypatch.setattr(asyncio.get_running_loop(), "run_in_executor", run_coordinator)
    monkeypatch.setattr(equity_screener, "get_vnstock", lambda: SimpleNamespace())
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: object)
    monkeypatch.setattr(market.settings, "vnstock_timeout", 0.02)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", lambda **_kw: _async([]))
    monkeypatch.setattr(market, "_load_stock_metadata", lambda _s: _async({}))
    monkeypatch.setattr(market, "_load_change_pct_map", lambda _s: _async({}))
    monkeypatch.setattr(market, "_load_latest_price_time", lambda _s: _async(None))
    url = "/api/v1/market/heatmap?exchange=HOSE&limit=500&use_cache=false"
    try:
        async with asyncio.timeout(0.75):
            for _ in range(3):
                response = await client.get(url)
                assert response.status_code == 503
                await asyncio.sleep(0)
        assert len(batches) == 1
        assert children == ["VNM", "FPT"]
        assert queued.cancelled()
        running.set_result(None)
        await asyncio.wrap_future(completions[0])
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        monkeypatch.setattr(market.settings, "vnstock_timeout", 6)
        async with asyncio.timeout(0.75):
            response = await client.get(url)
        assert response.status_code == 200
        assert len(batches) == 2
    finally:
        if not running.done():
            running.set_result(None)
        pool.shutdown(wait=True)


@pytest.mark.asyncio
async def test_heatmap_distinct_batches_progress_at_child_worker_capacity(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Event, Lock
    from types import SimpleNamespace

    import pandas as pd

    from vnibb.api.v1 import market
    from vnibb.providers.vnstock import equity_screener, runtime

    capacity = 12
    pool = ThreadPoolExecutor(max_workers=capacity)
    coordinators = ThreadPoolExecutor(max_workers=capacity)

    def run_coordinator(executor, func, *args):
        assert executor is None
        return asyncio.wrap_future(coordinators.submit(func, *args))

    monkeypatch.setattr(asyncio.get_running_loop(), "run_in_executor", run_coordinator)
    coordinators_ready = Barrier(capacity, timeout=1)
    children_ready = Event()
    release = Event()
    lock = Lock()
    active = peak = 0
    symbols = [f"A{index:02}" for index in range(capacity)]

    class Listing:
        def __init__(self, *, source):
            assert source == "VCI"

        def symbols_by_exchange(self):
            coordinators_ready.wait()
            return pd.DataFrame({"symbol": symbols, "exchange": "HOSE", "type": "STOCK"})

        def all_symbols(self, **kwargs):
            if "exchange" in kwargs:
                coordinators_ready.wait()
            return pd.DataFrame({"symbol": symbols, "exchange": "HOSE"})

    class Quote:
        def __init__(self, *, source, symbol):
            assert source == "VCI"

        def history(self, *, start, end):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if active == capacity:
                    children_ready.set()
            try:
                if not release.wait(1):
                    raise TimeoutError("Test quote work was not released")
                return pd.DataFrame([{
                    "time": date.today().isoformat(), "close": 100_000.0,
                    "volume": 1_000_000, "price_unit": "VND",
                }])
            finally:
                with lock:
                    active -= 1

    monkeypatch.setattr(equity_screener, "_executor", pool)
    monkeypatch.setattr(equity_screener, "get_vnstock", lambda: SimpleNamespace(
        stock=lambda **kwargs: SimpleNamespace(quote=Quote(**kwargs)),
    ))
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(market.settings, "vnstock_timeout", 6)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", lambda **_kw: _async([]))
    monkeypatch.setattr(market, "_load_stock_metadata", lambda _s: _async({}))
    monkeypatch.setattr(market, "_load_change_pct_map", lambda _s: _async({}))
    monkeypatch.setattr(market, "_load_latest_price_time", lambda _s: _async(None))
    requests = [asyncio.create_task(client.get(
        f"/api/v1/market/heatmap?exchange=HOSE&limit={limit}&size_metric=volume&use_cache=false"
    )) for limit in range(1, capacity + 1)]
    try:
        async with asyncio.timeout(0.75):
            while not children_ready.is_set():
                await asyncio.sleep(0.001)
        assert children_ready.is_set(), (
            "Distinct heatmap acquisitions occupied the child pool instead of running quotes"
        )
        release.set()
        async with asyncio.timeout(2):
            responses = await asyncio.gather(*requests)
        assert [response.status_code for response in responses] == [200] * capacity
        assert [response.json()["count"] for response in responses] == list(range(1, capacity + 1))
        assert peak == capacity
    finally:
        release.set()
        coordinators_ready.abort()
        await asyncio.gather(*requests, return_exceptions=True)
        pool.shutdown(wait=True, cancel_futures=True)
        coordinators.shutdown(wait=True, cancel_futures=True)


@pytest.mark.asyncio
async def test_screener_single_and_batch_share_quote_worker_budget(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, Lock

    import pandas as pd

    from vnibb.providers.vnstock import equity_screener, runtime

    pool = ThreadPoolExecutor(max_workers=2)
    coordinators = ThreadPoolExecutor(max_workers=2)
    single_started = Event()
    capacity_reached = Event()
    over_capacity = Event()
    release = Event()
    lock = Lock()
    active = peak = 0

    def run_acquisition(executor, func, *args):
        return asyncio.wrap_future((executor or coordinators).submit(func, *args))

    class Listing:
        def __init__(self, *, source):
            assert source == "VCI"

        def symbols_by_exchange(self):
            return pd.DataFrame({
                "symbol": ["FPT", "HPG"], "exchange": "HOSE", "type": "STOCK",
            })

    class Quote:
        def __init__(self, *, source, symbol):
            assert source == "VCI"
            self.symbol = symbol

        def history(self, *, start, end):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if self.symbol == "VNM":
                    single_started.set()
                if active == 2:
                    capacity_reached.set()
                if active > 2:
                    over_capacity.set()
            try:
                if not release.wait(2):
                    raise TimeoutError("Test quote work was not released")
                return pd.DataFrame([{
                    "time": date.today().isoformat(), "close": 100.0, "volume": 1_000_000,
                }])
            finally:
                with lock:
                    active -= 1

    monkeypatch.setattr(equity_screener, "_executor", pool)
    monkeypatch.setattr(asyncio.get_running_loop(), "run_in_executor", run_acquisition)
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(equity_screener.settings, "vnstock_timeout", 6)
    params = equity_screener.StockScreenerParams
    fetch = equity_screener.VnstockScreenerFetcher.fetch
    requests = [asyncio.create_task(fetch(params(symbol="VNM", include_ratios=False)))]
    try:
        async with asyncio.timeout(0.75):
            while not single_started.is_set():
                await asyncio.sleep(0.001)
        requests.append(asyncio.create_task(fetch(params(exchange="HOSE", limit=2, include_ratios=False))))
        async with asyncio.timeout(0.75):
            while not capacity_reached.is_set():
                await asyncio.sleep(0.001)
        try:
            async with asyncio.timeout(0.1):
                while not over_capacity.is_set():
                    await asyncio.sleep(0.001)
        except TimeoutError:
            pass
        release.set()
        async with asyncio.timeout(2):
            single, batch = await asyncio.gather(*requests)
        assert [row.symbol for row in single] == ["VNM"]
        assert {row.symbol for row in batch} == {"FPT", "HPG"}
        assert peak == 2
    finally:
        release.set()
        await asyncio.gather(*requests, return_exceptions=True)
        pool.shutdown(wait=True, cancel_futures=True)
        coordinators.shutdown(wait=True, cancel_futures=True)


@pytest.mark.asyncio
async def test_heatmap_quote_only_uses_real_listing_exchange_before_limit(client, monkeypatch):
    import pandas as pd

    from vnibb.api.v1 import market
    from vnibb.providers.vnstock import equity_screener, runtime

    calls = {"broad_stock": 0, "listing": 0, "quotes": []}

    def broad_stock_is_forbidden():
        calls["broad_stock"] += 1
        raise AssertionError("Quote-only acquisition must not construct Finance")

    class Listing:
        def __init__(self, *, source):
            assert source == "VCI"

        def all_symbols(self, *, show_log=False):
            raise AssertionError("all_symbols has no exchange metadata or exchange filter")

        def symbols_by_exchange(self, *, lang="vi", show_log=False):
            calls["listing"] += 1
            return pd.DataFrame([
                {"symbol": "FPT", "organ_name": "Other exchange", "exchange": "HNX", "type": "STOCK"},
                {"symbol": "BOND", "organ_name": "Not equity", "exchange": "HOSE", "type": "BOND"},
                {"symbol": "VNM", "organ_name": "Vinamilk", "exchange": "hose", "type": "STOCK"},
            ])

    class Quote:
        def __init__(self, *, source, symbol):
            assert source == "VCI"
            calls["quotes"].append(symbol)

        def history(self, *, start, end):
            return pd.DataFrame([{
                "time": date.today().isoformat(), "close": 100.0, "volume": 1_000_000,
            }])

    monkeypatch.setattr(equity_screener, "get_vnstock", broad_stock_is_forbidden)
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", lambda **_kw: _async([]))
    monkeypatch.setattr(market, "_load_stock_metadata", lambda _s: _async({}))
    monkeypatch.setattr(market, "_load_change_pct_map", lambda _s: _async({}))
    monkeypatch.setattr(market, "_load_latest_price_time", lambda _s: _async(None))

    response = await client.get(
        "/api/v1/market/heatmap?exchange=HOSE&limit=1&size_metric=volume&use_cache=false"
    )

    assert response.status_code == 200
    assert calls == {"broad_stock": 0, "listing": 1, "quotes": ["VNM"]}
    payload = response.json()
    assert payload["count"] == 1
    stock = _find_stock(payload, "VNM")
    assert stock["price"] == 100_000.0
    assert stock["market_cap"] == 1_000_000


@pytest.fixture
def screener_supplier(monkeypatch):
    from types import SimpleNamespace

    import pandas as pd
    from vnibb.api.v1 import market
    from vnibb.providers.vnstock import equity_screener, runtime

    calls = {"ratios": 0, "quotes": 0, "quote_state": "available"}

    class Listing:
        def __init__(self, **kwargs):
            pass

        def all_symbols(self, **kwargs):
            return pd.DataFrame([{"symbol": "VNM", "organ_name": "Vinamilk"}])

        def symbols_by_exchange(self, *, lang="vi", show_log=False):
            return pd.DataFrame([{
                "symbol": "VNM", "organ_name": "Vinamilk", "exchange": "HOSE", "type": "STOCK",
            }])

    def ratios(**kwargs):
        calls["ratios"] += 1
        return pd.DataFrame([{"pe": 12.0, "pb": 2.0}])

    def history(**kwargs):
        calls["quotes"] += 1
        if calls["quote_state"] == "unavailable":
            raise RuntimeError("Quote supplier unavailable")
        if calls["quote_state"] == "empty":
            return pd.DataFrame()
        return pd.DataFrame([{
            "time": date.today().isoformat(), "close": 100_000.0,
            "volume": 1_000_000, "price_unit": "VND",
        }])

    class Quote:
        def __init__(self, *, source, symbol):
            assert (source, symbol) == ("VCI", "VNM")

        def history(self, **kwargs):
            return history(**kwargs)


    supplier = SimpleNamespace(
        finance=SimpleNamespace(ratio=ratios), quote=SimpleNamespace(history=history),
    )
    monkeypatch.setattr(equity_screener, "get_vnstock", lambda: SimpleNamespace(stock=lambda **_kw: supplier))
    monkeypatch.setattr(runtime, "get_listing_class", lambda: Listing)
    monkeypatch.setattr(runtime, "get_quote_class", lambda: Quote)
    monkeypatch.setattr(market, "_load_latest_screener_rows_from_db", lambda **_kw: _async([]))
    monkeypatch.setattr(market, "_load_stock_metadata", lambda _s: _async({}))
    monkeypatch.setattr(market, "_load_change_pct_map", lambda _s: _async({"VNM": 3.2}))
    monkeypatch.setattr(market, "_load_latest_price_time", lambda _s: _async(None))
    return calls


@pytest.mark.asyncio
@pytest.mark.parametrize("quote_state", ["available", "empty", "unavailable"])
async def test_heatmap_acquires_quotes_without_financial_ratios(client, screener_supplier, quote_state):
    screener_supplier["quote_state"] = quote_state
    response = await client.get(
        "/api/v1/market/heatmap?exchange=HOSE&limit=10&size_metric=volume&use_cache=false"
    )

    assert screener_supplier["ratios"] == 0
    assert screener_supplier["quotes"] == 1
    if quote_state != "available":
        assert response.status_code == 503
        assert response.json()["details"]["status_code"] == 503
        return
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["partial"] is True
    assert payload["cached"] is False
    stock = _find_stock(payload, "VNM")
    assert stock["price"] == 100_000.0
    assert stock["market_cap"] == 1_000_000
    assert stock["change_pct"] == 3.2


@pytest.mark.asyncio
@pytest.mark.parametrize("symbol", [None, "VNM"])
async def test_full_screener_keeps_financial_ratio_acquisition(screener_supplier, symbol):
    from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher

    rows = await VnstockScreenerFetcher.fetch(StockScreenerParams(symbol=symbol, limit=10))

    assert screener_supplier["ratios"] == 1
    assert screener_supplier["quotes"] == 1
    assert len(rows) == 1
    assert rows[0].symbol == "VNM"
    assert rows[0].pe == 12.0
    assert rows[0].pb == 2.0
    assert rows[0].price == 100_000.0


@pytest.mark.asyncio
async def test_heatmap_valid_quotes_outside_selected_group_are_empty_not_unavailable(client, screener_supplier):
    response = await client.get(
        "/api/v1/market/heatmap?group_by=hnx30&exchange=HOSE&limit=10&size_metric=volume&use_cache=false"
    )

    assert response.status_code == 200
    assert response.json()["count"] == 0
    assert response.json()["sectors"] == []
    assert response.json()["partial"] is True
    assert screener_supplier["ratios"] == 0
    assert screener_supplier["quotes"] == 1
