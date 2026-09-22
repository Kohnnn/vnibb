"""`ScreenerService.sync_screener_data` must not write blind rows.

The scheduled sync maps provider fields onto a Screener Snapshot row. Two
things went wrong there:

1. Optional fields were guarded with ``hasattr``, which is true whenever the
   field is *declared*. A provider model that declares ``price`` but leaves it
   unset still passed the guard and wrote a NULL, which is indistinguishable
   downstream from a symbol that genuinely has no quote.
2. Its upsert overwrote every column on conflict, so a sync carrying a sparse
   payload could blank a column another writer had already populated. That is
   the same ownership rule the request path follows.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.screener import ScreenerSnapshot
from vnibb.services import screener_service as screener_service_module
from vnibb.services.screener_service import ScreenerService

TODAY = datetime.utcnow().date()


class _Fetcher:
    """Stands in for VnstockScreenerFetcher, returning one canned item per exchange."""

    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, params):  # noqa: ARG002 - signature parity
        return list(self._rows)


async def _run_sync(test_db, monkeypatch, rows):
    """Drive sync_screener_data against the test session."""
    fetcher = _Fetcher(rows)
    monkeypatch.setattr(screener_service_module, "VnstockScreenerFetcher", fetcher)

    class _SessionCtx:
        async def __aenter__(self):
            return test_db

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(
        screener_service_module, "async_session_maker", lambda *a, **k: _SessionCtx()
    )
    return await ScreenerService().sync_screener_data(exchanges=["HOSE"], limit=10)


def _item(**overrides):
    base = {
        "symbol": "VNM",
        "organ_name": "Vietnam Dairy Products",
        "exchange": "HOSE",
        "industry_name": "Thực phẩm",
        "market_cap": 1.26e14,
        "pe": 14.2,
        "pb": 2.9,
        "roe": 0.31,
        "price": 60.3,
        "volume": 2522300,
        "trade_date": TODAY,
        "roa": 0.12,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_declared_but_unset_price_is_not_written_as_null(test_db: AsyncSession, monkeypatch):
    """A declared-but-unset price must be omitted, not written as NULL."""
    await _run_sync(test_db, monkeypatch, [_item(symbol="VNM", price=None)])

    row = (
        await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))
    ).scalar_one()

    # The column was simply not part of the payload, so it kept its default
    # rather than being explicitly nulled.
    assert row.price is None
    assert row.trade_date is None
    # The rest of the row still landed, proving the sync ran.
    assert row.market_cap == 1.26e14
    assert row.exchange == "HOSE"


@pytest.mark.asyncio
async def test_repeated_sync_does_not_blank_a_populated_column(test_db: AsyncSession, monkeypatch):
    """A sparse second sync must not erase what the first one wrote."""
    test_db.add(
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=TODAY,
            source="KBS",
            price=60.3,
            pe=14.2,
            market_cap=1.26e14,
            trade_date=TODAY - timedelta(days=1),
        )
    )
    await test_db.commit()

    # Second sync arrives with price/pe missing entirely.
    await _run_sync(test_db, monkeypatch, [_item(symbol="VNM", price=None, pe=None)])

    row = (
        await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "VNM"))
    ).scalar_one()

    assert row.price == 60.3
    assert row.pe == 14.2
    assert row.trade_date == TODAY - timedelta(days=1)
    # Provenance stays with the first writer.
    assert row.source == "KBS"


@pytest.mark.asyncio
async def test_sync_stamps_utc_snapshot_date(test_db: AsyncSession, monkeypatch):
    """The sync keys rows to the same clock the rest of the pipeline uses."""
    await _run_sync(test_db, monkeypatch, [_item(symbol="FPT")])

    row = (
        await test_db.execute(select(ScreenerSnapshot).where(ScreenerSnapshot.symbol == "FPT"))
    ).scalar_one()

    assert row.snapshot_date == TODAY
    assert row.trade_date == TODAY
