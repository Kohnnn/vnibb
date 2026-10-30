"""RS rating writes must not be the sole content of a snapshot day.

`rs_rating_service` runs on its own schedule and can reach a date before the
full screener sync has written that date. When it does, it creates the missing
rows itself. Those rows exist to hold an RS score; the valuation fields come
from whatever the previous snapshot carried.

A symbol whose prior snapshot has no price has nothing to carry forward, so
creating its row produces a snapshot day that looks complete by row count while
the visible fields are empty for most of the market. That is worse than an
absent row, because readers filter on the date and cannot tell the difference.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.market_cap import resolve_market_cap
from vnibb.models.screener import ScreenerSnapshot
from vnibb.services.cache_manager import CacheManager
from vnibb.services.rs_rating_service import RSRatingService

PRIOR_DAY = date(2026, 9, 18)
TARGET_DAY = PRIOR_DAY + timedelta(days=1)


async def _seed_prior(db: AsyncSession, symbol: str, **fields) -> None:
    db.add(ScreenerSnapshot(symbol=symbol, snapshot_date=PRIOR_DAY, source="KBS", **fields))
    await db.commit()


@pytest.mark.asyncio
async def test_symbol_without_a_carry_forward_price_gets_no_row(test_db: AsyncSession):
    """A prior snapshot with no price cannot seed a meaningful row."""
    await _seed_prior(test_db, "NOPRICE", price=None, volume=None, market_cap=None)

    service = RSRatingService()
    await service._update_screener_snapshots(
        test_db,
        [{"symbol": "NOPRICE", "rs_rating": 71.0, "rs_rank": 400}],
        TARGET_DAY,
    )

    rows = (
        await test_db.execute(
            select(ScreenerSnapshot).where(ScreenerSnapshot.snapshot_date == TARGET_DAY)
        )
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_symbol_with_no_prior_snapshot_gets_no_row(test_db: AsyncSession):
    """With no prior snapshot there is nothing to seed from at all."""
    service = RSRatingService()
    await service._update_screener_snapshots(
        test_db,
        [{"symbol": "BRANDNEW", "rs_rating": 88.0, "rs_rank": 12}],
        TARGET_DAY,
    )

    rows = (
        await test_db.execute(
            select(ScreenerSnapshot).where(ScreenerSnapshot.snapshot_date == TARGET_DAY)
        )
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_symbol_with_a_carry_forward_price_still_gets_a_row(test_db: AsyncSession):
    """The suppression must not block the seeding it was designed to allow."""
    await _seed_prior(test_db, "VNM", price=60.3, market_cap=1.26e14, pe=14.2)

    service = RSRatingService()
    await service._update_screener_snapshots(
        test_db,
        [{"symbol": "VNM", "rs_rating": 82.5, "rs_rank": 30}],
        TARGET_DAY,
    )

    row = (
        await test_db.execute(
            select(ScreenerSnapshot).where(
                ScreenerSnapshot.symbol == "VNM",
                ScreenerSnapshot.snapshot_date == TARGET_DAY,
            )
        )
    ).scalar_one()

    assert row.rs_rating == 82.5
    assert row.rs_rank == 30
    # Carried forward, not left empty.
    assert row.price == 60.3
    assert row.market_cap == 1.26e14
    assert row.pe == 14.2


@pytest.mark.asyncio
@pytest.mark.parametrize("prior_case", ["older", "same", "undated", "share_conflict"])
async def test_rs_seeded_cap_reconciles_later_screener_refresh(test_db: AsyncSession, prior_case):
    today = datetime.utcnow().date()
    yesterday = today - timedelta(days=1)
    old_date = today if prior_case == "same" else yesterday

    def cap(value, day):
        return resolve_market_cap({
            "market_cap": value, "market_cap_source": "issuer:cap",
            "market_cap_unit": "VND", "market_cap_currency": "VND",
            "market_cap_as_of": day.isoformat(), "outstanding_shares": 100,
            "shares_unit": "shares", "shares_source": "issuer:shares",
            "shares_as_of": day.isoformat(), "share_basis": "outstanding",
        }, source="issuer")

    old = cap(1000, old_date)
    if prior_case == "undated":
        old["observations"].append({"value": 900, "as_of": None, "source": "unknown"})
        old.update(status="unavailable", value=None)
    elif prior_case == "share_conflict":
        old["observations"].append({"value": None, "shares_conflict": True})
        old.update(status="conflict", value=None)
    test_db.add(ScreenerSnapshot(
        symbol="VNM", snapshot_date=yesterday, price=10, trade_date=yesterday,
        market_cap=old["value"], extended_metrics={"price_unit": "VND", "price_source": "quote",
                                                   "market_cap_provenance": old},
    ))
    await test_db.commit()
    await RSRatingService()._update_screener_snapshots(
        test_db, [{"symbol": "VNM", "rs_rating": 82.5, "rs_rank": 30}], today,
    )
    test_db.expire_all()
    query = select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM", ScreenerSnapshot.snapshot_date == today)
    seeded = (await test_db.execute(query)).scalar_one()
    assert seeded.extended_metrics["market_cap_provenance"]["carried_forward"] is True

    latest = cap(1200, today)
    assert await CacheManager(test_db).store_screener_data([{
        "symbol": "VNM", "market_cap": latest["value"], "market_cap_provenance": latest,
    }]) == 1
    test_db.expire_all()
    row = (await test_db.execute(query)).scalar_one()
    assert row.market_cap == (1200 if prior_case == "older" else None)
    assert row.extended_metrics["market_cap_provenance"]["status"] == (
        "available" if prior_case == "older" else "conflict"
    )
    assert row.rs_rating == 82.5


@pytest.mark.asyncio
async def test_existing_same_day_row_is_still_updated_in_place(test_db: AsyncSession):
    """A same-day row owned by the sync is enriched, never duplicated."""
    await _seed_prior(test_db, "FPT", price=120.0)
    test_db.add(
        ScreenerSnapshot(
            symbol="FPT",
            snapshot_date=TARGET_DAY,
            source="KBS",
            price=121.5,
            market_cap=1.7e14,
        )
    )
    await test_db.commit()

    service = RSRatingService()
    await service._update_screener_snapshots(
        test_db,
        [{"symbol": "FPT", "rs_rating": 90.0, "rs_rank": 5}],
        TARGET_DAY,
    )

    rows = (
        await test_db.execute(
            select(ScreenerSnapshot).where(
                ScreenerSnapshot.symbol == "FPT",
                ScreenerSnapshot.snapshot_date == TARGET_DAY,
            )
        )
    ).scalars().all()

    assert len(rows) == 1
    assert rows[0].rs_rating == 90.0
    assert rows[0].price == 121.5
    # Provenance stays with the writer that populated the row.
    assert rows[0].source == "KBS"
