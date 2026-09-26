"""Bounded intraday prediction-market measurements with independent retention."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market_intraday_snapshot import PredictionMarketIntradaySnapshot
from vnibb.services.prediction_market_snapshot_service import write_snapshot_bucket

logger = logging.getLogger(__name__)

INTRADAY_SNAPSHOT_RETENTION_DAYS = 7
INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE = 1000
INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE = 2000
INTRADAY_SNAPSHOT_PRUNE_MAX_SECONDS = 240.0

@dataclass(slots=True, frozen=True)
class IntradaySnapshotResult:
    """Outcome of one intraday snapshot run."""

    rows_written: int
    markets_seen: int
    was_inserted: bool
    retried: bool

    def as_log_dict(self) -> dict[str, int | bool]:
        return {
            "rows_written": self.rows_written,
            "markets_seen": self.markets_seen,
            "was_inserted": self.was_inserted,
            "retried": self.retried,
        }


@dataclass(slots=True, frozen=True)
class IntradaySnapshotPruneResult:
    """Rows removed, batches committed and cutoff for one bounded sweep."""

    rows_deleted: int
    batches_deleted: int
    cutoff: str
    truncated: bool

    def as_log_dict(self) -> dict[str, int | bool | str]:
        return {
            "rows_deleted": self.rows_deleted,
            "batches_deleted": self.batches_deleted,
            "cutoff": self.cutoff,
            "truncated": self.truncated,
        }


async def snapshot_active_prediction_markets_intraday(
    session: AsyncSession,
) -> IntradaySnapshotResult:
    """Write one genuine bounded measurement per market and 15-minute bucket."""
    now = datetime.now(UTC)
    bucket = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
    written, seen = await write_snapshot_bucket(
        session, PredictionMarketIntradaySnapshot, now, bucket
    )
    return IntradaySnapshotResult(
        rows_written=written,
        markets_seen=seen,
        was_inserted=written > 0,
        retried=False,
    )

def _prune_batch_size() -> int:
    """Clamp the configured batch size into the enforced bound."""
    configured = INTRADAY_SNAPSHOT_PRUNE_BATCH_SIZE
    if not isinstance(configured, int) or configured < 1:
        logger.warning(
            "invalid intraday prune batch size %r; using %s",
            configured,
            INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE,
        )
        return INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE
    return min(configured, INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE)


async def prune_intraday_snapshots(
    session: AsyncSession,
    *,
    now=None,
    retention_days: int | None = None,
    batch_size: int | None = None,
    max_seconds: float | None = None,
    monotonic=None,
) -> IntradaySnapshotPruneResult:
    """Remove snapshots strictly older than one fixed seven-day cutoff.

    Each committed delete selects at most ``batch_size`` expired IDs using the
    captured_at index. Later ticks reselect remaining rows after interruption.
    """
    from datetime import timedelta
    from time import monotonic as _monotonic

    clock = monotonic or _monotonic
    now = now or datetime.now(UTC)
    days = INTRADAY_SNAPSHOT_RETENTION_DAYS if retention_days is None else retention_days
    limit = _prune_batch_size() if batch_size is None else max(1, batch_size)
    limit = min(limit, INTRADAY_SNAPSHOT_PRUNE_MAX_BATCH_SIZE)
    budget = INTRADAY_SNAPSHOT_PRUNE_MAX_SECONDS if max_seconds is None else max_seconds
    cutoff = now - timedelta(days=days)
    started = clock()

    rows_deleted = 0
    batches_deleted = 0
    truncated = False

    while True:
        expired = (
            select(PredictionMarketIntradaySnapshot.id)
            .where(PredictionMarketIntradaySnapshot.captured_at < cutoff)
            .order_by(PredictionMarketIntradaySnapshot.captured_at)
            .limit(limit)
        ).scalar_subquery()
        statement = (
            delete(PredictionMarketIntradaySnapshot)
            .where(PredictionMarketIntradaySnapshot.id.in_(expired))
            .returning(PredictionMarketIntradaySnapshot.id)
        )
        try:
            deleted = len((await session.execute(statement)).scalars().all())
            await session.commit()
        except BaseException:
            await session.rollback()
            raise

        rows_deleted += deleted
        if deleted:
            batches_deleted += 1

        # A short batch means no expired rows are left, so the sweep stops
        # here: steady state costs exactly one probe per tick.
        if deleted < limit:
            break
        if clock() - started >= budget:
            truncated = True
            logger.warning(
                "intraday snapshot prune stopped after %.1fs budget: "
                "rows=%s batches=%s cutoff=%s",
                budget,
                rows_deleted,
                batches_deleted,
                cutoff.isoformat(),
            )
            break

    logger.info(
        "intraday snapshot prune complete: rows=%s batches=%s cutoff=%s truncated=%s",
        rows_deleted,
        batches_deleted,
        cutoff.isoformat(),
        truncated,
    )

    return IntradaySnapshotPruneResult(
        rows_deleted=rows_deleted,
        batches_deleted=batches_deleted,
        cutoff=cutoff.isoformat(),
        truncated=truncated,
    )


