"""
Focused regression for issue #107: /api/v1/listing/symbols dropped the cached
``Stock.industry`` when building SymbolData, so the Listing Browser industry
filter only ever had its fallback bucket.

The endpoint must forward a stored industry and must NOT invent one for a row
whose industry is genuinely unknown.
"""

import pytest
from vnibb.models.stock import Stock
from vnibb.services.cache_manager import CacheResult


def _fake_listing_cache(stocks):
    async def _fake_get_listing_data(self, source="VCI", allow_stale=True):
        return CacheResult(data=stocks, is_stale=False, cached_at=None, hit=True)

    return _fake_get_listing_data


@pytest.mark.asyncio
async def test_symbols_listing_forwards_cached_industry(client, monkeypatch):
    monkeypatch.setattr(
        "vnibb.services.cache_manager.CacheManager.get_listing_data",
        _fake_listing_cache(
            [
                Stock(symbol="VCB", company_name="Vietcombank", exchange="HOSE", industry="Banks", is_active=1),
                Stock(symbol="MSR", company_name="Masan Resources", exchange="HOSE", industry=None, is_active=1),
            ]
        ),
    )

    response = await client.get("/api/v1/listing/symbols")
    assert response.status_code == 200
    payload = {row["symbol"]: row for row in response.json()["data"]}

    assert payload["VCB"]["industry"] == "Banks"
    # Unknown stays unknown: no guessed sector is fabricated for a row without one.
    assert payload["MSR"]["industry"] is None
