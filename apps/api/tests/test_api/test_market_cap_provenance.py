from datetime import date

import pytest
from vnibb.core.market_cap import reconcile_market_caps, resolve_market_cap


def certified_cap(value=22_065_241_363_750, as_of="2026-10-26"):
    return {
        "market_cap": value,
        "market_cap_source": "issuer:capitalization",
        "market_cap_unit": "VND",
        "market_cap_currency": "VND",
        "market_cap_as_of": as_of,
        "share_basis": "outstanding",
        "outstanding_shares": 1_152_231_925,
        "shares_unit": "shares",
        "shares_as_of": as_of,
        "shares_source": "issuer:outstanding_shares",
    }


def test_captured_vci_values_are_preserved_but_not_admitted_or_rescaled():
    profile = resolve_market_cap(
        {"market_cap": 22_065_241_363_750, "outstanding_shares": 1_152_231_925,
         "updated_at": "2026-10-23T10:04:35.523132"},
        source="postgres:company_profile",
        price_record={"price": 19_150, "price_unit": "VND", "trade_date": "2026-10-26",
                      "price_source": "vietcap_vnd"},
    )
    screener = resolve_market_cap(
        {"market_cap": 22_410_910_941.25, "shares_outstanding": 1_152_231_925,
         "price": 19_150, "price_unit": "VND", "trade_date": "2026-10-26"},
        source="postgres:screener_snapshot",
    )
    result = reconcile_market_caps(profile, screener)
    assert result["status"] == "unavailable"
    assert result["value"] is None
    assert {item["value"] for item in result["observations"] if item["value"] is not None} == {
        22_065_241_363_750, 22_410_910_941.25,
    }
    assert result["observations"][0]["as_of"] is None
    assert result["observations"][0]["shares_as_of"] is None


def test_certified_cap_preserves_explicit_low_vnd_values():
    row = certified_cap(57.3 * 100)
    row.update(outstanding_shares=100, price=57.3, price_unit="VND",
               price_source="exchange:quote", trade_date=date(2026, 10, 26))
    result = resolve_market_cap(row, source="provider:sample")
    assert result["status"] == "available"
    assert result["value"] == 5_730
    assert result["unit"] == result["currency"] == "VND"
    assert result["as_of"] == "2026-10-26"
    assert result["share_basis"] == "outstanding"


def test_null_primary_fields_preserve_populated_certified_aliases():
    row = certified_cap()
    row.update(market_cap=None, marketCap=22_065_241_363_750,
               outstanding_shares=None, shares_outstanding=1_152_231_925,
               price=None, close=19_150, price_unit="VND", price_source="exchange:quote",
               trade_date="2026-10-26")
    result = resolve_market_cap(row, source="provider:sample")
    assert result["status"] == "available"
    assert result["value"] == 22_065_241_363_750
    assert result["observations"][0]["shares"] == 1_152_231_925
    assert result["observations"][1]["price"] == 19_150


def test_profile_provider_admits_sourced_share_alias_when_primary_is_null():
    from vnibb.providers.vnstock.equity_profile import (
        EquityProfileQueryParams,
        VnstockEquityProfileFetcher,
    )

    row = certified_cap()
    row.update(outstanding_shares=None, shares_outstanding=1_152_231_925)
    profile = VnstockEquityProfileFetcher.transform_data(EquityProfileQueryParams(symbol="VCI"), [row])[0]
    assert profile.outstanding_shares == 1_152_231_925
    assert profile.market_cap == 22_065_241_363_750
    assert profile.market_cap_provenance["status"] == "available"



def test_future_reported_and_derived_cap_dates_are_withheld_with_evidence():
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    future = (datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date() + timedelta(days=1)).isoformat()
    row = certified_cap(as_of=future)
    reported = resolve_market_cap(row, source="provider:sample")
    assert reported["status"] == "unavailable"
    assert reported["value"] is None
    assert reported["observations"][0]["as_of"] == future
    assert reported["observations"][0]["value"] == 22_065_241_363_750
    row.pop("market_cap")
    derived = resolve_market_cap(
        {}, source="provider:sample", shares_record=row,
        price_record={"price": 19_150, "price_unit": "VND", "price_source": "exchange:quote",
                      "trade_date": future},
    )
    assert derived["status"] == "unavailable"
    assert derived["value"] is None
    assert derived["observations"][0]["price_as_of"] == future


def test_serialized_future_cap_cannot_bypass_date_admission():
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    result = resolve_market_cap(certified_cap(), source="provider:sample")
    future = (datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date() + timedelta(days=1)).isoformat()
    result["observations"][0].update(as_of=future, shares_as_of=future)
    restored = resolve_market_cap({"market_cap": result["value"], "market_cap_provenance": result}, source="postgres:snapshot")
    assert restored["status"] == "unavailable"
    assert restored["value"] is None



@pytest.mark.parametrize("field,value", [
    ("market_cap_unit", None), ("market_cap_currency", None),
    ("market_cap_as_of", None), ("shares_as_of", None),
    ("shares_unit", None), ("share_basis", "listed"), ("shares_source", None),
    ("shares_as_of", "2026-10-23"), ("market_cap_as_of", "not-a-date"),
])
def test_unproven_cap_basis_is_unavailable(field, value):
    row = certified_cap()
    row[field] = value
    result = resolve_market_cap(row, source="provider:sample")
    assert result["status"] == "unavailable"
    assert result["value"] is None


def test_certified_same_date_values_that_disagree_are_conflicting():
    result = reconcile_market_caps(
        resolve_market_cap(certified_cap(), source="provider:profile"),
        resolve_market_cap(certified_cap(22_410_910_941.25), source="provider:screener"),
    )
    assert result["status"] == "conflict"
    assert result["value"] is None
    assert len(result["observations"]) == 2


def test_different_certified_dates_are_not_silently_combined():
    result = reconcile_market_caps(
        resolve_market_cap(certified_cap(), source="provider:profile"),
        resolve_market_cap(certified_cap(as_of="2026-10-23"), source="provider:screener"),
    )
    assert result["status"] == "conflict"
    assert result["as_of"] is None


def test_derived_cap_requires_explicit_aligned_outstanding_share_basis():
    shares = certified_cap()
    shares.pop("market_cap")
    price = {"close": 19_150, "price_unit": "VND", "time": "2026-10-26T00:00:00",
             "price_source": "vietcap_vnd"}
    result = resolve_market_cap({}, source="postgres:profile", price_record=price, shares_record=shares)
    assert result["status"] == "available"
    assert result["value"] == 22_065_241_363_750
    assert result["observations"][0]["calculation"] == "price * outstanding_shares"
    assert result["observations"][0]["shares"] == 1_152_231_925


def test_derived_cap_does_not_infer_million_shares_or_substitute_listed_shares():
    result = resolve_market_cap(
        {}, source="postgres:profile",
        price_record={"price": 19_150, "price_unit": "VND", "trade_date": "2026-10-26"},
        shares_record={"outstanding_shares": 1_152.231925, "listed_shares": 1_152_231_925},
    )
    assert result["status"] == "unavailable"
    assert result["value"] is None
    assert result["observations"][0]["shares"] == 1_152.231925
    assert result["observations"][0]["value"] is None


def test_serialized_provenance_is_revalidated_without_losing_original_observations():
    result = resolve_market_cap(certified_cap(), source="provider:sample")
    restored = resolve_market_cap({"market_cap": result["value"], "market_cap_provenance": result}, source="postgres:snapshot")
    assert restored == result
    forged = {**result, "status": "available", "value": 1}
    forged["observations"] = [{**result["observations"][0], "unit": None}]
    assert resolve_market_cap({"market_cap": 1, "market_cap_provenance": forged}, source="postgres:snapshot")["value"] is None


def test_stored_conflict_survives_additional_price_and_share_inputs():
    cap = resolve_market_cap(certified_cap(), source="provider:sample")
    conflicting = {**cap, "status": "conflict", "value": None}
    result = resolve_market_cap(
        {"market_cap_provenance": conflicting}, source="postgres:snapshot",
        price_record={"price": 19_150, "price_unit": "VND", "trade_date": "2026-10-26",
                      "price_source": "exchange:quote"},
        shares_record=certified_cap(),
    )
    assert result["status"] == "conflict"
    assert result["value"] is None


@pytest.mark.asyncio
async def test_profile_and_screener_apis_withhold_captured_vci_caps(client, test_db, monkeypatch):
    from datetime import datetime

    from vnibb.models.company import Company
    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock, StockPrice

    test_db.add_all([
        Stock(id=1, symbol="VCI", company_name="Vietcap", exchange="HOSE", industry="Securities"),
        Company(symbol="VCI", company_name="Vietcap", exchange="HOSE", industry="Securities",
                outstanding_shares=1_152_231_925, listed_shares=1_152_231_925,
                updated_at=datetime.utcnow(), raw_data={"market_cap": 22_065_241_363_750}),
        StockPrice(id=1, stock_id=1, symbol="VCI", time=date(2026, 10, 26),
                   open=19_600, high=19_650, low=19_150, close=19_150, volume=5_820_000,
                   interval="1D", source="vietcap_vnd"),
        ScreenerSnapshot(symbol="VCI", snapshot_date=date.today(), trade_date=date(2026, 10, 26),
                         market_cap=22_410_910_941.25, price=19_150, company_name="Vietcap",
                         exchange="HOSE", industry="Securities", extended_metrics={
                             "price_unit": "VND", "price_source": "vietcap_vnd",
                             "shares_outstanding": 1_152_231_925,
                         }),
    ])
    await test_db.commit()

    from vnibb.providers.vnstock.equity_screener import ScreenerData

    async def captured_provider(_params):
        return [ScreenerData(
            symbol="VCI", organ_name="Vietcap", exchange="HOSE", industry_name="Securities",
            price=19_150, price_unit="VND", price_source="vietcap_vnd",
            trade_date="2026-10-26", market_cap=22_410_910_941.25,
            shares_outstanding=1_152_231_925,
        )]

    monkeypatch.setattr("vnibb.api.v1.screener.VnstockScreenerFetcher.fetch", captured_provider)

    profile = (await client.get("/api/v1/equity/VCI/profile")).json()["data"]
    screener = (await client.get("/api/v1/screener?symbol=VCI&limit=1")).json()["data"][0]
    live = (await client.get("/api/v1/screener?symbol=VCI&limit=1&use_cache=false")).json()["data"][0]
    assert live["market_cap"] is None
    assert live["market_cap_provenance"]["status"] == "unavailable"
    for cache in ("true", "false"):
        filtered = await client.get(f"/api/v1/screener?symbol=VCI&limit=1&use_cache={cache}&market_cap_min=1")
        assert filtered.json()["data"] == []

    assert profile["market_cap"] is None
    assert screener["market_cap"] is None
    assert profile["market_cap_provenance"]["status"] == "unavailable"
    assert screener["market_cap_provenance"]["status"] == "unavailable"
    assert {item["value"] for item in profile["market_cap_provenance"]["observations"]
            if item.get("value") is not None} == {22_065_241_363_750, 22_410_910_941.25}


@pytest.mark.asyncio
@pytest.mark.parametrize("price,shares", [(57.3, 100), (19_150, 1_152_231_925), (85_000, 2_000_000)])
async def test_profile_api_preserves_certified_fixture_samples(client, test_db, price, shares):
    from datetime import datetime

    from vnibb.models.company import Company
    from vnibb.models.stock import Stock, StockPrice

    row = certified_cap(price * shares)
    row.update(outstanding_shares=shares, market_cap_source="fixture:certified_cap",
               shares_source="fixture:outstanding_shares")
    test_db.add_all([
        Stock(id=1, symbol="FPT", company_name="Certified fixture", exchange="HOSE"),
        Company(symbol="FPT", company_name="Certified fixture", outstanding_shares=shares,
                updated_at=datetime.utcnow(), raw_data=row),
        StockPrice(id=1, stock_id=1, symbol="FPT", time=date(2026, 10, 26),
                   open=price, high=price, low=price, close=price, volume=1,
                   interval="1D", source="vietcap_vnd"),
    ])
    await test_db.commit()

    response = await client.get("/api/v1/equity/FPT/profile")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["market_cap"] == price * shares
    assert data["market_cap_provenance"]["status"] == "available"
    assert data["market_cap_provenance"]["shares_as_of"] == "2026-10-26"



@pytest.mark.asyncio
async def test_profile_api_exposes_same_date_certified_cap_conflict(client, test_db):
    from datetime import datetime

    from vnibb.models.company import Company
    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock

    profile_cap = certified_cap()
    screener_cap = resolve_market_cap(certified_cap(22_410_910_941.25), source="fixture:screener")
    test_db.add_all([
        Stock(id=1, symbol="VCI", company_name="Vietcap", exchange="HOSE"),
        Company(symbol="VCI", company_name="Vietcap", outstanding_shares=1_152_231_925,
                updated_at=datetime.utcnow(), raw_data=profile_cap),
        ScreenerSnapshot(symbol="VCI", snapshot_date=date.today(), market_cap=screener_cap["value"],
                         extended_metrics={"market_cap_provenance": screener_cap}),
    ])
    await test_db.commit()

    response = await client.get("/api/v1/equity/VCI/profile")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["market_cap"] is None
    assert data["market_cap_provenance"]["status"] == "conflict"
    assert len([item for item in data["market_cap_provenance"]["observations"]
                if item.get("value") is not None]) == 2


@pytest.mark.asyncio
async def test_explicit_sparse_profile_refresh_retains_stored_share_lineage(client, test_db, monkeypatch):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from sqlalchemy import select
    from vnibb.models.company import Company
    from vnibb.models.stock import Stock, StockPrice
    from vnibb.providers.vnstock.equity_profile import (
        EquityProfileData,
        VnstockEquityProfileFetcher,
    )

    day = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date() - timedelta(days=1)
    shares = {"outstanding_shares": 100, "shares_unit": "shares", "shares_as_of": day.isoformat(),
              "shares_source": "issuer:shares", "share_basis": "outstanding"}
    test_db.add_all([
        Stock(id=1, symbol="FPT", company_name="Fixture", exchange="HOSE"),
        Company(symbol="FPT", company_name="Fixture", outstanding_shares=100,
                updated_at=datetime.utcnow(), raw_data=shares),
        StockPrice(id=1, stock_id=1, symbol="FPT", time=day, open=10, high=10, low=10,
                   close=10, volume=1, interval="1D", source="vietcap_vnd"),
    ])
    await test_db.commit()

    async def fetch(_params):
        return [EquityProfileData(symbol="FPT", company_name="Updated")]

    monkeypatch.setattr(VnstockEquityProfileFetcher, "fetch", fetch)
    refreshed = (await client.get("/api/v1/equity/FPT/profile?refresh=true")).json()
    assert refreshed["meta"]["cache_write_status"] == "stored"
    assert refreshed["data"]["market_cap"] == 1000
    assert refreshed["data"]["market_cap_provenance"]["shares_source"] == "issuer:shares"
    raw = (await test_db.execute(select(Company.raw_data).where(Company.symbol == "FPT"))).scalar_one()
    assert all(raw[key] == value for key, value in shares.items())
    cached = (await client.get("/api/v1/equity/FPT/profile")).json()["data"]
    assert cached["market_cap"] == 1000
    assert cached["market_cap_provenance"]["shares_source"] == "issuer:shares"


@pytest.mark.asyncio
async def test_profile_ignores_future_price_before_selecting_valid_quote(client, test_db):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from vnibb.models.company import Company
    from vnibb.models.stock import Stock, StockPrice

    today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    day = today - timedelta(days=1)
    test_db.add_all([
        Stock(id=1, symbol="FPT", company_name="Fixture", exchange="HOSE"),
        Company(symbol="FPT", company_name="Fixture", outstanding_shares=100,
                updated_at=datetime.utcnow(), raw_data={
                    "outstanding_shares": 100, "shares_unit": "shares", "shares_as_of": day.isoformat(),
                    "shares_source": "issuer:shares", "share_basis": "outstanding"}),
        StockPrice(id=1, stock_id=1, symbol="FPT", time=day, open=10, high=10, low=10,
                   close=10, volume=1, interval="1D", source="vietcap_vnd"),
        StockPrice(id=2, stock_id=1, symbol="FPT", time=today + timedelta(days=1),
                   open=20, high=20, low=20, close=20, volume=1, interval="1D", source="vietcap_vnd"),
    ])
    await test_db.commit()
    data = (await client.get("/api/v1/equity/FPT/profile")).json()["data"]
    assert data["market_cap"] == 1000
    observation = data["market_cap_provenance"]["observations"][0]
    assert observation["price_as_of"] == day.isoformat()
    assert observation["price"] == 10
    assert observation["price_source"] == "vietcap_vnd"


@pytest.mark.asyncio
async def test_refresh_reconciles_stored_and_incoming_profile_caps(client, test_db, monkeypatch):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from vnibb.models.company import Company
    from vnibb.models.stock import Stock
    from vnibb.providers.vnstock.equity_profile import (
        EquityProfileData,
        VnstockEquityProfileFetcher,
    )

    day = (datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date() - timedelta(days=1)).isoformat()
    old = certified_cap(1000, as_of=day)
    incoming = certified_cap(2000, as_of=day)
    test_db.add_all([Stock(id=1, symbol="FPT", company_name="Fixture", exchange="HOSE"),
                     Company(symbol="FPT", company_name="Fixture", raw_data=old, updated_at=datetime.utcnow())])
    await test_db.commit()

    async def fetch(_params):
        return [EquityProfileData(symbol="FPT", market_cap=2000,
                                  market_cap_provenance=resolve_market_cap(incoming, source="fixture:incoming"))]

    monkeypatch.setattr(VnstockEquityProfileFetcher, "fetch", fetch)
    response = (await client.get("/api/v1/equity/FPT/profile?refresh=true")).json()
    cap = response["data"]["market_cap_provenance"]
    assert response["meta"]["cache_write_status"] == "stored"
    assert response["data"]["market_cap"] is None
    assert cap["status"] == "conflict"
    assert {item["value"] for item in cap["observations"] if item.get("value") is not None} == {1000, 2000}


@pytest.mark.asyncio
async def test_profile_does_not_attach_raw_metadata_to_mismatched_column(client, test_db):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from vnibb.models.company import Company
    from vnibb.models.stock import Stock

    day = (datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date() - timedelta(days=1)).isoformat()
    test_db.add_all([
        Stock(id=1, symbol="FPT", company_name="Fixture", exchange="HOSE"),
        Company(symbol="FPT", company_name="Fixture", outstanding_shares=850.1,
                updated_at=datetime.utcnow(), raw_data={"outstanding_shares": 7,
                    "shares_unit": "shares", "shares_as_of": day,
                    "shares_source": "issuer:shares", "share_basis": "outstanding"}),
    ])
    await test_db.commit()
    data = (await client.get("/api/v1/equity/FPT/profile")).json()["data"]
    assert data["outstanding_shares"] == 850.1
    assert all(data[key] is None for key in ("shares_unit", "shares_as_of", "shares_source", "share_basis"))
    assert data["shares_outstanding_provenance"]["observations"][0]["value"] == 7


@pytest.mark.asyncio
async def test_profile_selects_valid_snapshot_before_future_snapshot(client, test_db):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from vnibb.models.company import Company
    from vnibb.models.screener import ScreenerSnapshot
    from vnibb.models.stock import Stock

    today = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()
    day = today - timedelta(days=1)
    valid = resolve_market_cap(certified_cap(1000, as_of=day.isoformat()), source="fixture:valid")
    future = resolve_market_cap(certified_cap(2000, as_of=(today + timedelta(days=1)).isoformat()), source="fixture:future")
    test_db.add_all([
        Stock(id=1, symbol="FPT", company_name="Fixture", exchange="HOSE"),
        Company(symbol="FPT", company_name="Fixture", updated_at=datetime.utcnow(), raw_data={}),
        ScreenerSnapshot(symbol="FPT", snapshot_date=day, market_cap=1000,
                         extended_metrics={"market_cap_provenance": valid}),
        ScreenerSnapshot(symbol="FPT", snapshot_date=today + timedelta(days=1), market_cap=2000,
                         extended_metrics={"market_cap_provenance": future}),
    ])
    await test_db.commit()
    cap = (await client.get("/api/v1/equity/FPT/profile")).json()["data"]["market_cap_provenance"]
    assert cap["status"] == "available"
    assert cap["value"] == 1000
    assert {item["value"] for item in cap["observations"] if item.get("value") is not None} == {1000}


@pytest.mark.asyncio
async def test_profile_refresh_preserves_incoming_and_stored_share_conflicts(client, test_db, monkeypatch):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from vnibb.models.company import Company
    from vnibb.models.stock import Stock
    from vnibb.providers.vnstock.equity_profile import (
        EquityProfileQueryParams,
        VnstockEquityProfileFetcher,
    )

    day = (datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date() - timedelta(days=1)).isoformat()
    old = certified_cap(1000, as_of=day)
    test_db.add_all([
        Stock(id=1, symbol="FPT", company_name="Fixture", exchange="HOSE"),
        Company(symbol="FPT", company_name="Fixture", outstanding_shares=old["outstanding_shares"],
                updated_at=datetime.utcnow(), raw_data=old),
    ])
    await test_db.commit()
    row = {"symbol": "FPT", "outstanding_shares": 7, "shares_outstanding": 8,
           "shares_unit": "shares", "shares_as_of": day, "shares_source": "issuer:new",
           "share_basis": "outstanding"}

    async def fetch(_params):
        return VnstockEquityProfileFetcher.transform_data(EquityProfileQueryParams(symbol="FPT"), [row])

    monkeypatch.setattr(VnstockEquityProfileFetcher, "fetch", fetch)
    refreshed = (await client.get("/api/v1/equity/FPT/profile?refresh=true")).json()["data"]
    cached = (await client.get("/api/v1/equity/FPT/profile")).json()["data"]
    for data in (refreshed, cached):
        assert data["outstanding_shares"] is None
        assert data["market_cap"] is None
        assert data["market_cap_provenance"]["status"] == "conflict"
        evidence = data["shares_outstanding_provenance"]
        assert evidence["status"] == "conflict"
        assert {item["value"] for item in evidence["observations"]} == {7, 8, old["outstanding_shares"]}



@pytest.mark.asyncio
async def test_failed_refresh_reconciles_stored_and_incoming_caps(client, test_db, monkeypatch):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from vnibb.models.company import Company
    from vnibb.models.stock import Stock
    from vnibb.providers.vnstock.equity_profile import (
        EquityProfileData,
        VnstockEquityProfileFetcher,
    )
    from vnibb.services.cache_manager import CacheManager

    day = (datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date() - timedelta(days=1)).isoformat()
    old = certified_cap(1000, as_of=day)
    incoming = certified_cap(2000, as_of=day)
    test_db.add_all([Stock(id=1, symbol="FPT", company_name="Fixture", exchange="HOSE"),
                     Company(symbol="FPT", company_name="Fixture", raw_data=old, updated_at=datetime.utcnow())])
    await test_db.commit()

    async def fetch(_params):
        return [EquityProfileData(symbol="FPT", market_cap=2000,
                                  market_cap_provenance=resolve_market_cap(incoming, source="fixture:incoming"))]

    async def fail_store(*args, **kwargs):
        return False

    monkeypatch.setattr(VnstockEquityProfileFetcher, "fetch", fetch)
    monkeypatch.setattr(CacheManager, "store_profile_data", fail_store)
    response = (await client.get("/api/v1/equity/FPT/profile?refresh=true")).json()
    assert response["meta"]["cache_write_status"] == "failed"
    assert response["data"]["market_cap"] is None
    assert response["data"]["market_cap_provenance"]["status"] == "conflict"
