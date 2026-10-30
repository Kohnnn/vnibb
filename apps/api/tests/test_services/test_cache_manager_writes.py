"""Persistence regressions for atomic cache writer upserts."""

from datetime import date, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError

from vnibb.models.company import Company
from vnibb.models.stock import Stock
from vnibb.services.cache_manager import CacheManager


@pytest.mark.asyncio
async def test_listing_duplicate_absent_symbols_keep_other_rows_and_last_nonempty_values(test_db):
    suffix = uuid4().hex[:7].upper()
    duplicate, other = f"D{suffix}", f"O{suffix}"

    stored = await CacheManager(test_db).store_listing_data(
        [
            {"symbol": duplicate.lower(), "company_name": "First", "exchange": "HNX", "industry": "Banks"},
            {"ticker": duplicate, "company_name": "Last", "exchange": "", "sector": "Finance"},
            {"symbol": other, "company_name": "Other Co"},
        ]
    )

    rows = await test_db.execute(select(Stock).where(Stock.symbol.in_([duplicate, other])))
    by_symbol = {row.symbol: row for row in rows.scalars()}
    assert stored == 3
    assert set(by_symbol) == {duplicate, other}
    assert by_symbol[duplicate].company_name == "Last"
    assert by_symbol[duplicate].exchange == "HNX"
    assert by_symbol[duplicate].industry == "Banks"
    assert by_symbol[duplicate].sector == "Finance"
    assert by_symbol[other].company_name == "Other Co"
    await test_db.execute(Stock.__table__.delete().where(Stock.symbol.in_([duplicate, other])))
    await test_db.commit()

@pytest.mark.asyncio
async def test_listing_conflict_preserves_created_at_and_sparse_existing_fields(test_db):
    symbol = f"E{uuid4().hex[:7]}".upper()
    original_created_at = datetime(2020, 1, 1)
    test_db.add(Stock(symbol=symbol, company_name="Original", exchange="HOSE", created_at=original_created_at))
    await test_db.commit()

    assert await CacheManager(test_db).store_listing_data(
        [{"symbol": symbol.lower(), "company_name": "Updated", "exchange": "HNX", "sector": "Finance"}]
    ) == 1
    stock = (await test_db.execute(select(Stock).where(Stock.symbol == symbol))).scalar_one()
    assert stock.company_name == "Updated"
    assert stock.exchange == "HNX"
    assert stock.created_at == original_created_at
    await test_db.execute(Stock.__table__.delete().where(Stock.symbol == symbol))
    await test_db.commit()

@pytest.mark.asyncio
async def test_iq_delisting_changes_only_explicit_confirmed_symbol(test_db):
    suffix = uuid4().hex[:7].upper()
    old, untouched = f"D{suffix}", f"U{suffix}"
    test_db.add_all([Stock(symbol=old, exchange="HOSE", is_active=1), Stock(symbol=untouched, exchange="HOSE", is_active=1)])
    await test_db.commit()
    assert await CacheManager(test_db).store_listing_data([{ "symbol": old, "exchange": "DELISTED", "is_active": 0}], source="vietcap") == 1
    test_db.expire_all()
    rows = (await test_db.execute(select(Stock).where(Stock.symbol.in_([old, untouched])))).scalars().all()
    assert {row.symbol: row.is_active for row in rows} == {old: 0, untouched: 1}
    await test_db.execute(Stock.__table__.delete().where(Stock.symbol.in_([old, untouched])))
    await test_db.commit()


@pytest.mark.asyncio
async def test_profile_sparse_update_preserves_existing_fields_and_normalizes_values(test_db):
    symbol = f"P{uuid4().hex[:7]}".upper()
    created_at = datetime(2020, 1, 1)
    test_db.add(
        Company(
            symbol=symbol,
            company_name="Existing Co",
            short_name="Existing",
            website="https://existing.example",
            established_date=date(2001, 2, 3),
            outstanding_shares=5_000_000,
            listed_shares=5_000_000,
            raw_data={"existing": True},
            created_at=created_at,
        )
    )
    await test_db.commit()

    assert await CacheManager(test_db).store_profile_data(
        symbol.lower(),
        {"company_name": "Updated Co", "description": "Updated description", "outstanding_shares": 7},
    )

    company = (await test_db.execute(select(Company).where(Company.symbol == symbol))).scalar_one()
    assert company.company_name == "Updated Co"
    assert company.short_name == "Existing"
    assert company.website == "https://existing.example"
    assert company.established_date == date(2001, 2, 3)
    assert company.outstanding_shares == 7
    assert company.listed_shares == 5_000_000
    assert company.business_description == "Updated description"
    assert company.raw_data["existing"] is True
    assert company.raw_data["outstanding_shares"] == 7
    assert company.raw_data["market_cap"] is None
    assert company.raw_data["market_cap_provenance"]["status"] == "unavailable"
    assert company.created_at == created_at
    await test_db.execute(Company.__table__.delete().where(Company.symbol == symbol))
    await test_db.commit()


@pytest.mark.asyncio
async def test_profile_rejected_upsert_rolls_back_and_reports_failure(test_db, monkeypatch):
    execute = AsyncMock(side_effect=ProgrammingError(
        "INSERT INTO companies", {},
        RuntimeError("no unique or exclusion constraint matching the ON CONFLICT specification"),
    ))
    rollback = AsyncMock(wraps=test_db.rollback)
    commit = AsyncMock(wraps=test_db.commit)
    monkeypatch.setattr(test_db, "execute", execute)
    monkeypatch.setattr(test_db, "rollback", rollback)
    monkeypatch.setattr(test_db, "commit", commit)

    assert await CacheManager(test_db).store_profile_data(
        "VNM", {"company_name": "Vinamilk"}
    ) is False
    rollback.assert_awaited_once()
    commit.assert_not_awaited()


def _certified_profile_cap(value, day):
    return {
        "market_cap": value, "market_cap_unit": "VND", "market_cap_currency": "VND",
        "market_cap_source": "issuer:cap", "market_cap_as_of": day,
        "outstanding_shares": 100, "shares_unit": "shares", "shares_as_of": day,
        "shares_source": "issuer:shares", "share_basis": "outstanding",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("incoming,expected", [
    ({"market_cap": 2000, "market_cap_unit": "VND", "market_cap_currency": "VND",
      "market_cap_source": "issuer:cap", "market_cap_as_of": "2020-01-02",
      "outstanding_shares": 100, "shares_unit": "shares", "shares_as_of": "2020-01-02",
      "shares_source": "issuer:shares", "share_basis": "outstanding"}, "conflict"),
    ({"market_cap": 2000}, "unavailable"),
    ({"market_cap": 2000, "market_cap_unit": "VND", "market_cap_currency": "VND",
      "market_cap_source": "issuer:cap", "market_cap_as_of": "2020-01-03",
      "outstanding_shares": 100, "shares_unit": "shares", "shares_as_of": "2020-01-03",
      "shares_source": "issuer:shares", "share_basis": "outstanding"}, "conflict"),
])
async def test_profile_cap_refresh_preserves_old_and_incoming_evidence(test_db, incoming, expected):
    symbol = f"C{uuid4().hex[:7]}".upper()
    manager = CacheManager(test_db)
    assert await manager.store_profile_data(symbol, _certified_profile_cap(1000, "2020-01-02"))
    assert await manager.store_profile_data(symbol, incoming)
    raw = (await test_db.execute(select(Company.raw_data).where(Company.symbol == symbol))).scalar_one()
    cap = raw["market_cap_provenance"]
    assert cap["status"] == expected
    assert cap["value"] is None
    assert {item["value"] for item in cap["observations"] if item.get("value") is not None} == {1000, 2000}
    if expected == "conflict" and incoming.get("market_cap_as_of") == "2020-01-03":
        assert {item["as_of"] for item in cap["observations"] if item.get("value")} == {"2020-01-02", "2020-01-03"}
    await test_db.execute(Company.__table__.delete().where(Company.symbol == symbol))
    await test_db.commit()


@pytest.mark.asyncio
async def test_sparse_profile_refresh_keeps_certified_cap_and_share_provenance(test_db):
    symbol = f"S{uuid4().hex[:7]}".upper()
    manager = CacheManager(test_db)
    assert await manager.store_profile_data(symbol, _certified_profile_cap(1000, "2020-01-02"))
    assert await manager.store_profile_data(symbol, {"company_name": "Updated"})
    raw = (await test_db.execute(select(Company.raw_data).where(Company.symbol == symbol))).scalar_one()
    assert raw["market_cap_provenance"]["status"] == "available"
    assert raw["market_cap"] == 1000
    assert raw["shares_source"] == "issuer:shares"
    assert raw["shares_as_of"] == "2020-01-02"
    await test_db.execute(Company.__table__.delete().where(Company.symbol == symbol))
    await test_db.commit()


@pytest.mark.asyncio
async def test_profile_metadata_only_cannot_label_old_alias_and_replacement_clears_aliases(test_db):
    symbol = f"A{uuid4().hex[:7]}".upper()
    test_db.add(Company(symbol=symbol, outstanding_shares=100, raw_data={"sharesOutstanding": 100}))
    await test_db.commit()
    manager = CacheManager(test_db)
    metadata = {"shares_unit": "shares", "shares_as_of": "2020-01-02",
                "shares_source": "issuer:shares", "share_basis": "outstanding"}
    assert await manager.store_profile_data(symbol, metadata)
    raw = (await test_db.execute(select(Company.raw_data).where(Company.symbol == symbol))).scalar_one()
    assert raw["sharesOutstanding"] == 100
    assert all(key not in raw for key in metadata)
    assert await manager.store_profile_data(symbol, {"shares_outstanding": 200, **metadata})
    raw = (await test_db.execute(select(Company.raw_data).where(Company.symbol == symbol))).scalar_one()
    assert raw["outstanding_shares"] == 200
    assert "sharesOutstanding" not in raw and "shares_outstanding" not in raw
    assert all(raw[key] == value for key, value in metadata.items())
    await test_db.execute(Company.__table__.delete().where(Company.symbol == symbol))
    await test_db.commit()


@pytest.mark.asyncio
async def test_profile_share_conflict_replaces_column_and_retains_evidence(test_db):
    symbol = f"H{uuid4().hex[:7]}".upper()
    manager = CacheManager(test_db)
    old = {"outstanding_shares": 100, "shares_unit": "shares", "shares_as_of": "2020-01-02",
           "shares_source": "issuer:old", "share_basis": "outstanding"}
    assert await manager.store_profile_data(symbol, old)
    conflict = {"status": "conflict", "value": None, "observations": [
        {"alias": "outstanding_shares", "raw_value": 7, "value": 7, "unit": "shares",
         "as_of": "2020-01-02", "source": "issuer:new", "share_basis": "outstanding"},
        {"alias": "shares_outstanding", "raw_value": 8, "value": 8, "unit": "shares",
         "as_of": "2020-01-02", "source": "issuer:new", "share_basis": "outstanding"},
    ]}
    assert await manager.store_profile_data(symbol, {"shares_outstanding_provenance": conflict})
    test_db.expire_all()
    company = (await test_db.execute(select(Company).where(Company.symbol == symbol))).scalar_one()
    assert company.outstanding_shares is None
    assert "outstanding_shares" not in company.raw_data
    evidence = company.raw_data["shares_outstanding_provenance"]
    assert evidence["status"] == "conflict"
    assert {item["value"] for item in evidence["observations"]} == {100, 7, 8}
    assert evidence["previous_record"]["shares_source"] == "issuer:old"
    assert await manager.store_profile_data(symbol, {"company_name": "Sparse"})
    raw = (await test_db.execute(select(Company.raw_data).where(Company.symbol == symbol))).scalar_one()
    assert raw["shares_outstanding_provenance"] == evidence
    await test_db.execute(Company.__table__.delete().where(Company.symbol == symbol))
    await test_db.commit()
