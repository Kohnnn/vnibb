"""One-shot live prediction-market ingest and bounded snapshots."""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.services.kalshi_service import ingest_kalshi_markets_with_default_client
from vnibb.services.limitless_service import ingest_limitless_markets_with_default_client
from vnibb.services.manifold_service import ingest_manifold_markets_with_default_client
from vnibb.services.predictit_service import ingest_predictit_markets_with_default_client
from vnibb.services.prediction_market_intraday_snapshot_service import (
    snapshot_active_prediction_markets_intraday,
)
from vnibb.services.prediction_market_service import (
    ingest_polymarket_gamma_markets_with_default_client,
)
from vnibb.services.prediction_market_snapshot_service import snapshot_active_prediction_markets


logger = logging.getLogger(__name__)




async def populate_prediction_markets_now(session: AsyncSession) -> dict[str, int | list[str]]:
    """Run the full prediction-market populate pipeline once.

    Returns a small summary dict suitable for logging.
    """
    counts: dict[str, int] = {}
    failed_sources: list[str] = []

    # 1. Polymarket (live).
    try:
        counts["polymarket"] = await ingest_polymarket_gamma_markets_with_default_client(session)
    except Exception as exc:
        logger.warning("populate: polymarket ingest failed: %s", exc)
        failed_sources.append("polymarket")
        counts["polymarket"] = 0

    # 2. Kalshi (live, paginated).
    try:
        counts["kalshi"] = await ingest_kalshi_markets_with_default_client(session)
    except Exception as exc:
        logger.warning("populate: kalshi ingest failed: %s", exc)
        failed_sources.append("kalshi")
        counts["kalshi"] = 0

    # Live providers only: an outage must not turn fixtures into measurements.
    for source, ingest in (
        ("predictit", ingest_predictit_markets_with_default_client),
        ("limitless", ingest_limitless_markets_with_default_client),
        ("manifold", ingest_manifold_markets_with_default_client),
    ):
        try:
            counts[source] = await ingest(session)
        except Exception as exc:
            logger.warning("populate: %s ingest failed: %s", source, exc)
            failed_sources.append(source)
            counts[source] = 0

    # 6. Nightly snapshot.
    try:
        counts["nightly_snapshot"] = await snapshot_active_prediction_markets(session)
    except Exception as exc:
        logger.warning("populate: nightly snapshot failed: %s", exc)
        counts["nightly_snapshot"] = 0

    # 7. Intraday snapshot (best-effort).
    try:
        intraday = await snapshot_active_prediction_markets_intraday(session)
        counts["intraday_snapshot"] = intraday.rows_written
    except Exception as exc:
        logger.warning("populate: intraday snapshot failed: %s", exc)
        counts["intraday_snapshot"] = 0

    if failed_sources:
        logger.warning("populate_prediction_markets_now partial ingest: failed=%s counts=%s", failed_sources, counts)
    else:
        logger.info("populate_prediction_markets_now complete: %s", counts)
    return counts | {"failed_sources": failed_sources}