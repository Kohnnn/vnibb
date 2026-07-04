"""Nightly snapshot job for prediction markets.

Writes one row per active market to the `prediction_market_snapshots` table
on each run. The `/movers` endpoint diffs the latest snapshot against a
windowed historical snapshot.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot


SNAPSHOT_RETENTION_DAYS = 30


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
