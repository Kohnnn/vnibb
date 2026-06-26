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
        extended_metrics={"change_1d": 4.5},
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
