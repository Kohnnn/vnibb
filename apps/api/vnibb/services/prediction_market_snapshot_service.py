"""Bounded, genuine daily prediction-market measurements and retention."""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import UTC, datetime, timedelta
from time import monotonic

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_intraday_snapshot import PredictionMarketIntradaySnapshot
from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot
from vnibb.services.prediction_market_policy import (
    SNAPSHOT_MARKET_LIMIT,
    SNAPSHOT_SOURCE_LIMIT,
    SNAPSHOT_SOURCES,
    snapshot_eligibility,
)

logger = logging.getLogger(__name__)
SNAPSHOT_RETENTION_DAYS = 30
SNAPSHOT_STORAGE_CEILING_BYTES = 4 * 1024**3
# Account for bounded row payloads and newly allocated heap/index pages in
# each batch, including a first insert into an empty relation.
SNAPSHOT_RESERVED_ROW_BYTES = 32 * 1024
SNAPSHOT_RESERVED_BATCH_BYTES = 128 * 1024
SNAPSHOT_INSERT_BATCH_SIZE = 200
SNAPSHOT_PRUNE_BATCH_SIZE = 1000
SNAPSHOT_PRUNE_MAX_SECONDS = 240.0
_SNAPSHOT_ADVISORY_LOCK_KEY = 863744185
_sqlite_snapshot_lock = asyncio.Lock()

def _yes_price(prices: object) -> float | None:
    if isinstance(prices, list) and prices and type(prices[0]) in (int, float):
        value = float(prices[0])
        if math.isfinite(value) and 0 <= value <= 1:
            return value
    return None


async def _lock_writers(session: AsyncSession) -> None:
    """Serialize PostgreSQL snapshot writers through capacity accounting."""
    if session.get_bind().dialect.name == "postgresql":
        await session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": _SNAPSHOT_ADVISORY_LOCK_KEY}
        )


async def _check_capacity(session: AsyncSession, planned_rows: int) -> None:
    """Fail closed when measured snapshot relations cannot fit another bucket."""
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        used = (await session.execute(text("""
            SELECT pg_total_relation_size('prediction_market_snapshots'::regclass)
                 + pg_total_relation_size('prediction_market_intraday_snapshots'::regclass)
        """))).scalar_one()
    elif dialect == "sqlite":
        daily = (await session.scalar(select(func.count()).select_from(PredictionMarketSnapshot))) or 0
        intraday = (await session.scalar(select(func.count()).select_from(PredictionMarketIntradaySnapshot))) or 0
        used = (daily + intraday) * SNAPSHOT_RESERVED_ROW_BYTES
    else:
        raise RuntimeError(f"Snapshot size cannot be measured on {dialect}")
    if used + planned_rows * SNAPSHOT_RESERVED_ROW_BYTES + SNAPSHOT_RESERVED_BATCH_BYTES > SNAPSHOT_STORAGE_CEILING_BYTES:
        raise RuntimeError("Prediction-market snapshot storage ceiling reached; prune before writing")


async def write_snapshot_bucket(session: AsyncSession, model, now: datetime, bucket: datetime) -> tuple[int, int]:
    """Insert at most 1,000 eligible markets per known source into one bucket."""
    owns_sqlite_lock = False
    try:
        if session.get_bind().dialect.name == "sqlite":
            await _sqlite_snapshot_lock.acquire()
            owns_sqlite_lock = True
        await _lock_writers(session)
        existing_per_source = dict((await session.execute(
            select(model.source, func.count())
            .where(model.bucket_at == bucket)
            .group_by(model.source)
        )).all())
        existing = sum(existing_per_source.values())
        if existing > SNAPSHOT_MARKET_LIMIT or any(
            count > SNAPSHOT_SOURCE_LIMIT for count in existing_per_source.values()
        ):
            raise RuntimeError("Snapshot bucket exceeds the hard row limit")
        remaining = SNAPSHOT_MARKET_LIMIT - existing
        seen = 0
        written = 0
        dialect = session.get_bind().dialect.name
        insert = pg_insert if dialect == "postgresql" else sqlite_insert
        for source in SNAPSHOT_SOURCES:
            source_limit = min(SNAPSHOT_SOURCE_LIMIT - existing_per_source.get(source, 0), remaining)
            if source_limit <= 0:
                continue
            already_captured = select(model.id).where(
                model.bucket_at == bucket,
                model.source == PredictionMarket.source,
                model.source_id == PredictionMarket.source_id,
            ).exists()
            stmt = (
                select(
                    PredictionMarket.id, PredictionMarket.source, PredictionMarket.source_id,
                    PredictionMarket.category, PredictionMarket.question, PredictionMarket.url,
                    PredictionMarket.outcome_prices, PredictionMarket.volume,
                    PredictionMarket.liquidity,
                )
                .where(
                    PredictionMarket.source == source, *snapshot_eligibility(now),
                    or_(PredictionMarket.source != "kalshi", PredictionMarket.source_id.not_like("KXMV%")),
                    ~already_captured,
                )
                .order_by(PredictionMarket.updated_at.desc(), PredictionMarket.id.asc())
                .limit(source_limit)
            )
            markets = (await session.execute(stmt)).all()
            seen += len(markets)
            for start in range(0, len(markets), SNAPSHOT_INSERT_BATCH_SIZE):
                rows = []
                for market in markets[start:start + SNAPSHOT_INSERT_BATCH_SIZE]:
                    price = _yes_price(market.outcome_prices)
                    if price is None or not market.question or (
                        len(market.question.encode("utf-8")) > 8192 or
                        len((market.url or "").encode("utf-8")) > 8192
                    ):
                        continue
                    rows.append({
                        "market_id": market.id, "source": market.source, "source_id": market.source_id,
                        "category": market.category, "question": market.question, "url": market.url,
                        "yes_price": price, "volume": market.volume, "liquidity": market.liquidity,
                        "extra": {}, "captured_at": now, "bucket_at": bucket,
                    })
                if rows:
                    await _check_capacity(session, len(rows))
                    statement = insert(model).values(rows).on_conflict_do_nothing(
                        index_elements=["source", "source_id", "bucket_at"]
                    ).returning(model.id)
                    written += len((await session.execute(statement)).scalars().all())
            remaining -= len(markets)
        await session.commit()
        return written, seen
    except BaseException:
        await session.rollback()
        raise
    finally:
        if owns_sqlite_lock:
            _sqlite_snapshot_lock.release()


async def snapshot_active_prediction_markets(session: AsyncSession) -> int:
    """Write at most one genuine measurement per eligible market each UTC day."""
    now = datetime.now(UTC)
    bucket = now.replace(hour=0, minute=0, second=0, microsecond=0)
    written, seen = await write_snapshot_bucket(session, PredictionMarketSnapshot, now, bucket)
    logger.info("daily prediction-market snapshot: eligible=%d written=%d", seen, written)
    return written


async def prune_daily_snapshots(
    session: AsyncSession, *, now: datetime | None = None,
    batch_size: int = SNAPSHOT_PRUNE_BATCH_SIZE,
    max_seconds: float = SNAPSHOT_PRUNE_MAX_SECONDS,
) -> int:
    """Remove expired daily measurements in bounded, independently committed batches."""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=SNAPSHOT_RETENTION_DAYS)
    limit = max(1, min(batch_size, SNAPSHOT_PRUNE_BATCH_SIZE))
    started = monotonic()
    deleted_total = 0
    while True:
        expired = (
            select(PredictionMarketSnapshot.id)
            .where(PredictionMarketSnapshot.captured_at < cutoff)
            .order_by(PredictionMarketSnapshot.captured_at, PredictionMarketSnapshot.id)
            .limit(limit)
        )
        try:
            deleted = len((await session.execute(
                delete(PredictionMarketSnapshot)
                .where(PredictionMarketSnapshot.id.in_(expired))
                .returning(PredictionMarketSnapshot.id)
            )).scalars().all())
            await session.commit()
        except BaseException:
            await session.rollback()
            raise
        deleted_total += deleted
        if deleted < limit or monotonic() - started >= max_seconds:
            break
    return deleted_total
