"""Shared live-market eligibility and catalogue admission limits."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, union_all
from sqlalchemy.orm import aliased

from vnibb.models.prediction_market import PredictionMarket

SNAPSHOT_SOURCES = ("polymarket", "kalshi", "predictit", "limitless", "manifold")
SNAPSHOT_MARKET_LIMIT = 5_000
SNAPSHOT_SOURCE_LIMIT = 1_000
MARKET_FRESHNESS = timedelta(hours=24)
MAX_INGEST_MARKETS = 1_000
MAX_MARKET_PAYLOAD_BYTES = 4 * 1024 * 1024
MAX_CATALOGUE_RELATION_BYTES = 16 * 1024 * 1024 * 1024
MAX_SOURCE_MARKETS = 10_000
MAX_MARKET_TEXT_BYTES = 8_192
MAX_MARKET_EXTRA_BYTES = 4_096
MAX_MARKET_OUTCOMES = 32

# Catalogue rows are write-once for most providers: the ingest upserts on
# ``(source, source_id)`` but nothing removes a contract the provider later
# delists. Reads only ever consider ``MARKET_FRESHNESS``-window rows within
# ``SNAPSHOT_SOURCE_LIMIT`` per source, so anything older than this horizon is
# unreadable debris that still costs disk and index maintenance. The retention
# job deletes exactly the rows this predicate selects.
MARKET_RETENTION = timedelta(days=7)
# Never let a single provider's sweep run unbounded; the retention job is
# resumable and re-runs daily, so batches keep each transaction short.
MARKET_RETENTION_BATCH = 5_000


def market_retention_cutoff(now: datetime) -> datetime:
    """Naive-UTC cutoff before which unrefreshed catalogue rows are debris."""
    utc_now = now.astimezone(UTC) if now.tzinfo else now.replace(tzinfo=UTC)
    return utc_now.replace(tzinfo=None) - MARKET_RETENTION


def is_kalshi_combo(
    ticker: str,
    event_ticker: str | None = None,
    *,
    mve_collection_ticker: str | None = None,
    mve_selected_legs: object = None,
    market_type: str | None = None,
) -> bool:
    return (
        ticker.upper().startswith("KXMV")
        or bool(event_ticker and event_ticker.upper().startswith("KXMV"))
        or bool(mve_collection_ticker)
        or bool(mve_selected_legs)
        or bool(market_type and market_type.lower() in {"mve", "multivariate", "combo"})
    )


def snapshot_eligibility(now: datetime) -> tuple:
    """Select recently refreshed real open contracts, excluding legacy combos."""
    utc_now = now.astimezone(UTC) if now.tzinfo else now.replace(tzinfo=UTC)
    market = PredictionMarket
    return (
        market.source.in_(SNAPSHOT_SOURCES),
        market.active.is_(True),
        market.closed.is_(False),
        market.is_synthetic.is_(False),
        market.updated_at >= utc_now.replace(tzinfo=None) - MARKET_FRESHNESS,
        or_(market.end_date.is_(None), market.end_date > utc_now),
        or_(
            market.source != "kalshi",
            (market.source_id.not_like("KXMV%") &
             or_(market.slug.is_(None), market.slug.not_like("KXMV%"))),
        ),
    )


def active_market_candidates(now: datetime, sources: tuple[str, ...] = SNAPSHOT_SOURCES):
    """Bound each indexed source before applying display or analysis filters."""
    batches = []
    for source in sources:
        batch = (
            select(PredictionMarket)
            .where(
                PredictionMarket.source == source,
                *snapshot_eligibility(now),
                or_(PredictionMarket.source != "kalshi", PredictionMarket.source_id.not_like("KXMV%")),
            )
            .order_by(PredictionMarket.updated_at.desc(), PredictionMarket.id.asc())
            .limit(SNAPSHOT_SOURCE_LIMIT)
            .subquery()
        )
        batches.append(select(batch))
    return aliased(PredictionMarket, union_all(*batches).subquery())


def observed_yes_price(market: PredictionMarket) -> float | None:
    prices = market.outcome_prices
    if not isinstance(prices, list) or not prices:
        return None
    if any(type(price) not in (int, float) or not 0 <= price <= 1 for price in prices):
        return None
    if sum(prices) == 0:
        return None
    return float(prices[0])
