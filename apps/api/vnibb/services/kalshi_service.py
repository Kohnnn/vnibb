"""Kalshi ingestion and prediction-market persistence.

Kalshi is a CFTC-regulated exchange. The public REST API at
https://api.elections.kalshi.com/trade/v2/markets returns active markets
without authentication for read-only consumers. We normalise each market
into the same source-agnostic `PredictionMarket` shape used for Polymarket
so the read endpoints do not need to special-case the source.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market import PredictionMarket
from vnibb.services.prediction_market_service import (
    NormalizedPredictionMarket,
    UnsupportedPredictionMarketDialectError,
    category_taxonomy,
    normalize_gamma_market,  # reuse upsert helper indirectly
)

KALSHI_BASE_URL: Final = "https://api.elections.kalshi.com/trade/v2"
KALSHI_MAX_PAGES: Final = 10
KALSHI_PAGE_LIMIT: Final = 200


class KalshiMarketPayload(BaseModel):
    """Boundary model for the public Kalshi `/markets` response row.

    Kalshi responses nest the actual market fields under `market` and put
    pagination metadata at the top of the envelope. The `extra="ignore"`
    config keeps us forward-compatible with fields Kalshi adds without
    breaking ingestion.
    """

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    ticker: str
    event_ticker: str | None = None
    series_ticker: str | None = None
    title: str
    subtitle: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    status: str = Field(default="open")
    yes_bid: float | None = None
    yes_ask: float | None = None
    no_bid: float | None = None
    no_ask: float | None = None
    last_price: float | None = None
    volume: int | None = None
    open_interest: int | None = None
    close_time: datetime | None = Field(default=None, alias="close_time")


@dataclass(frozen=True, slots=True)
class NormalizedKalshiMarket:
    """Validated source-agnostic prediction market row (Kalshi side)."""

    source: str
    source_id: str
    question: str
    slug: str | None
    description: str | None
    category: str | None
    url: str | None
    end_date: datetime | None
    active: bool
    closed: bool
    volume: float | None
    liquidity: float | None
    outcomes: tuple[str, ...]
    outcome_prices: tuple[float, ...]
    extra: dict | None = None

    def to_values(self) -> dict[str, Any]:
        values: dict[str, Any] = {
            "source": self.source,
            "source_id": self.source_id,
            "question": self.question,
            "slug": self.slug,
            "description": self.description,
            "category": self.category,
            "url": self.url,
            "end_date": self.end_date,
            "active": self.active,
            "closed": self.closed,
            "volume": self.volume,
            "liquidity": self.liquidity,
            "outcomes": list(self.outcomes),
            "outcome_prices": list(self.outcome_prices),
            "updated_at": datetime.utcnow(),
        }
        if self.extra:
            values["extra"] = self.extra
        return values


def _decimal_to_prob(decimal_price: float | None) -> float | None:
    """Convert a Kalshi cent-style price (1-99) into a 0-1 probability.

    Tolerant: Kalshi returns cents in some sandboxes and decimal
    probabilities in others. Treat any value in (0, 1] as a probability,
    any value in (1, 99] as cents, and drop anything > 99 (clearly bogus).
    """
    if decimal_price is None:
        return None
    if decimal_price < 0:
        return None
    if decimal_price <= 1.0:
        return round(float(decimal_price), 4)
    if decimal_price <= 99:
        return round(float(decimal_price) / 100.0, 4)
    return None


def normalize_kalshi_market(payload: KalshiMarketPayload) -> NormalizedKalshiMarket:
    """Normalise one Kalshi market payload into the source-agnostic DB shape."""
    yes_price = _decimal_to_prob(payload.last_price) or _decimal_to_prob(payload.yes_bid)
    no_price = 1.0 - yes_price if yes_price is not None else None

    raw_category = payload.category or (payload.tags[0] if payload.tags else None)
    from vnibb.services.prediction_market_service import canonical_topics

    derived_topics = canonical_topics(payload.title, raw_category)
    extra_categories: list[str] = []
    if raw_category:
        extra_categories.append(raw_category)
    extra_categories.extend(derived_topics)
    extra: dict[str, Any] = {}
    if extra_categories:
        extra["raw_category"] = raw_category
        extra["canonical_topics"] = derived_topics
    return NormalizedKalshiMarket(
        source="kalshi",
        source_id=payload.ticker,
        question=payload.title,
        slug=payload.event_ticker,
        description=payload.subtitle,
        category=category_taxonomy(raw_category),
        url=f"https://kalshi.com/markets/{payload.event_ticker}/{payload.ticker}" if payload.event_ticker else None,
        end_date=payload.close_time,
        active=payload.status == "open",
        closed=payload.status == "closed",
        volume=float(payload.volume) if payload.volume is not None else None,
        liquidity=float(payload.open_interest) if payload.open_interest is not None else None,
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price if yes_price is not None else 0.0, no_price if no_price is not None else 0.0),
        extra=extra or None,
    )


_KALSHI_MARKETS = TypeAdapter(list[KalshiMarketPayload])


async def fetch_kalshi_markets(
    client: httpx.AsyncClient,
    limit: int,
    *,
    max_pages: int = KALSHI_MAX_PAGES,
) -> list[KalshiMarketPayload]:
    """Fetch active Kalshi markets. Returns the parsed market list.

    Paginated cursor loop — Kalshi's first page can carry 200 markets but
    the active corpus is regularly 300+ across all categories. We loop
    until ``cursor`` is null/empty or ``max_pages`` is reached so a single
    ingest cycle captures the entire active set.
    """
    import asyncio as _asyncio

    rows: list[KalshiMarketPayload] = []
    cursor: str | None = None
    for page in range(max_pages):
        params: dict[str, Any] = {"status": "open", "limit": min(limit, KALSHI_PAGE_LIMIT)}
        if cursor:
            params["cursor"] = cursor
        response = await client.get("/markets", params=params)
        response.raise_for_status()
        body = response.json()
        page_rows = body.get("markets", []) if isinstance(body, dict) else body
        if not page_rows:
            break
        rows.extend(_KALSHI_MARKETS.validate_python(page_rows))
        if not isinstance(body, dict):
            break
        cursor = (
            body.get("cursor")
            or body.get("next_cursor")
            or (body.get("meta") or {}).get("cursor")
            or (body.get("meta") or {}).get("next_cursor")
        )
        if not cursor:
            break
        # Be polite: tiny sleep between paginated requests so we don't
        # trip Kalshi's per-second quota. ~250ms.
        await _asyncio.sleep(0.25)
    return rows


async def ingest_kalshi_markets(
    session: AsyncSession,
    client: httpx.AsyncClient,
    limit: int = 200,
    *,
    max_pages: int = KALSHI_MAX_PAGES,
) -> int:
    """Fetch, normalize, and upsert Kalshi markets into the DB.

    Returns the count of markets written. Reuses the same polymarket
    on_conflict_do_update strategy by calling the helper directly.
    """
    from vnibb.services.prediction_market_service import _upsert_prediction_market

    payloads = await fetch_kalshi_markets(client, limit, max_pages=max_pages)
    dialect_name = session.get_bind().dialect.name
    count = 0
    for payload in payloads:
        market = normalize_kalshi_market(payload)
        try:
            await session.execute(_upsert_prediction_market(market.to_values(), dialect_name))
        except UnsupportedPredictionMarketDialectError:
            raise
        count += 1
    await session.commit()
    return count


async def ingest_kalshi_markets_with_default_client(
    session: AsyncSession,
    limit: int = 200,
    *,
    max_pages: int = KALSHI_MAX_PAGES,
) -> int:
    """Ingest Kalshi markets using the production public API endpoint."""
    async with httpx.AsyncClient(
        base_url=KALSHI_BASE_URL,
        follow_redirects=True,
        timeout=15.0,
    ) as client:
        return await ingest_kalshi_markets(session, client, limit, max_pages=max_pages)
