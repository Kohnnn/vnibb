"""Screener Snapshot write-ownership and freshness invariants (issue #8).

The Screener Snapshot table is shared state: the screener endpoint, the
heatmap, market breadth, and comparison surfaces all read it. Two classes of
writer land on it under the same ``(symbol, snapshot_date)`` key -- the
scheduled full-universe sync, and the request path when a cache lookup misses.

These tests pin the properties that keep the request path from degrading the
shared table, and the freshness label that readers use to decide whether to
trust a number.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select

from vnibb.models.screener import ScreenerSnapshot
from vnibb.services.cache_manager import CacheManager

# The writer keys snapshots to the UTC day (`datetime.utcnow().date()`); the
# fixture must use the same clock or it seeds a different row than the one
# under test. On an Asia/Ho_Chi_Minh host these disagree for seven hours a day.
TODAY = datetime.utcnow().date()


def _row(symbol: str, **fields: Any) -> ScreenerSnapshot:
    """Seed a row the way the scheduled sync does: under the writer's day."""
    return ScreenerSnapshot(
        symbol=symbol,
        snapshot_date=fields.pop("snapshot_date", TODAY),
        created_at=fields.pop("created_at", datetime.utcnow()),
        **fields,
    )


async def _stored(db, symbol: str, snapshot_date: date = TODAY) -> ScreenerSnapshot:
    result = await db.execute(
        select(ScreenerSnapshot).where(
            ScreenerSnapshot.symbol == symbol,
            ScreenerSnapshot.snapshot_date == snapshot_date,
        )
    )
    return result.scalar_one()


@pytest.mark.asyncio
async def test_partial_live_write_cannot_blank_a_field_the_sync_populated(test_db):
    """A narrower writer must not regress a populated column to NULL.

    The live path persists its pre-filter fetch, and only some enrichers run
    on it, so incoming values are frequently NULL for fields the scheduled
    sync already filled. Letting NULL win blanks price/pe/market_cap for every
    other reader of the snapshot.
    """
    test_db.add(_row("VNM", source="KBS", price=60.3, pe=14.2, market_cap=1.26e14))
    await test_db.commit()

    manager = CacheManager(db=test_db)
    await manager.store_screener_data(
        data=[{"symbol": "VNM", "price": None, "pe": None, "market_cap": None, "roe": 0.31}],
        source="KBS",
    )

    stored = await _stored(test_db, "VNM")
    assert stored.price == 60.3
    assert stored.pe == 14.2
    assert stored.market_cap == 1.26e14
    # A non-null incoming value still lands.
    assert stored.roe == 0.31


@pytest.mark.asyncio
async def test_later_writer_cannot_relabel_provenance(test_db):
    """``source`` is insert-only so the audit trail survives a second writer.

    Overwriting the label made a request-path write indistinguishable from the
    scheduled full-universe sync, which is exactly the distinction issue #8
    needs in order to be diagnosable.
    """
    test_db.add(_row("FPT", source="scheduled_sync", price=120.0))
    await test_db.commit()

    manager = CacheManager(db=test_db)
    await manager.store_screener_data(
        data=[{"symbol": "FPT", "price": 121.0, "industry_name": "Công nghệ"}],
        source="live_request",
    )

    stored = await _stored(test_db, "FPT")
    assert stored.source == "scheduled_sync"
    # The write still warmed the row rather than being discarded wholesale.
    assert stored.price == 121.0


@pytest.mark.asyncio
async def test_write_into_an_unowned_row_records_the_writer(test_db):
    """Before the daily sync runs, the first writer legitimately owns the row."""
    manager = CacheManager(db=test_db)
    await manager.store_screener_data(
        data=[{"symbol": "HPG", "price": 27.5}],
        source="live_request",
    )

    stored = await _stored(test_db, "HPG")
    assert stored.source == "live_request"
    assert stored.price == 27.5


@pytest.mark.asyncio
async def test_write_never_creates_a_second_row_for_the_same_key(test_db):
    """Repeated writes collapse onto one row per (symbol, snapshot_date)."""
    manager = CacheManager(db=test_db)
    for price in (27.5, 27.9, 28.1):
        await manager.store_screener_data(
            data=[{"symbol": "HPG", "price": price}], source="live_request"
        )

    result = await test_db.execute(
        select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "HPG")
    )
    rows = result.scalars().all()
    assert len(rows) == 1
    assert rows[0].price == 28.1


@pytest.mark.asyncio
async def test_written_row_date_matches_its_write_date(test_db):
    """The writer must not stamp a snapshot under a different calendar day.

    A row whose ``snapshot_date`` disagrees with the day it was written splits
    the shared table: readers filtering on today's date see one row while the
    scheduled sync upserts into another, and neither converges. This is the
    invariant that keeps the two writers on the same key.
    """
    manager = CacheManager(db=test_db)
    await manager.store_screener_data(data=[{"symbol": "SSI", "price": 36.1}], source="live_request")

    result = await test_db.execute(
        select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "SSI")
    )
    stored = result.scalar_one()
    assert stored.snapshot_date == stored.created_at.date() == TODAY


@pytest.mark.asyncio
async def test_freshness_tracks_trade_date_not_write_time(test_db):
    """A freshly rewritten stale snapshot must still be reported as stale.

    Every scheduled pass rewrites ``created_at``, so measuring write time
    reported a snapshot whose prices stopped advancing weeks ago as "just
    refreshed". Callers rely on ``stale`` to decide whether to trust a number.
    """
    test_db.add(
        _row(
            "VNM",
            snapshot_date=date.today() - timedelta(days=4),
            source="rs_rating_service",
            created_at=datetime.utcnow(),
        )
    )
    await test_db.commit()

    manager = CacheManager(db=test_db)
    result = await manager.get_screener_data(allow_stale=True)

    assert result.hit is True
    assert result.is_stale is True


@pytest.mark.asyncio
async def test_current_trade_date_is_not_reported_stale_on_a_fresh_rewrite(test_db):
    """The mirror case: today's snapshot is fresh regardless of write time."""
    test_db.add(
        _row("VNM", snapshot_date=TODAY, source="rs_rating_service", created_at=datetime.utcnow())
    )
    await test_db.commit()

    manager = CacheManager(db=test_db)
    result = await manager.get_screener_data(allow_stale=True)

    assert result.hit is True
    assert result.is_stale is False
