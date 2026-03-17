import pytest
from datetime import date

from vnibb.models.stock import Stock
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.top_movers import SectorStockData, SectorTopMoversData


@pytest.mark.asyncio
async def test_sector_top_movers_endpoint_uses_expected_path(client, monkeypatch):
    async def fake_fetch_sector_top_movers(*, type, limit_per_sector):
        assert type == "gainers"
        assert limit_per_sector == 3
        return [
            SectorTopMoversData(
                sector="Banking",
                sector_vi="Ngan hang",
                stocks=[
                    SectorStockData(
                        symbol="VCB", price=91000, change=1200, change_pct=1.34, volume=123456
                    ),
                ],
            )
        ]

    monkeypatch.setattr(
        "vnibb.api.v1.sectors.VnstockTopMoversFetcher.fetch_sector_top_movers",
        fake_fetch_sector_top_movers,
    )

    response = await client.get("/api/v1/sectors/top-movers?type=gainers&limit=3")

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["type"] == "gainers"
    assert payload["sectors"][0]["sector"] == "Banking"
    assert payload["sectors"][0]["stocks"][0]["symbol"] == "VCB"


@pytest.mark.asyncio
async def test_sector_top_movers_endpoint_returns_empty_on_provider_error(client, monkeypatch):
    async def fake_fetch_sector_top_movers(*, type, limit_per_sector):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(
        "vnibb.api.v1.sectors.VnstockTopMoversFetcher.fetch_sector_top_movers",
        fake_fetch_sector_top_movers,
    )

    response = await client.get("/api/v1/sectors/top-movers?type=losers&limit=2")

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 0
    assert payload["type"] == "losers"
    assert payload["sectors"] == []


@pytest.mark.asyncio
async def test_legacy_double_prefixed_sectors_path_is_not_exposed(client):
    response = await client.get("/api/v1/sectors/sectors/top-movers")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_sector_stocks_endpoint_returns_rows(client, test_db):
    test_db.add_all(
        [
            Stock(symbol="VCB", company_name="Vietcombank", exchange="HOSE", industry="bank"),
            Stock(symbol="TCB", company_name="Techcombank", exchange="HOSE", industry="bank"),
            ScreenerSnapshot(
                symbol="VCB",
                snapshot_date=date(2026, 2, 22),
                market_cap=10_000_000,
                price=90000,
                pe=12,
            ),
            ScreenerSnapshot(
                symbol="TCB",
                snapshot_date=date(2026, 2, 22),
                market_cap=8_000_000,
                price=50000,
                pe=9,
            ),
        ]
    )
    await test_db.commit()

    response = await client.get("/api/v1/sectors/banking/stocks?limit=5")
    assert response.status_code == 200
    payload = response.json()
    assert payload["sector"] == "banking"
    assert payload["count"] == 2
    assert payload["data"][0]["symbol"] in {"VCB", "TCB"}


@pytest.mark.asyncio
async def test_sectors_list_populates_dynamic_symbols(client, test_db):
    test_db.add_all(
        [
            Stock(symbol="VCB", company_name="Vietcombank", exchange="HOSE", industry="bank"),
            Stock(symbol="TCB", company_name="Techcombank", exchange="HOSE", industry="bank"),
            ScreenerSnapshot(
                symbol="VCB",
                snapshot_date=date(2026, 2, 22),
                market_cap=12_000_000,
                price=91000,
            ),
            ScreenerSnapshot(
                symbol="TCB",
                snapshot_date=date(2026, 2, 22),
                market_cap=9_000_000,
                price=50000,
            ),
        ]
    )
    await test_db.commit()

    response = await client.get("/api/v1/sectors?symbol_limit=10")
    assert response.status_code == 200
    payload = response.json()

    assert "banking" in payload
    banking_symbols = payload["banking"]["symbols"]
    assert "VCB" in banking_symbols
    assert "TCB" in banking_symbols
