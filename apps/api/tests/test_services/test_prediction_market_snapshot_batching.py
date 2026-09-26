"""Regression tests for bounded, genuine prediction-market measurements."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_intraday_snapshot import PredictionMarketIntradaySnapshot
from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot
from vnibb.services import prediction_market_intraday_snapshot_service as intraday
from vnibb.services import prediction_market_snapshot_service as daily


def _market(idx: int, *, source: str = "polymarket", **fields) -> PredictionMarket:
    values = {
        "source": source, "source_id": f"{source}-{idx}", "question": f"Question {idx}",
        "active": True, "closed": False, "is_synthetic": False,
        "outcome_prices": [0.4, 0.6], "outcomes": ["Yes", "No"],
        "updated_at": datetime.now(UTC).replace(tzinfo=None),
    }
    values.update(fields)
    return PredictionMarket(**values)


async def _snapshots(session, model):
    return (await session.scalars(select(model).order_by(model.source, model.source_id))).all()


@pytest.mark.asyncio
async def test_intraday_and_daily_limit_sources_and_exclude_nonlive_markets(test_db):
    now = datetime.now(UTC).replace(tzinfo=None)
    test_db.add_all([_market(i) for i in range(1005)])
    test_db.add_all([_market(i, source="kalshi") for i in range(4)])
    test_db.add_all([
        _market(2000, updated_at=now - timedelta(hours=25)),
        _market(2001, closed=True),
        _market(2002, is_synthetic=True),
        _market(2003, active=False),
        _market(2004, end_date=now - timedelta(minutes=1)),
        _market(9000, source="kalshi", source_id="KXMVE-LEGACY"),
    ])
    await test_db.commit()

    first = await intraday.snapshot_active_prediction_markets_intraday(test_db)
    nightly = await daily.snapshot_active_prediction_markets(test_db)
    assert (first.rows_written, nightly) == (1004, 1004)
    for model in (PredictionMarketIntradaySnapshot, PredictionMarketSnapshot):
        rows = await _snapshots(test_db, model)
        assert sum(row.source == "polymarket" for row in rows) == 1000
        assert sum(row.source == "kalshi" for row in rows) == 4
        assert {row.source_id for row in rows}.isdisjoint({
            "polymarket-2000", "polymarket-2001", "polymarket-2002",
            "polymarket-2003", "polymarket-2004", "KXMVE-LEGACY",
        })
        assert all(row.yes_price == 0.4 for row in rows)
        assert all(row.extra == {} for row in rows)


@pytest.mark.asyncio
async def test_same_bucket_repeated_calls_do_not_create_fabricated_history(test_db):
    test_db.add(_market(1))
    await test_db.commit()
    assert (await intraday.snapshot_active_prediction_markets_intraday(test_db)).rows_written == 1
    assert (await intraday.snapshot_active_prediction_markets_intraday(test_db)).rows_written == 0
    assert await daily.snapshot_active_prediction_markets(test_db) == 1
    assert await daily.snapshot_active_prediction_markets(test_db) == 0
    assert len(await _snapshots(test_db, PredictionMarketSnapshot)) == 1
    assert len(await _snapshots(test_db, PredictionMarketIntradaySnapshot)) == 1
    for model in (PredictionMarketSnapshot, PredictionMarketIntradaySnapshot):
        measurement = (await _snapshots(test_db, model))[0]
        captured_at = measurement.captured_at.replace(tzinfo=UTC)
        bucket_at = measurement.bucket_at.replace(tzinfo=UTC)
        assert abs((datetime.now(UTC) - captured_at).total_seconds()) < 60
        assert bucket_at <= captured_at
        assert captured_at - bucket_at < (
            timedelta(days=1) if model is PredictionMarketSnapshot else timedelta(minutes=15)
        )

@pytest.mark.asyncio
async def test_daily_history_reports_measurement_time_not_midnight_bucket(test_db):
    from vnibb.api.v1.prediction_markets import get_prediction_market_history

    observed = datetime.now(UTC).replace(hour=10, minute=30, second=0, microsecond=0)
    bucket = observed.replace(hour=0, minute=0)
    test_db.add(_market(4001, updated_at=observed.replace(tzinfo=None)))
    await test_db.commit()

    written, _ = await daily.write_snapshot_bucket(
        test_db, PredictionMarketSnapshot, observed, bucket
    )
    assert written == 1
    history = await get_prediction_market_history(
        source="polymarket", source_id="polymarket-4001", days=1, db=test_db
    )
    assert len(history.points) == 1
    assert history.points[0].captured_at.replace(tzinfo=UTC) == observed
    assert (await _snapshots(test_db, PredictionMarketSnapshot))[0].bucket_at.replace(tzinfo=UTC) == bucket

@pytest.mark.asyncio
async def test_new_fresh_market_cannot_overfill_previous_bucket(test_db):
    test_db.add_all([_market(i) for i in range(1001)])
    await test_db.commit()
    assert (await intraday.snapshot_active_prediction_markets_intraday(test_db)).rows_written == 1000
    assert await daily.snapshot_active_prediction_markets(test_db) == 1000

    test_db.add(_market(1002, updated_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=1)))
    await test_db.commit()
    assert (await intraday.snapshot_active_prediction_markets_intraday(test_db)).rows_written == 0
    assert await daily.snapshot_active_prediction_markets(test_db) == 0
    assert len(await _snapshots(test_db, PredictionMarketIntradaySnapshot)) == 1000
    assert len(await _snapshots(test_db, PredictionMarketSnapshot)) == 1000


@pytest.mark.asyncio
async def test_changing_universe_respects_total_and_source_bucket_caps(test_db, monkeypatch):
    monkeypatch.setattr(daily, "SNAPSHOT_INSERT_BATCH_SIZE", 2)
    monkeypatch.setattr(daily, "SNAPSHOT_MARKET_LIMIT", 3)
    monkeypatch.setattr(daily, "SNAPSHOT_SOURCE_LIMIT", 2)
    test_db.add_all([_market(i) for i in range(3)])
    test_db.add(_market(0, source="kalshi"))
    await test_db.commit()

    assert (await intraday.snapshot_active_prediction_markets_intraday(test_db)).rows_written == 3
    assert await daily.snapshot_active_prediction_markets(test_db) == 3
    test_db.add_all([_market(i + 3) for i in range(3)])
    test_db.add(_market(1, source="kalshi"))
    await test_db.commit()

    for model, write in (
        (PredictionMarketIntradaySnapshot, intraday.snapshot_active_prediction_markets_intraday),
        (PredictionMarketSnapshot, daily.snapshot_active_prediction_markets),
    ):
        await write(test_db)
        rows = await _snapshots(test_db, model)
        assert len(rows) == 3
        assert sum(row.source == "polymarket" for row in rows) == 2


@pytest.mark.asyncio
async def test_failed_later_batch_rolls_back_all_new_snapshot_rows(test_db, monkeypatch):
    test_db.add_all([_market(i) for i in range(3)])
    await test_db.commit()
    monkeypatch.setattr(daily, "SNAPSHOT_INSERT_BATCH_SIZE", 2)
    check_capacity = daily._check_capacity
    calls = 0

    async def fail_after_first_batch(session, planned_rows):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("snapshot capacity vanished")
        await check_capacity(session, planned_rows)

    monkeypatch.setattr(daily, "_check_capacity", fail_after_first_batch)
    with pytest.raises(RuntimeError, match="capacity vanished"):
        await daily.snapshot_active_prediction_markets(test_db)
    assert await _snapshots(test_db, PredictionMarketSnapshot) == []


@pytest.mark.asyncio
async def test_concurrent_same_bucket_calls_remain_unique(test_engine):
    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    async with maker() as seed:
        seed.add(_market(1))
        await seed.commit()

    async def capture():
        async with maker() as session:
            return (await intraday.snapshot_active_prediction_markets_intraday(session)).rows_written

    assert sorted(await asyncio.gather(capture(), capture())) == [0, 1]
    async with maker() as check:
        assert len(await _snapshots(check, PredictionMarketIntradaySnapshot)) == 1


@pytest.mark.asyncio
async def test_combined_snapshot_ceiling_reserves_next_row(test_db, monkeypatch):
    test_db.add(_market(1))
    await test_db.commit()
    monkeypatch.setattr(daily, "SNAPSHOT_STORAGE_CEILING_BYTES", 2 * daily.SNAPSHOT_RESERVED_ROW_BYTES + daily.SNAPSHOT_RESERVED_BATCH_BYTES)
    assert (await intraday.snapshot_active_prediction_markets_intraday(test_db)).rows_written == 1
    assert await daily.snapshot_active_prediction_markets(test_db) == 1
    test_db.add(_market(2))
    await test_db.commit()
    with pytest.raises(RuntimeError, match="storage ceiling"):
        await intraday.snapshot_active_prediction_markets_intraday(test_db)
    assert len(await _snapshots(test_db, PredictionMarketIntradaySnapshot)) == 1
    assert len(await _snapshots(test_db, PredictionMarketSnapshot)) == 1


@pytest.mark.asyncio
async def test_storage_ceiling_blocks_both_writers_before_inserting(test_db, monkeypatch):
    test_db.add(_market(1))
    await test_db.commit()
    monkeypatch.setattr(daily, "SNAPSHOT_STORAGE_CEILING_BYTES", 1)
    with pytest.raises(RuntimeError, match="storage ceiling"):
        await intraday.snapshot_active_prediction_markets_intraday(test_db)
    with pytest.raises(RuntimeError, match="storage ceiling"):
        await daily.snapshot_active_prediction_markets(test_db)
    for model in (PredictionMarketSnapshot, PredictionMarketIntradaySnapshot):
        assert (await test_db.scalar(select(func.count()).select_from(model))) == 0


@pytest.mark.asyncio
async def test_daily_pruning_runs_when_ingestion_fails(test_db, monkeypatch):
    now = datetime.now(UTC)
    test_db.add(PredictionMarketSnapshot(
        source="polymarket", source_id="old", question="Real old measurement",
        yes_price=0.4, captured_at=now - timedelta(days=31), extra={},
    ))
    test_db.add(PredictionMarketSnapshot(
        source="polymarket", source_id="new", question="Current measurement",
        yes_price=0.5, captured_at=now - timedelta(days=2), extra={},
    ))
    await test_db.commit()
    test_db.add(_market(1))
    await test_db.commit()
    monkeypatch.setattr(daily, "SNAPSHOT_STORAGE_CEILING_BYTES", 1)
    with pytest.raises(RuntimeError, match="storage ceiling"):
        await daily.snapshot_active_prediction_markets(test_db)
    assert await daily.prune_daily_snapshots(test_db, now=now) == 1
    assert [row.source_id for row in await _snapshots(test_db, PredictionMarketSnapshot)] == ["new"]
