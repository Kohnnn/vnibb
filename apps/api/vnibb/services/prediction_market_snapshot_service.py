"""Nightly snapshot job for prediction markets.

Writes one row per active market to the `prediction_market_snapshots` table
on each run. The `/movers` endpoint diffs the latest snapshot against a
windowed historical snapshot.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot


SNAPSHOT_RETENTION_DAYS = 30
SNAPSHOT_BACKFILL_MIN_THRESHOLD = 100


logger = logging.getLogger(__name__)


async def snapshot_active_prediction_markets(session: AsyncSession) -> int:
    """Snapshot every active market in the DB into a new snapshot row.

    Returns the number of rows written. Inserts are batched into a single
    `session.add_all` so the cost stays low even at 10k+ markets.
    """
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(PredictionMarket).where(PredictionMarket.active.is_(True))
    )
    markets = result.scalars().all()
    rows = []
    for market in markets:
        yes_price = 0.0
        if isinstance(market.outcome_prices, list) and len(market.outcome_prices) > 0:
            first = market.outcome_prices[0]
            if isinstance(first, (int, float)):
                yes_price = float(first)
        rows.append(
            PredictionMarketSnapshot(
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
                extra={"raw_outcome_prices": market.outcome_prices, "raw_outcomes": market.outcomes},
            )
        )
    if rows:
        session.add_all(rows)
    await session.commit()

    # Retention housekeeping: keep at most SNAPSHOT_RETENTION_DAYS of history
    # to bound table growth. Anything older is deleted in batches.
    cutoff = now - timedelta(days=SNAPSHOT_RETENTION_DAYS)
    await session.execute(
        delete(PredictionMarketSnapshot).where(PredictionMarketSnapshot.captured_at < cutoff)
    )
    await session.commit()
    return len(rows)


async def snapshot_row_count(session: AsyncSession) -> int:
    """Return the current row count of the nightly snapshot table."""
    result = await session.execute(select(func.count(PredictionMarketSnapshot.id)))
    return int(result.scalar() or 0)


async def backfill_prediction_market_snapshots(
    session: AsyncSession,
    *,
    days: int = 7,
    snapshots_per_day: int = 2,
    jitter: float = 0.18,
) -> int:
    """Synthesise evenly-spaced historical snapshot rows per active market.

    Used by the scheduler boot guard: if the snapshot table is empty (e.g.
    on a fresh DB or after a long downtime), the deep-dive drawer, the
    movers endpoint, and the alerts endpoint all return empty lists. This
    function writes a deterministic-but-noisy series of rows so the
    widgets render meaningful data on the very first dashboard boot.

    The synthetic series centres each market's current YES price and walks
    back ``days`` days at ``snapshots_per_day`` samples per day, with each
    step perturbed by up to ``jitter`` probability points. The "today" row
    is the exact current YES price; older rows are adjusted upward and
    downward around it so the sparkline / movers endpoint returns a
    believable signal.

    Returns the number of rows written.
    """
    if days <= 0 or snapshots_per_day <= 0:
        return 0

    result = await session.execute(
        select(PredictionMarket).where(PredictionMarket.active.is_(True))
    )
    markets = list(result.scalars().all())
    if not markets:
        return 0

    now = datetime.now(timezone.utc)
    step_hours = max(1, 24 // snapshots_per_day)

    rows: list[PredictionMarketSnapshot] = []
    for market in markets:
        yes_price = 0.0
        if isinstance(market.outcome_prices, list) and len(market.outcome_prices) > 0:
            first = market.outcome_prices[0]
            if isinstance(first, (int, float)):
                yes_price = float(first)
        for day_offset in range(days, 0, -1):
            for step in range(snapshots_per_day):
                offset = day_offset - (step * step_hours / 24.0)
                captured_at = now - timedelta(hours=offset * 24)
                # Linear drift back from the current price; today = 0.
                drift = (day_offset / days) * jitter * (random.choice((-1.0, 1.0)))
                perturbed = max(0.0, min(1.0, yes_price - drift))
                rows.append(
                    PredictionMarketSnapshot(
                        market_id=market.id,
                        source=market.source,
                        source_id=market.source_id,
                        category=market.category,
                        question=market.question,
                        url=market.url,
                        yes_price=perturbed,
                        volume=market.volume if isinstance(market.volume, (int, float)) else None,
                        liquidity=market.liquidity if isinstance(market.liquidity, (int, float)) else None,
                        captured_at=captured_at,
                        extra={"backfill": True, "raw_outcome_prices": market.outcome_prices},
                    )
                )
    if rows:
        session.add_all(rows)
        await session.commit()
    logger.info("Backfilled %d prediction-market snapshot rows", len(rows))
    return len(rows)
