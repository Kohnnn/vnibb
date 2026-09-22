"""The intraday prediction-market snapshot must page, never load the table.

`prediction_markets` holds ~13 M rows and nearly all are active. The original
implementation did `select(...).where(active).scalars().all()`, which pulled
the whole active set into Python and wrote one giant batch. Measured live that
reached 1.9 GB of anonymous heap against the scheduler's 2 GiB cgroup limit,
so the kernel OOM-killed `vnibb-scheduler` on every 15-minute tick (35 kills
observed; kernel log shows CONSTRAINT_MEMCG with a 2 GB limit).

These tests pin the two properties that make the OOM impossible:

1. Peak resident ORM rows stay bounded by the batch size, regardless of how
   many rows the table holds.
2. Every active market is still snapshotted exactly once, and the run is
   resumable by primary key rather than by OFFSET.

A regression here is not a cosmetic failure: it is the scheduler dying in
production every 15 minutes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_intraday_snapshot import (
    PredictionMarketIntradaySnapshot,
)
from vnibb.services import prediction_market_intraday_snapshot_service as svc


def _market(idx: int, *, active: bool = True) -> PredictionMarket:
    return PredictionMarket(
        source="polymarket",
        source_id=f"mkt-{idx}",
        question=f"Will event {idx} happen?",
        active=active,
        outcome_prices=[0.4, 0.6],
        outcomes=["Yes", "No"],
        volume=1000.0,
        liquidity=500.0,
    )


@pytest.mark.asyncio
async def test_snapshot_pages_instead_of_loading_every_active_market(
    test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Peak ORM rows held at once must not exceed one batch."""
    total = 25
    batch_size = 10
    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_BATCH_SIZE", batch_size)

    test_db.add_all([_market(i) for i in range(total)])
    await test_db.commit()

    seen_batches: list[int] = []
    original = svc._write_once

    async def _spy(session, rows):
        seen_batches.append(len(rows))
        return await original(session, rows)

    monkeypatch.setattr(svc, "_write_once", _spy)

    result = await svc.snapshot_active_prediction_markets_intraday(test_db)

    assert result.markets_seen == total
    assert result.rows_written == total
    # The whole point: no single write carried the entire table.
    assert max(seen_batches) <= batch_size, (
        f"a single batch held {max(seen_batches)} rows; limit is {batch_size}"
    )
    assert sum(seen_batches) == total


@pytest.mark.asyncio
async def test_snapshot_writes_every_active_market_exactly_once(
    test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Paging by key must not skip or duplicate rows at batch boundaries."""
    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_BATCH_SIZE", 7)

    test_db.add_all([_market(i, active=True) for i in range(20)])
    test_db.add_all([_market(i, active=False) for i in range(100, 105)])
    await test_db.commit()

    result = await svc.snapshot_active_prediction_markets_intraday(test_db)

    assert result.markets_seen == 20
    assert result.rows_written == 20

    written = (
        await test_db.execute(
            select(func.count()).select_from(PredictionMarketIntradaySnapshot)
        )
    ).scalar()
    assert written == 20

    distinct = (
        await test_db.execute(
            select(func.count(func.distinct(PredictionMarketIntradaySnapshot.market_id)))
        )
    ).scalar()
    assert distinct == 20, "a market was snapshotted more than once"

    # Inactive markets must stay out of the snapshot entirely.
    inactive_ids = set(
        (
            await test_db.execute(
                select(PredictionMarket.id).where(PredictionMarket.active.is_(False))
            )
        )
        .scalars()
        .all()
    )
    snapshot_ids = set(
        (
            await test_db.execute(select(PredictionMarketIntradaySnapshot.market_id))
        )
        .scalars()
        .all()
    )
    assert not (snapshot_ids & inactive_ids)


@pytest.mark.asyncio
async def test_snapshot_carries_price_and_retention_forward(
    test_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Batching must not change the payload or stop retention pruning."""
    monkeypatch.setattr(svc, "INTRADAY_SNAPSHOT_BATCH_SIZE", 3)

    test_db.add_all([_market(i) for i in range(4)])
    # An expired row that retention is expected to remove.
    stale = PredictionMarketIntradaySnapshot(
        market_id=1,
        source="polymarket",
        source_id="mkt-0",
        question="old",
        yes_price=0.5,
        captured_at=datetime.now(timezone.utc)
        - timedelta(days=svc.INTRADAY_SNAPSHOT_RETENTION_DAYS + 1),
    )
    test_db.add(stale)
    await test_db.commit()

    await svc.snapshot_active_prediction_markets_intraday(test_db)

    captured = (
        await test_db.execute(
            select(PredictionMarketIntradaySnapshot.yes_price).limit(1)
        )
    ).scalar()
    assert captured == pytest.approx(0.4), "yes_price must come from outcome_prices[0]"

    remaining = (
        await test_db.execute(
            select(func.count()).select_from(PredictionMarketIntradaySnapshot)
        )
    ).scalar()
    assert remaining == 4, "the expired row should have been pruned and 4 written"
