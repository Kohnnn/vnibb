from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select

from vnibb.models.data_quality import DataQualityBreachState, DataQualityRun
from vnibb.services.data_quality import (
    _vietcap_freshness_warning,
    complete_quality_run,
    ensure_quality_run,
    get_last_successful_quality_run,
    get_quality_run_trend,
    latest_market_business_day,
    market_day_staleness,
    update_sustained_breach_state,
)


def test_weekend_does_not_add_market_day_staleness():
    assert latest_market_business_day(date(2026, 7, 12)) == date(2026, 7, 10)
    assert market_day_staleness(date(2026, 7, 10), date(2026, 7, 10)) == 0
    assert _vietcap_freshness_warning(date(2026, 7, 10), 0, today=date(2026, 7, 12)) is None


def test_configured_holiday_does_not_add_market_day_staleness():
    holiday = date(2026, 9, 2)
    assert latest_market_business_day(holiday, {holiday}) == date(2026, 9, 1)
    assert market_day_staleness(date(2026, 9, 1), date(2026, 9, 3), {holiday}) == 1
    assert _vietcap_freshness_warning(date(2026, 9, 1), 0, today=holiday, holidays={holiday}) is None


@pytest.mark.asyncio
async def test_quality_run_is_idempotent(test_db):
    started_at = datetime(2026, 7, 16, 9, 40)
    first = await ensure_quality_run(test_db, run_id="scheduled:2026-07-16", started_at=started_at)
    second = await ensure_quality_run(test_db, run_id="scheduled:2026-07-16", started_at=started_at)

    assert first.id == second.id
    assert len((await test_db.execute(select(DataQualityRun))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_last_successful_run_uses_latest_completed_success(test_db):
    started_at = datetime(2026, 7, 16, 9, 40)
    await complete_quality_run(
        test_db,
        run_id="older",
        status="ok",
        completed_at=started_at,
        observed_market_date=date(2026, 7, 15),
        latest_market_date=date(2026, 7, 15),
        market_day_staleness_value=0,
        summary_counts={"warning_count": 0},
        error_category=None,
    )
    await complete_quality_run(
        test_db,
        run_id="newer",
        status="warning",
        completed_at=started_at + timedelta(days=1),
        observed_market_date=date(2026, 7, 16),
        latest_market_date=date(2026, 7, 15),
        market_day_staleness_value=1,
        summary_counts={"warning_count": 1},
        error_category="freshness_breach",
    )

    result = await get_last_successful_quality_run(test_db)

    assert result is not None
    assert result.run_id == "older"


@pytest.mark.asyncio
async def test_trend_window_returns_thirty_latest_market_days(test_db):
    completed_at = datetime(2026, 1, 1)
    observed_dates = []
    cursor = date(2026, 1, 1)
    while len(observed_dates) < 31:
        if cursor.weekday() < 5:
            observed_dates.append(cursor)
        cursor += timedelta(days=1)
    for index, observed_date in enumerate(observed_dates):
        await complete_quality_run(
            test_db,
            run_id=f"trend:{index}",
            status="ok",
            completed_at=completed_at + timedelta(days=index),
            observed_market_date=observed_date,
            latest_market_date=observed_date,
            market_day_staleness_value=0,
            summary_counts={"warning_count": 0},
            error_category=None,
        )

    trend = await get_quality_run_trend(test_db)

    assert len(trend) == 30
    assert trend[0].observed_market_date == observed_dates[-1]
    assert trend[-1].observed_market_date == observed_dates[1]


@pytest.mark.asyncio
async def test_sustained_breach_is_deduplicated(test_db):
    observed_at = datetime(2026, 7, 14, 9, 40)
    first = await update_sustained_breach_state(
        test_db,
        source="vietcap",
        dataset="eod",
        category="market_day_staleness",
        breached=True,
        observed_at=observed_at,
        observed_market_date=observed_at.date(),
        market_day=True,
    )
    second = await update_sustained_breach_state(
        test_db,
        source="vietcap",
        dataset="eod",
        category="market_day_staleness",
        breached=True,
        observed_at=observed_at + timedelta(days=1),
        observed_market_date=(observed_at + timedelta(days=1)).date(),
        market_day=True,
    )
    third = await update_sustained_breach_state(
        test_db,
        source="vietcap",
        dataset="eod",
        category="market_day_staleness",
        breached=True,
        observed_at=observed_at + timedelta(days=2),
        observed_market_date=(observed_at + timedelta(days=2)).date(),
        market_day=True,
    )

    assert not first
    assert second
    assert not third


@pytest.mark.asyncio
async def test_non_market_day_does_not_advance_sustained_breach(test_db):
    observed_at = datetime(2026, 7, 10, 9, 40)
    first = await update_sustained_breach_state(
        test_db,
        source="vietcap",
        dataset="eod",
        category="market_day_staleness",
        breached=True,
        observed_at=observed_at,
        observed_market_date=observed_at.date(),
        market_day=True,
    )
    weekend_retry = await update_sustained_breach_state(
        test_db,
        source="vietcap",
        dataset="eod",
        category="market_day_staleness",
        breached=True,
        observed_at=observed_at + timedelta(days=1),
        observed_market_date=observed_at.date(),
        market_day=False,
    )
    holiday_retry = await update_sustained_breach_state(
        test_db,
        source="vietcap",
        dataset="eod",
        category="market_day_staleness",
        breached=True,
        observed_at=observed_at + timedelta(days=3),
        observed_market_date=observed_at.date(),
        market_day=False,
        holidays={date(2026, 7, 13)},
    )
    state = (await test_db.execute(select(DataQualityBreachState))).scalar_one()

    assert not first
    assert not weekend_retry
    assert not holiday_retry
    assert state.consecutive_runs == 1


@pytest.mark.asyncio
async def test_same_observed_market_date_does_not_advance_sustained_breach(test_db):
    observed_at = datetime(2026, 7, 16, 9, 40)
    first = await update_sustained_breach_state(
        test_db,
        source="vietcap",
        dataset="eod",
        category="market_day_staleness",
        breached=True,
        observed_at=observed_at,
        observed_market_date=observed_at.date(),
        market_day=True,
    )
    retry = await update_sustained_breach_state(
        test_db,
        source="vietcap",
        dataset="eod",
        category="market_day_staleness",
        breached=True,
        observed_at=observed_at + timedelta(hours=1),
        observed_market_date=observed_at.date(),
        market_day=True,
    )
    state = (await test_db.execute(select(DataQualityBreachState))).scalar_one()

    assert not first
    assert not retry
    assert state.consecutive_runs == 1
