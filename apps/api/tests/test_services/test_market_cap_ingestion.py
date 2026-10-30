import asyncio
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from vnibb.core.market_cap import resolve_market_cap
from vnibb.models.company import Company
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.sync_status import SyncStatus
from vnibb.providers.vnstock.equity_profile import (
    EquityProfileData,
    EquityProfileQueryParams,
    VnstockEquityProfileFetcher,
)
from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher
from vnibb.services.cache_manager import CacheManager


def certified_cap(value=5730):
    return {
        "market_cap": value, "market_cap_source": "issuer:capitalization",
        "market_cap_unit": "VND", "market_cap_currency": "VND",
        "market_cap_as_of": "2026-10-26", "share_basis": "outstanding",
        "outstanding_shares": 100, "shares_unit": "shares",
        "shares_as_of": "2026-10-26", "shares_source": "issuer:shares",
    }


def test_provider_gates_legacy_and_charter_without_scaling():
    row = {"symbol": "VNM", "market_cap": 1234, "charter_capital": 999,
           "outstanding_shares": 7, "listed_volume": 6}
    profile = VnstockEquityProfileFetcher.transform_data(EquityProfileQueryParams(symbol="VNM"), [row])[0]
    screener = VnstockScreenerFetcher.transform_data(StockScreenerParams(), [row])[0]
    assert profile.outstanding_shares == 7
    assert profile.listed_shares == 6
    for result in (profile, screener):
        assert result.market_cap is None
        assert any(obs["value"] == 1234 for obs in result.market_cap_provenance["observations"])
    charter = VnstockScreenerFetcher.transform_data(
        StockScreenerParams(), [{"symbol": "VNM", "charter_capital": 999}]
    )[0]
    assert charter.market_cap is None
    assert not charter.market_cap_provenance["observations"]


@pytest.mark.asyncio
async def test_certified_provider_snapshot_and_profile_lineage_roundtrip(test_db):
    payload = {"symbol": "VNM", **certified_cap()}
    profile = VnstockEquityProfileFetcher.transform_data(EquityProfileQueryParams(symbol="VNM"), [payload])[0]
    screener = VnstockScreenerFetcher.transform_data(StockScreenerParams(), [payload])[0]
    manager = CacheManager(test_db)
    assert await manager.store_profile_data("VNM", profile.model_dump(mode="json"))
    assert await manager.store_screener_data([screener.model_dump(mode="json")]) == 1
    test_db.expire_all()
    company = (await test_db.execute(select(Company).where(Company.symbol == "VNM"))).scalar_one()
    snapshot = (await test_db.execute(select(ScreenerSnapshot).where(
        ScreenerSnapshot.symbol == "VNM", ScreenerSnapshot.snapshot_date == datetime.utcnow().date()
    ))).scalar_one()
    assert resolve_market_cap(company.raw_data, source="postgres:profile")["value"] == 5730
    assert resolve_market_cap({"market_cap": snapshot.market_cap, "extended_metrics": snapshot.extended_metrics},
                              source="postgres:snapshot")["value"] == 5730


@pytest.mark.asyncio
async def test_partial_writes_keep_cap_and_provenance_atomic(test_db):
    manager = CacheManager(test_db)
    assert await manager.store_screener_data([{"symbol": "VNM", **certified_cap()}]) == 1
    assert await manager.store_screener_data([{"symbol": "VNM", "price": 57.3, "pe": 12}]) == 1
    test_db.expire_all()
    query = select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM", ScreenerSnapshot.snapshot_date == datetime.utcnow().date())
    snapshot = (await test_db.execute(query)).scalar_one()
    assert snapshot.market_cap == 5730
    assert snapshot.extended_metrics["market_cap_provenance"]["value"] == 5730
    assert await manager.store_screener_data([{"symbol": "VNM", "market_cap": 1234}]) == 1
    test_db.expire_all()
    snapshot = (await test_db.execute(query)).scalar_one()
    assert snapshot.market_cap is None
    evidence = snapshot.extended_metrics["market_cap_provenance"]
    assert evidence["value"] is None
    assert {obs["value"] for obs in evidence["observations"]} >= {5730, 1234}


@pytest.mark.asyncio
async def test_profile_sparse_refresh_retains_cap_pair_then_replaces_both(test_db):
    manager = CacheManager(test_db)
    assert await manager.store_profile_data("VNM", certified_cap())
    assert await manager.store_profile_data("VNM", {"company_name": "New name"})
    test_db.expire_all()
    query = select(Company).where(Company.symbol == "VNM")
    company = (await test_db.execute(query)).scalar_one()
    assert company.raw_data["market_cap"] == 5730
    assert company.raw_data["market_cap_provenance"]["value"] == 5730
    assert await manager.store_profile_data("VNM", {"market_cap": 1234})
    test_db.expire_all()
    company = (await test_db.execute(query)).scalar_one()
    assert company.raw_data["market_cap"] is None
    assert company.raw_data["market_cap_provenance"]["value"] is None
    assert any(obs["value"] == 1234 for obs in company.raw_data["market_cap_provenance"]["observations"])


@pytest.mark.asyncio
@pytest.mark.parametrize("second,expected", [(5730, "available"), (6000, "conflict")])
async def test_cache_same_day_cap_reconciliation_survives_later_write(test_db, second, expected):
    manager = CacheManager(test_db)
    assert await manager.store_screener_data([
        {"symbol": "VNM", **certified_cap()},
        {"symbol": "VNM", **certified_cap(second)},
    ]) == 2
    assert await manager.store_screener_data([{"symbol": "VNM", **certified_cap()}]) == 1
    test_db.expire_all()
    row = (await test_db.execute(select(ScreenerSnapshot).where(
        ScreenerSnapshot.symbol == "VNM", ScreenerSnapshot.snapshot_date == datetime.utcnow().date()
    ))).scalar_one()
    cap = row.extended_metrics["market_cap_provenance"]
    assert cap["status"] == expected
    assert row.market_cap == (5730 if expected == "available" else None)
    assert {obs["value"] for obs in cap["observations"]} >= {5730, second}
    assert resolve_market_cap({"market_cap": row.market_cap, "extended_metrics": row.extended_metrics},
                              source="test")["status"] == expected


@pytest.mark.asyncio
async def test_profile_model_dump_sparse_shares_preserves_lineage_and_unknown_replaces_it(test_db):
    manager = CacheManager(test_db)
    assert await manager.store_profile_data("VNM", certified_cap())
    assert await manager.store_profile_data("VNM", EquityProfileData(symbol="VNM", company_name="New").model_dump(mode="json"))
    test_db.expire_all()
    query = select(Company).where(Company.symbol == "VNM")
    company = (await test_db.execute(query)).scalar_one()
    for key in ("outstanding_shares", "shares_unit", "shares_as_of", "shares_source", "share_basis"):
        assert company.raw_data[key] == certified_cap()[key]
    derived = resolve_market_cap({}, source="test", shares_record=company.raw_data,
        price_record={"price": 57.3, "price_unit": "VND", "price_source": "quote",
                      "trade_date": "2026-10-26"})
    assert derived["value"] == 5730
    assert await manager.store_profile_data("VNM", EquityProfileData(symbol="VNM", outstanding_shares=200).model_dump(mode="json"))
    test_db.expire_all()
    company = (await test_db.execute(query)).scalar_one()
    assert company.raw_data["outstanding_shares"] == 200
    assert all(company.raw_data.get(key) is None for key in ("shares_unit", "shares_as_of", "shares_source", "share_basis"))
    derived = resolve_market_cap({}, source="test", shares_record=company.raw_data,
        price_record={"price": 57.3, "price_unit": "VND", "price_source": "quote",
                      "trade_date": "2026-10-26"})
    assert derived["value"] is None


@pytest.mark.parametrize("dialect,insert", [(postgresql.dialect(), pg_insert), (sqlite.dialect(), sqlite_insert)])
def test_snapshot_upsert_compiles_for_both_dialects(dialect, insert):
    from vnibb.services.screener_metadata import screener_metadata_updates

    stmt = insert(ScreenerSnapshot).values(symbol="VNM", snapshot_date=datetime.utcnow().date())
    updates = screener_metadata_updates(stmt, dialect.name, stmt.excluded.price.is_(None))
    sql = str(stmt.on_conflict_do_update(index_elements=["symbol", "snapshot_date"], set_=updates)
              .returning(*ScreenerSnapshot.__table__.c).compile(dialect=dialect))
    assert "ON CONFLICT" in sql and "RETURNING" in sql


@pytest.mark.asyncio
async def test_concurrent_snapshot_writes_retain_both_observations(test_engine, tmp_path):
    sqlite_engine = None
    if test_engine.dialect.name == "sqlite":
        sqlite_engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'snapshot.db'}")
        async with sqlite_engine.begin() as connection:
            await connection.run_sync(ScreenerSnapshot.__table__.create)
            await connection.run_sync(SyncStatus.__table__.create)
    engine = sqlite_engine or test_engine
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    symbol = f"C{uuid4().hex[:7]}".upper()

    async def write(value):
        async with sessions() as session:
            return await CacheManager(session).store_screener_data([{"symbol": symbol, **certified_cap(value)}])

    try:
        assert await asyncio.gather(write(5730), write(6000)) == [1, 1]
        async with sessions() as session:
            row = (await session.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == symbol))).scalar_one()
            cap = row.extended_metrics["market_cap_provenance"]
            assert row.market_cap is None and cap["status"] == "conflict"
            assert {obs["value"] for obs in cap["observations"]} >= {5730, 6000}
            await session.delete(row)
            await session.commit()
    finally:
        if sqlite_engine is not None:
            await sqlite_engine.dispose()
