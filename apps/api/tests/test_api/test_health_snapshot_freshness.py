"""`/api/v1/health/detailed` must expose snapshot age, not just row counts.

A corpus that is rewritten faithfully every morning with the same stale
provider response reports a healthy row count forever. The scheduled
data-quality job detects the resulting staleness and records a
``freshness_breach``, but that verdict only ever reached ``data_quality_runs``
— invisible to anyone watching the health endpoint. These tests pin the
operator-visible signal.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.screener import ScreenerSnapshot


@pytest.fixture(autouse=True)
def completed_session_clock(monkeypatch):
    from vnibb.api.v1 import health
    from vnibb.services import cache_manager

    class FrozenDateTime(datetime):
        @classmethod
        def utcnow(cls):
            return cls(2026, 10, 21, 9)

        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 21, 16, tzinfo=tz)

    monkeypatch.setitem(globals(), "datetime", FrozenDateTime)
    monkeypatch.setattr(health, "datetime", FrozenDateTime)
    monkeypatch.setattr(cache_manager, "datetime", FrozenDateTime)


async def _seed_snapshot(db: AsyncSession, snapshot_date) -> None:
    db.add(
        ScreenerSnapshot(
            symbol="VNM",
            snapshot_date=snapshot_date,
            company_name="Vietnam Dairy Products",
            price=60.3,
        )
    )
    await db.commit()


async def _database_component(client: AsyncClient) -> dict:
    response = await client.get("/api/v1/health/detailed")
    assert response.status_code == 200
    return response.json()["components"]["database"]


@pytest.mark.asyncio
async def test_detailed_health_rejects_uncertified_stale_partition(
    client: AsyncClient, test_db: AsyncSession
):
    """An old row without a Universe receipt cannot certify coverage."""
    stale_day = datetime.utcnow().date() - timedelta(days=24)
    await _seed_snapshot(test_db, stale_day)

    database = await _database_component(client)

    assert database["screener_snapshot_date"] is None
    assert database["screener_snapshot_age_days"] is None
    assert database["screener_trade_date"] is None
    assert database["screener_verified_universe"] is False
    assert database["screener_freshness_reason"] == "verified_universe_unavailable"
    assert database["freshness_breach"] is True


@pytest.mark.asyncio
async def test_detailed_health_rejects_uncertified_current_partition(
    client: AsyncClient, test_db: AsyncSession
):
    """A current row without a completed Universe receipt is not coverage."""
    await _seed_snapshot(test_db, datetime.utcnow().date())

    database = await _database_component(client)

    assert database["screener_verified_universe"] is False
    assert database["freshness_breach"] is True


@pytest.mark.asyncio
async def test_current_partial_partition_cannot_hide_stale_verified_universe(
    client: AsyncClient, test_db: AsyncSession
):
    from vnibb.models.stock import Stock
    from vnibb.models.sync_status import SyncStatus

    today = datetime.utcnow().date()
    certified_day = today - timedelta(days=4)
    oldest_trade_day = today - timedelta(days=6)
    test_db.add_all([
        Stock(symbol="VNM", is_active=1),
        Stock(symbol="FPT", is_active=1),
        ScreenerSnapshot(symbol="VNM", snapshot_date=certified_day, trade_date=certified_day),
        ScreenerSnapshot(symbol="FPT", snapshot_date=certified_day, trade_date=oldest_trade_day),
        ScreenerSnapshot(symbol="VNM", snapshot_date=today, trade_date=today),
        SyncStatus(
            sync_type="screener_universe", status="completed", error_count=0,
            success_count=2, completed_at=datetime.utcnow(),
            additional_data={"snapshot_date": certified_day.isoformat(),
                             "expected_symbols": ["VNM", "FPT"], "expected_count": 2},
        ),
    ])
    await test_db.commit()

    database = await _database_component(client)

    assert database["screener_snapshot_date"] == certified_day.isoformat()
    assert database["screener_trade_date"] == oldest_trade_day.isoformat()
    assert database["screener_snapshot_age_days"] == 6
    assert database["screener_verified_universe"] is True
    assert database["screener_verified_count"] == 2
    assert database["freshness_breach"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("ict_hour,expected_session", [(14, "2026-10-20"), (16, "2026-10-21")])
async def test_verified_universe_matches_completed_ict_session(
    client: AsyncClient, test_db: AsyncSession, monkeypatch, ict_hour, expected_session
):
    from vnibb.api.v1 import health
    from vnibb.models.stock import Stock
    from vnibb.models.sync_status import SyncStatus

    today = datetime.utcnow().date()
    session_day = date.fromisoformat(expected_session)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 21, ict_hour, tzinfo=tz)

    monkeypatch.setattr(health, "datetime", FrozenDateTime)
    test_db.add_all([
        Stock(symbol="VNM", is_active=1),
        ScreenerSnapshot(symbol="VNM", snapshot_date=today, trade_date=session_day),
        SyncStatus(
            sync_type="screener_universe", status="completed", error_count=0,
            success_count=1, completed_at=datetime.utcnow(),
            additional_data={"snapshot_date": today.isoformat(),
                             "expected_symbols": ["VNM"], "expected_count": 1},
        ),
    ])
    await test_db.commit()

    database = await _database_component(client)

    assert database["screener_expected_session"] == expected_session
    assert database["screener_trade_date"] == expected_session
    assert database["screener_verified_count"] == 1
    assert "freshness_breach" not in database
