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

    def to_values(self) -> dict[str, Any]:
        return {
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


def _decimal_to_prob(decimal_price: float | None) -> float | None:
    """Convert a Kalshi cent-style price (1-99) into a 0-1 probability."""
    if decimal_price is None:
        return None
    if not (0 <= decimal_price <= 99):
        return None
    return round(decimal_price / 100.0, 4)


def normalize_kalshi_market(payload: KalshiMarketPayload) -> NormalizedKalshiMarket:
    """Normalise one Kalshi market payload into the source-agnostic DB shape."""
    yes_price = _decimal_to_prob(payload.last_price) or _decimal_to_prob(payload.yes_bid)
    no_price = 1.0 - yes_price if yes_price is not None else None

    raw_category = payload.category or (payload.tags[0] if payload.tags else None)
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
    )


_KALSHI_MARKETS = TypeAdapter(list[KalshiMarketPayload])


async def fetch_kalshi_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[KalshiMarketPayload]:
    """Fetch active Kalshi markets. Returns the parsed market list.

    Kalshi paginates with `cursor`; the lightweight shell here fetches the
    first page only. Production deployments should iterate via the `cursor`
    field which is ignored by our boundary model but surfaced by the
    upstream `meta` envelope.
    """
    response = await client.get(
        "/markets",
        params={"status": "open", "limit": min(limit, 200)},
    )
    response.raise_for_status()
    body = response.json()
    rows = body.get("markets", []) if isinstance(body, dict) else body
    return _KALSHI_MARKETS.validate_python(rows)


async def ingest_kalshi_markets(
    session: AsyncSession,
    client: httpx.AsyncClient,
    limit: int = 100,
) -> int:
    """Fetch, normalize, and upsert Kalshi markets into the DB.

    Returns the count of markets written. Reuses the same polymarket
    on_conflict_do_update strategy by calling the helper directly.
    """
    from vnibb.services.prediction_market_service import _upsert_prediction_market

    payloads = await fetch_kalshi_markets(client, limit)
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
    limit: int = 100,
) -> int:
    """Ingest Kalshi markets using the production public API endpoint."""
    async with httpx.AsyncClient(
        base_url=KALSHI_BASE_URL,
        follow_redirects=True,
        timeout=10.0,
    ) as client:
        return await ingest_kalshi_markets(session, client, limit)
