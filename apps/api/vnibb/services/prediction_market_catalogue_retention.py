"""Catalogue debris retention for ``prediction_markets``.

The ingest upserts on ``(source, source_id)`` and removes nothing. Providers such
as Kalshi mint short-dated contracts continuously, so the table accumulates
write-once rows that no read path can ever return: reads only consider rows
refreshed within ``MARKET_FRESHNESS`` inside ``SNAPSHOT_SOURCE_LIMIT`` per source.

This job deletes the complement — rows a provider has not refreshed for
``MARKET_RETENTION`` — which is unreadable by construction.

The sweep deliberately walks the stale end with ``ORDER BY updated_at, id`` and
a ``LIMIT`` instead of counting the complement first. Measuring on production
showed the debris is ~83 % of a 14.7 M row table, so a count is planned as a
parallel sequential scan (~112 s) while the bounded ordered walk resolves via
``ix_prediction_markets_updated_at_id`` in a few milliseconds. Deletion is
batched and resumable so each transaction stays short and the daily schedule can
drain a large backlog over several runs.

Rows that retention cannot safely drop are deliberately kept:

* terminal, resolved contracts are owned by ``prediction_market_retention``,
  which archives before deleting and requires an operator receipt;
* rows referenced by archived snapshots are kept so history stays explainable;
* synthetic fixture rows are provenance, not debris.

Run: ``python -m vnibb.services.prediction_market_catalogue_retention --limit 5000``
Apply: add ``--apply``.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import delete, not_, select

from vnibb.core.database import async_session_maker
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_archive import PredictionMarketArchive
from vnibb.services.prediction_market_policy import (
    MARKET_RETENTION_BATCH,
    market_retention_cutoff,
)

logger = logging.getLogger(__name__)


def _debris_predicate(cutoff: datetime):
    """Stale, unarchived, non-synthetic catalogue rows (no explicit ordering)."""
    archive_owner = select(PredictionMarketArchive.market_id).where(
        PredictionMarketArchive.market_id == PredictionMarket.id
    )
    return (
        PredictionMarket.updated_at < cutoff,
        PredictionMarket.is_synthetic.is_(False),
        not_(archive_owner.exists()),
    )


def _batch_select(cutoff: datetime, limit: int):
    """Bounded walk over the stale end of the table.

    Ordering by ``(updated_at, id)`` with a ``LIMIT`` lets the
    ``ix_prediction_markets_updated_at_id`` index serve the batch directly.
    Counting the whole complement instead is a measured trap: the debris is
    ~83 % of a 14.7 M row table, so PostgreSQL correctly prefers a parallel
    sequential scan and the same rows cost ~112 s instead of a few ms.
    """
    return (
        select(PredictionMarket.id)
        .where(*_debris_predicate(cutoff))
        .order_by(PredictionMarket.updated_at, PredictionMarket.id)
        .limit(limit)
    )


async def has_catalogue_debris(session, *, now: datetime | None = None) -> bool:
    """Cheap existence check: one bounded index probe, never a full count."""
    cutoff = market_retention_cutoff(now or datetime.now(UTC))
    probe = (
        select(PredictionMarket.id)
        .where(*_debris_predicate(cutoff))
        .limit(1)
    )
    return (await session.execute(probe)).first() is not None


async def purge_catalogue_debris(
    session,
    *,
    limit: int = MARKET_RETENTION_BATCH,
    now: datetime | None = None,
    apply: bool = False,
) -> dict[str, int]:
    """Delete up to ``limit`` unreadable catalogue rows. Returns a receipt."""
    cutoff = market_retention_cutoff(now or datetime.now(UTC))
    ids = [
        row[0]
        for row in (await session.execute(_batch_select(cutoff, limit))).all()
    ]
    if not apply or not ids:
        return {"candidates": len(ids), "deleted": 0, "cutoff": cutoff.isoformat()}

    # Archive ownership can change between selection and delete; re-assert the
    # predicate so a concurrent archive never loses its referent.
    result = await session.execute(
        delete(PredictionMarket).where(
            PredictionMarket.id.in_(ids),
            *_debris_predicate(cutoff),
        )
    )
    await session.commit()
    return {
        "candidates": len(ids),
        "deleted": int(result.rowcount or 0),
        "cutoff": cutoff.isoformat(),
    }


async def _main(limit: int, apply: bool) -> None:
    async with async_session_maker() as session:
        pending = await has_catalogue_debris(session)
        receipt = await purge_catalogue_debris(session, limit=limit, apply=apply)
    logger.info(
        "prediction_market_catalogue_retention %s: debris_pending=%s receipt=%s",
        "apply" if apply else "dry-run",
        pending,
        receipt,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=MARKET_RETENTION_BATCH)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_main(args.limit, args.apply))


if __name__ == "__main__":
    main()
