"""One-shot helper that runs every prediction-market ingest + snapshot pass.

Used on a fresh DB to populate the widgets immediately without waiting
for the scheduler's first cycle (or the 75-minute intraday window that
the alerts endpoint needs before it returns data).

Order of operations:

1. Polymarket Gamma (live).
2. Kalshi (live, cursor-paginated).
3. PredictIt (live, with offline seed fallback).
4. Limitless (live, with offline seed fallback).
5. Manifold (live, with offline seed fallback).
6. Nightly snapshot.
7. Backfill (only if the nightly snapshot table is still empty).
8. Intraday snapshot.

Each step is wrapped so a single failure doesn't abort the rest.
"""

from __future__ import annotations

import logging
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.services.kalshi_service import ingest_kalshi_markets_with_default_client
from vnibb.services.limitless_service import ingest_limitless_markets_with_default_client
from vnibb.services.manifold_service import ingest_manifold_markets_with_default_client
from vnibb.services.predictit_service import ingest_predictit_markets_with_default_client
from vnibb.services.prediction_market_intraday_snapshot_service import (
    snapshot_active_prediction_markets_intraday,
)
from vnibb.services.prediction_market_seed import (
    seed_limitless_from_fixture,
    seed_manifold_from_fixture,
    seed_predictit_from_fixture,
)
from vnibb.services.prediction_market_service import (
    ingest_polymarket_gamma_markets_with_default_client,
)
from vnibb.services.prediction_market_snapshot_service import (
    SNAPSHOT_BACKFILL_MIN_THRESHOLD,
    backfill_prediction_market_snapshots,
    snapshot_active_prediction_markets,
    snapshot_row_count,
)


logger = logging.getLogger(__name__)


POPULATE_BACKFILL_DAYS: Final = 7
POPULATE_BACKFILL_SNAPSHOTS_PER_DAY: Final = 2


async def populate_prediction_markets_now(session: AsyncSession) -> dict[str, int]:
    """Run the full prediction-market populate pipeline once.

    Returns a small summary dict suitable for logging.
    """
    counts: dict[str, int] = {}

    # 1. Polymarket (live).
    try:
        counts["polymarket"] = await ingest_polymarket_gamma_markets_with_default_client(session)
    except Exception as exc:
        logger.warning("populate: polymarket ingest failed: %s", exc)
        counts["polymarket"] = 0

    # 2. Kalshi (live, paginated).
    try:
        counts["kalshi"] = await ingest_kalshi_markets_with_default_client(session)
    except Exception as exc:
        logger.warning("populate: kalshi ingest failed: %s", exc)
        counts["kalshi"] = 0

    # 3. PredictIt (live, with offline seed fallback).
    predictit_count = 0
    try:
        predictit_count = await ingest_predictit_markets_with_default_client(session)
    except Exception as exc:
        logger.warning("populate: predictit ingest failed (%s); using offline seed", exc)
    if predictit_count == 0:
        predictit_count = await seed_predictit_from_fixture(session)
    counts["predictit"] = predictit_count

    # 4. Limitless (live, with offline seed fallback).
    limitless_count = 0
    try:
        limitless_count = await ingest_limitless_markets_with_default_client(session)
    except Exception as exc:
        logger.warning("populate: limitless ingest failed (%s); using offline seed", exc)
    if limitless_count == 0:
        limitless_count = await seed_limitless_from_fixture(session)
    counts["limitless"] = limitless_count

    # 5. Manifold (live, with offline seed fallback).
    manifold_count = 0
    try:
        manifold_count = await ingest_manifold_markets_with_default_client(session)
    except Exception as exc:
        logger.warning("populate: manifold ingest failed (%s); using offline seed", exc)
    if manifold_count == 0:
        manifold_count = await seed_manifold_from_fixture(session)
    counts["manifold"] = manifold_count

    # 6. Nightly snapshot.
    try:
        counts["nightly_snapshot"] = await snapshot_active_prediction_markets(session)
    except Exception as exc:
        logger.warning("populate: nightly snapshot failed: %s", exc)
        counts["nightly_snapshot"] = 0

    # 7. Backfill if the snapshot table is still empty.
    pre_backfill_count = await snapshot_row_count(session)
    if pre_backfill_count < SNAPSHOT_BACKFILL_MIN_THRESHOLD:
        try:
            backfill_rows = await backfill_prediction_market_snapshots(
                session,
                days=POPULATE_BACKFILL_DAYS,
                snapshots_per_day=POPULATE_BACKFILL_SNAPSHOTS_PER_DAY,
            )
            counts["backfill"] = backfill_rows
        except Exception as exc:
            logger.warning("populate: backfill failed: %s", exc)
            counts["backfill"] = 0
    else:
        counts["backfill"] = 0

    # 8. Intraday snapshot (best-effort).
    try:
        intraday = await snapshot_active_prediction_markets_intraday(session)
        counts["intraday_snapshot"] = intraday.rows_written
    except Exception as exc:
        logger.warning("populate: intraday snapshot failed: %s", exc)
        counts["intraday_snapshot"] = 0

    logger.info("populate_prediction_markets_now complete: %s", counts)
    return counts