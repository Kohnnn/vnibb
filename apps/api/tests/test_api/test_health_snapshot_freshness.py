"""`/api/v1/health/detailed` must expose snapshot age, not just row counts.

A corpus that is rewritten faithfully every morning with the same stale
provider response reports a healthy row count forever. The scheduled
data-quality job detects the resulting staleness and records a
``freshness_breach``, but that verdict only ever reached ``data_quality_runs``
— invisible to anyone watching the health endpoint. These tests pin the
operator-visible signal.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.screener import ScreenerSnapshot


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
async def test_detailed_health_reports_snapshot_age_and_breach(
    client: AsyncClient, test_db: AsyncSession
):
    """Backdated snapshot: age is reported and the breach is visible."""
    stale_day = datetime.utcnow().date() - timedelta(days=24)
    await _seed_snapshot(test_db, stale_day)

    database = await _database_component(client)

    assert database["screener_snapshot_date"] == stale_day.isoformat()
    assert database["screener_snapshot_age_days"] == 24
    assert database["freshness_breach"] is True


@pytest.mark.asyncio
async def test_detailed_health_does_not_flag_a_current_snapshot(
    client: AsyncClient, test_db: AsyncSession
):
    """Current snapshot: no breach, so the flag stays meaningful."""
    await _seed_snapshot(test_db, datetime.utcnow().date())

    database = await _database_component(client)

    assert database["screener_snapshot_age_days"] == 0
    assert "freshness_breach" not in database
