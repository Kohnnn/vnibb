import pytest
from datetime import date

from vnibb.models.stock import Stock
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.top_movers import SectorStockData, SectorTopMoversData
from vnibb.core.market_cap import reconcile_market_caps, resolve_market_cap


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
async def test_sector_top_movers_endpoint_returns_502_on_provider_error(client, monkeypatch):
    async def fake_fetch_sector_top_movers(*, type, limit_per_sector):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(
        "vnibb.api.v1.sectors.VnstockTopMoversFetcher.fetch_sector_top_movers",
        fake_fetch_sector_top_movers,
    )

    response = await client.get("/api/v1/sectors/top-movers?type=losers&limit=2")

    assert response.status_code == 502


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


def _certified_cap(value, as_of="2026-02-22"):
    return {
        "market_cap": value,
        "market_cap_source": "issuer:cap",
        "market_cap_unit": "VND",
        "market_cap_currency": "VND",
        "market_cap_as_of": as_of,
        "outstanding_shares": 100,
        "shares_unit": "shares",
        "shares_as_of": as_of,
        "shares_source": "issuer:shares",
        "share_basis": "outstanding",
    }


@pytest.mark.asyncio
async def test_sector_stocks_resolve_before_limit_and_expose_provenance(client, test_db):
    conflict = reconcile_market_caps(
        resolve_market_cap(_certified_cap(500), source="one"),
        resolve_market_cap(_certified_cap(600), source="two"),
    )
    records = [
        ("AAA", 10000, {}),
        ("BBB", 500, {"market_cap_provenance": conflict}),
        ("CCC", 300, _certified_cap(300)),
        ("DDD", 400, _certified_cap(400)),
    ]
    for symbol, cap, metadata in records:
        test_db.add(Stock(symbol=symbol, company_name=symbol, exchange="HOSE", industry="bank"))
        test_db.add(ScreenerSnapshot(symbol=symbol, snapshot_date=date(2026, 2, 22),
                                     market_cap=cap, price=10, pe=12, extended_metrics=metadata))
    await test_db.commit()

    limited = (await client.get("/api/v1/sectors/banking/stocks?limit=1")).json()
    assert limited["data"][0]["symbol"] == "DDD"
    assert limited["data"][0]["market_cap"] == 400
    assert limited["data"][0]["market_cap_provenance"]["status"] == "available"

    all_rows = (await client.get("/api/v1/sectors/banking/stocks?limit=10")).json()["data"]
    assert [row["symbol"] for row in all_rows] == ["DDD", "CCC", "AAA", "BBB"]
    by_symbol = {row["symbol"]: row for row in all_rows}
    assert by_symbol["AAA"]["market_cap"] is None
    assert by_symbol["AAA"]["market_cap_provenance"]["observations"][0]["value"] == 10000
    assert by_symbol["BBB"]["market_cap"] is None
    assert by_symbol["BBB"]["market_cap_provenance"]["status"] == "conflict"
    assert by_symbol["CCC"]["price"] == 10 and by_symbol["CCC"]["pe"] == 12


@pytest.mark.asyncio
async def test_sector_catalog_ranks_only_admitted_caps_before_limit(client, test_db):
    for index in range(6):
        symbol = f"T{index}"
        test_db.add(Stock(symbol=symbol, company_name=symbol, exchange="HOSE", industry="bank"))
        cap = 10000 if index == 0 else index * 100
        test_db.add(ScreenerSnapshot(symbol=symbol, snapshot_date=date(2026, 2, 22),
                                     market_cap=cap, extended_metrics={} if index == 0 else _certified_cap(cap)))
    await test_db.commit()

    response = await client.get("/api/v1/sectors?symbol_limit=5")
    assert response.status_code == 200
    assert response.json()["banking"]["symbols"] == ["T5", "T4", "T3", "T2", "T1"]
