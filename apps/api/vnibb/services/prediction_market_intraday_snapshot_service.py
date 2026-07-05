"""Intraday micro-snapshot service for prediction markets.

Phase 8: writes a 15-minute-cadence micro-snapshot of every active
prediction market into ``prediction_market_intraday_snapshots``. Retention
is 7 days (much shorter than the nightly snapshot's 30 days) and enforced
in-line by this service.

Differences vs. ``prediction_market_snapshot_service``:

* Cadence is 15 min, not daily.
* 7-day retention (was 30 days for nightly).
* Returns a small dataclass instead of a bare count, so the scheduler can
  log throughput + first-failure trace.
* Wraps the DB write in a single ``retry_once`` so a dropped connection
  doesn't lose the whole batch (a single batch of 10k markets can be
  ~3-5 s; we want one re-try, not the whole job failing).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_intraday_snapshot import (
    PredictionMarketIntradaySnapshot,
)


logger = logging.getLogger(__name__)


INTRADAY_SNAPSHOT_RETENTION_DAYS = 7


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


async def _write_once(
    session: AsyncSession, rows: list[PredictionMarketIntradaySnapshot]
) -> None:
    session.add_all(rows)
    await session.commit()


async def _retry_once(
    coro_factory, *, label: str
):
    """Run ``coro_factory()``; on OperationalError, log and try once more."""
    try:
        return await coro_factory(), False
    except (OperationalError, DBAPIError) as exc:
        logger.warning(
            "%s hit transient DB error %s; retrying once", label, exc.__class__.__name__
        )
        return await coro_factory(), True


def _build_rows(now) -> list[PredictionMarketIntradaySnapshot]:
    """Build an empty row scaffold from currently-active markets.

    Kept as a closure-free function so it is easy to test.
    """
    return [
        PredictionMarketIntradaySnapshot(
            market_id=market.id,
            source=market.source,
            source_id=market.source_id,
            category=market.category,
            question=market.question,
            url=market.url,
            yes_price=0.0,
            volume=market.volume if isinstance(market.volume, (int, float)) else None,
            liquidity=market.liquidity if isinstance(market.liquidity, (int, float)) else None,
            captured_at=now,
            extra={"raw_outcome_prices": market.outcome_prices, "raw_outcomes": market.outcomes},
        )
        for market in []  # populated by the caller
    ]


async def snapshot_active_prediction_markets_intraday(
    session: AsyncSession,
) -> IntradaySnapshotResult:
    """Snapshot every active market into a fresh intraday row.

    The insert batch is wrapped in a single ``retry_once`` so a dropped
    connection doesn't lose the whole batch. Returns a small dataclass so
    the scheduler can log structured throughput without parsing a string.
    """
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)

    result = await session.execute(
        select(PredictionMarket).where(PredictionMarket.active.is_(True))
    )
    markets = list(result.scalars().all())

    rows: list[PredictionMarketIntradaySnapshot] = []
    for market in markets:
        yes_price = 0.0
        if isinstance(market.outcome_prices, list) and len(market.outcome_prices) > 0:
            first = market.outcome_prices[0]
            if isinstance(first, (int, float)):
                yes_price = float(first)
        rows.append(
            PredictionMarketIntradaySnapshot(
                market_id=market.id,
                source=market.source,
                source_id=market.source_id,
                category=market.category,
                question=market.question,
                url=market.url,
                yes_price=yes_price,
                volume=market.volume if isinstance(market.volume, (int, float)) else None,
                liquidity=market.liquidity if isinstance(market.liquidity, (int, float)) else None,
                captured_at=now,
                extra={
                    "raw_outcome_prices": market.outcome_prices,
                    "raw_outcomes": market.outcomes,
                },
            )
        )

    retried = False
    was_inserted = False
    if rows:
        async def _commit():
            return await _write_once(session, rows)

        _, retried = await _retry_once(_commit, label="intraday_snapshot_write")
        was_inserted = True

    # Retention housekeeping: keep at most INTRADAY_SNAPSHOT_RETENTION_DAYS.
    cutoff = now - timedelta(days=INTRADAY_SNAPSHOT_RETENTION_DAYS)
    await session.execute(
        delete(PredictionMarketIntradaySnapshot).where(
            PredictionMarketIntradaySnapshot.captured_at < cutoff
        )
    )
    await session.commit()

    return IntradaySnapshotResult(
        rows_written=len(rows),
        markets_seen=len(markets),
        was_inserted=was_inserted,
        retried=retried,
    )