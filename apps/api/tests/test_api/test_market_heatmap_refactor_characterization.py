"""
Characterization tests for /api/v1/market/heatmap current behaviour.

These tests pin the production logic BEFORE any refactor so that
subsequent changes can be verified for behavioural preservation.
"""

from datetime import date, datetime

import pytest

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
        extended_metrics={"price_change_1d_pct": 4.5},
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
