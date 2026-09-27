"""Intraday retention runs independently of failed or stalled snapshot writes."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from vnibb.core import scheduler as scheduler_module
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_intraday_snapshot import (
    PredictionMarketIntradaySnapshot,
)
from vnibb.services import prediction_market_intraday_snapshot_service as svc

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=UTC)


def _snapshot(idx: int, *, age_days: float) -> PredictionMarketIntradaySnapshot:
    return PredictionMarketIntradaySnapshot(
        market_id=None,
        source="polymarket",
        source_id=f"mkt-{idx}",
        question=f"Will event {idx} happen?",
        yes_price=0.5,
        extra={},
        captured_at=NOW - timedelta(days=age_days),
    )



async def _count(session) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(PredictionMarketIntradaySnapshot)
        )
    ).scalar()


async def _captured_ats(session) -> list[datetime]:
    rows = (
        await session.execute(
            select(PredictionMarketIntradaySnapshot.captured_at).order_by(
                PredictionMarketIntradaySnapshot.captured_at
            )
        )
    ).scalars().all()
    return [
        value.replace(tzinfo=UTC) if value.tzinfo is None else value
        for value in rows
    ]


@pytest.mark.asyncio
async def test_prune_is_reachable_when_ingestion_fails(test_db, monkeypatch) -> None:
    test_db.add(_snapshot(1, age_days=8))
    test_db.add(_snapshot(2, age_days=1))
    test_db.add(PredictionMarket(
        source="polymarket", source_id="live-market", question="Real live market?",
        active=True, closed=False, is_synthetic=False,
        outcome_prices=[0.4, 0.6], outcomes=["Yes", "No"],
        updated_at=datetime.now(UTC).replace(tzinfo=None),
    ))
    await test_db.commit()
    monkeypatch.setattr(
        "vnibb.services.prediction_market_snapshot_service.SNAPSHOT_STORAGE_CEILING_BYTES", 1
    )
    with pytest.raises(RuntimeError, match="storage ceiling"):
        await svc.snapshot_active_prediction_markets_intraday(test_db)

    result = await svc.prune_intraday_snapshots(test_db, now=NOW)
    assert result.rows_deleted == 1
    assert len(await _captured_ats(test_db)) == 1

@pytest.mark.asyncio
async def test_prune_deletes_only_rows_older_than_a_fixed_cutoff(
    test_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Never touch data inside the window; the cutoff is fixed per run."""
    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE", 100)

    test_db.add_all(
        [
            _snapshot(1, age_days=svc.INTRADAY_SNAPSHOT_RETENTION_DAYS + 0.001),
            _snapshot(2, age_days=svc.INTRADAY_SNAPSHOT_RETENTION_DAYS),  # exactly on cutoff
            _snapshot(3, age_days=svc.INTRADAY_SNAPSHOT_RETENTION_DAYS - 0.001),
            _snapshot(4, age_days=0.0),
        ]
    )
    await test_db.commit()

    result = await svc.prune_intraday_snapshots(test_db, now=NOW)

    assert result.rows_deleted == 1
    remaining = await _captured_ats(test_db)
    expected = [
        NOW - timedelta(days=svc.INTRADAY_SNAPSHOT_RETENTION_DAYS - 0.001),
        NOW - timedelta(days=svc.INTRADAY_SNAPSHOT_RETENTION_DAYS),
        NOW,
    ]
    # Sub-second component is storage-dependent across engines.
    assert len(remaining) == 3, "only the out-of-window row may be deleted"
    for value in remaining:
        assert any(abs((value - want).total_seconds()) < 1 for want in expected), (
            f"{value} is not an in-window row; the row on the cutoff must survive"
        )


@pytest.mark.asyncio
async def test_prune_batches_are_bounded_and_resumable(
    test_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No unbounded delete: every transaction is bounded, and a stopped sweep resumes."""
    batch_size = 7
    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE", batch_size)
    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE", batch_size)

    expired = 20
    test_db.add_all([_snapshot(i, age_days=9) for i in range(expired)])
    test_db.add_all([_snapshot(i, age_days=2) for i in range(500, 503)])
    await test_db.commit()

    executed: list[str] = []
    original_execute = test_db.execute

    async def _counting_execute(statement, *args, **kwargs):
        sql = str(statement).lstrip().upper()
        if sql.startswith("DELETE"):
            executed.append(sql)
        return await original_execute(statement, *args, **kwargs)

    monkeypatch.setattr(test_db, "execute", _counting_execute)

    first = await svc.prune_intraday_snapshots(
        test_db, now=NOW, batch_size=batch_size, max_seconds=0.0
    )

    # max_seconds=0 stops after the first full batch: one bounded transaction.
    assert first.rows_deleted == batch_size, "the sweep must stop at the budget"
    # Exactly one DELETE: the sweep stopped at the budget instead of walking
    # the whole expired set in a single statement.
    assert len([sql for sql in executed if sql.startswith("DELETE")]) == 1
    assert first.batches_deleted == 1
    assert first.truncated is True
    assert await _count(test_db) == expired - batch_size + 3

    # The sweep is resumable: identical arguments finish the job, and the
    # bound is enforced by the sweep itself rather than by the caller.
    second = await svc.prune_intraday_snapshots(test_db, now=NOW, batch_size=10**6)
    assert second.rows_deleted == expired - batch_size
    assert second.truncated is False
    assert await _count(test_db) == 3

    third = await svc.prune_intraday_snapshots(test_db, now=NOW)
    assert third.rows_deleted == 0
    assert third.batches_deleted == 0
    assert third.truncated is False
    assert await _count(test_db) == 3


@pytest.mark.asyncio
async def test_prune_batch_size_is_never_above_the_hard_cap(
    test_db, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A misconfigured batch size cannot turn the sweep back into one big delete."""
    assert svc.INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE <= svc.INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE
    assert svc._prune_batch_size() == svc.INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE

    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE", 10**9)
    assert svc._prune_batch_size() == svc.INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE
    assert svc._prune_batch_size() <= 2000, "the hard cap is the contract"

    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE", 0)
    assert svc._prune_batch_size() == svc.INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE

    # An oversized caller argument is clamped too, so no code path can ask
    # for an unbounded delete.
    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE", 1000)
    test_db.add_all([_snapshot(i, age_days=30) for i in range(5)])
    await test_db.commit()
    result = await svc.prune_intraday_snapshots(
        test_db, now=NOW, batch_size=10**9, retention_days=7
    )
    assert result.rows_deleted == 5
    assert await _count(test_db) == 0


def test_scheduler_registers_prune_as_its_own_guarded_job(monkeypatch) -> None:
    """Pruning must be a job of its own, not a tail step of the ingest job.

    Independent registration is what makes retention reachable when the
    ingest times out; sharing the ingest job's timeout would reproduce the
    outage exactly.
    """
    monkeypatch.setattr(scheduler_module, "_scheduler", None)
    monkeypatch.setattr(scheduler_module, "DistributedJobLock", _NoopLock)
    try:
        scheduler_module.configure_scheduler()
        jobs = {job.id: job for job in scheduler_module.get_scheduler().get_jobs()}

        assert "prediction_market_intraday_prune" in jobs
        assert "prediction_market_intraday_snapshot" in jobs
        prune = jobs["prediction_market_intraday_prune"]
        ingest = jobs["prediction_market_intraday_snapshot"]
        assert prune.max_instances == 1
        assert prune.coalesce is True
        assert str(prune.trigger) == str(ingest.trigger), (
            "pruning must keep pace with ingestion"
        )
        assert scheduler_module.PREDICTION_MARKET_INTRADAY_PRUNE_TIMEOUT_SECONDS > 0
        assert (
            scheduler_module.PREDICTION_MARKET_INTRADAY_PRUNE_TIMEOUT_SECONDS
            >= svc.INTRADAY_SNAPSHOT_PRUNE_MAX_SECONDS
        ), "the job timeout must not cut the sweep off mid-batch"

        status = scheduler_module.get_predictions_status()
        assert "intraday_prune" in status, "the sweep's outcome must be observable"
    finally:
        # Never leave the process-global scheduler populated for later tests.
        scheduler_module._scheduler = None


class _NoopLock:
    """Stand-in for the Redis lease so registration can be inspected offline."""

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def acquire(self):
        return "acquired"

    async def renew(self):
        return True

    async def release(self):
        return True
