"""Persistence regressions for atomic cache writer upserts."""

from datetime import date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
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
    assert company.outstanding_shares == 7_000_000
    assert company.listed_shares == 7_000_000
    assert company.business_description == "Updated description"
    assert company.raw_data == {"company_name": "Updated Co", "description": "Updated description", "outstanding_shares": 7}
    assert company.created_at == created_at
    await test_db.execute(Company.__table__.delete().where(Company.symbol == symbol))
    await test_db.commit()
