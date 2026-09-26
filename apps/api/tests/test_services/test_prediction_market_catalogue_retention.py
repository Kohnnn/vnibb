"""Catalogue retention deletes only rows no read path can ever return.

``prediction_markets`` grows without bound because the ingest upserts on
``(source, source_id)`` and never removes delisted contracts. Reads only serve
rows refreshed within ``MARKET_FRESHNESS`` inside ``SNAPSHOT_SOURCE_LIMIT`` per
source, so anything older than ``MARKET_RETENTION`` is unreadable by
construction. These tests pin that boundary and the rows retention must never
touch.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_archive import PredictionMarketArchive
from vnibb.services import prediction_market_catalogue_retention as svc
from vnibb.services.prediction_market_policy import MARKET_RETENTION

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=UTC)


def _market(idx: int, *, age_days: float, **overrides) -> PredictionMarket:
    row = {
        "source": "kalshi",
        "source_id": f"KX-{idx}",
        "question": f"Will event {idx} happen?",
        "outcomes": ["Yes", "No"],
        "outcome_prices": [0.4, 0.6],
        "extra": {},
        "active": True,
        "closed": False,
        "is_synthetic": False,
        # ``updated_at`` is naive in the model; the cutoff is naive UTC.
        "updated_at": (NOW - timedelta(days=age_days)).replace(tzinfo=None),
    }
    row.update(overrides)
    return PredictionMarket(**row)


async def _remaining_ids(session) -> set[int]:
    rows = (await session.execute(select(PredictionMarket.id))).scalars().all()
    return set(rows)


async def _count(session) -> int:
    return (await session.execute(select(func.count(PredictionMarket.id)))).scalar()


@pytest.mark.asyncio
async def test_dry_run_reports_candidates_without_deleting(test_db) -> None:
    test_db.add_all([_market(i, age_days=30) for i in range(5)])
    await test_db.commit()

    receipt = await svc.purge_catalogue_debris(test_db, now=NOW, apply=False)

    assert receipt["candidates"] == 5
    assert receipt["deleted"] == 0
    assert await _count(test_db) == 5


@pytest.mark.asyncio
async def test_deletes_only_rows_older_than_the_retention_horizon(test_db) -> None:
    """The row exactly on the cutoff is inside the window and must survive."""
    test_db.add_all(
        [
            _market(1, age_days=MARKET_RETENTION.days + 0.5),
            _market(2, age_days=float(MARKET_RETENTION.days) - 0.5),
            _market(3, age_days=0),
        ]
    )

    receipt = await svc.purge_catalogue_debris(test_db, now=NOW, apply=True)

    assert receipt["deleted"] == 1, "only the out-of-window row may be deleted"
    assert await _count(test_db) == 2


@pytest.mark.asyncio
async def test_keeps_rows_that_are_not_debris(test_db) -> None:
    """Synthetic provenance and archive referents are never swept."""
    stale = float(MARKET_RETENTION.days) + 10
    archived = _market(1, age_days=stale)
    test_db.add_all(
        [
            archived,
            _market(2, age_days=stale, is_synthetic=True),
            _market(3, age_days=stale),
            keeper := _market(4, age_days=0),
        ]
    )
    await test_db.commit()

    test_db.add(
        PredictionMarketArchive(
            market_id=archived.id,
            batch_id="batch-1",
            payload={},
            sha256="0" * 64,
            archived_at=NOW.replace(tzinfo=None),
            backup_sha256="1" * 64,
        )
    )
    await test_db.commit()

    receipt = await svc.purge_catalogue_debris(test_db, now=NOW, apply=True)

    assert receipt["deleted"] == 1, "only the plain stale row may be deleted"
    survivors = await _remaining_ids(test_db)
    assert archived.id in survivors, "the archive referent must survive"
    assert keeper.id in survivors, "the fresh row must survive"
    assert await _count(test_db) == 3


@pytest.mark.asyncio
async def test_deletion_is_bounded_by_the_batch_limit(test_db) -> None:
    """No unbounded transaction: the sweep is resumable across runs."""
    test_db.add_all([_market(i, age_days=30) for i in range(12)])
    await test_db.commit()

    first = await svc.purge_catalogue_debris(test_db, limit=5, now=NOW, apply=True)
    assert first["deleted"] == 5
    assert await _count(test_db) == 7

    second = await svc.purge_catalogue_debris(test_db, limit=5, now=NOW, apply=True)
    assert second["deleted"] == 5
    assert await _count(test_db) == 2


@pytest.mark.asyncio
async def test_existence_probe_matches_what_the_sweep_removes(test_db) -> None:
    """The probe must agree with the sweep without ever counting the table."""
    test_db.add_all([_market(i, age_days=30) for i in range(6)])
    test_db.add_all([_market(i, age_days=0) for i in range(100, 104)])
    await test_db.commit()

    assert await svc.has_catalogue_debris(test_db, now=NOW) is True

    statements: list[str] = []
    original_execute = test_db.execute

    async def _recording_execute(statement, *args, **kwargs):
        statements.append(str(statement).lstrip().upper())
        return await original_execute(statement, *args, **kwargs)

    test_db.execute = _recording_execute
    try:
        receipt = await svc.purge_catalogue_debris(
            test_db, limit=100, now=NOW, apply=True
        )
    finally:
        test_db.execute = original_execute

    assert receipt["deleted"] == 6
    assert await _count(test_db) == 4
    # A full count of the complement is the trap this module exists to avoid:
    # the debris is most of the table, so a count costs a sequential scan.
    assert not any("COUNT(" in sql for sql in statements), (
        "retention must never count the whole table"
    )


@pytest.mark.asyncio
async def test_existence_probe_is_false_when_nothing_is_stale(test_db) -> None:
    test_db.add_all([_market(i, age_days=0) for i in range(3)])
    await test_db.commit()

    assert await svc.has_catalogue_debris(test_db, now=NOW) is False
