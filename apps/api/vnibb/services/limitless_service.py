"""Limitless exchange ingestion.

Public REST API at ``https://api.limitless.exchange/markets`` (no auth).
Limitless is a crypto-meta prediction market: contracts resolve on real
outcomes like BTC end-of-day, ETH close, etc. We map ``prices.{yes,no}``
into the source-agnostic prediction-market row and apply the canonical
taxonomy (``crypto`` and ``general`` are the two natural buckets).
"""

from __future__ import annotations

from datetime import datetime
from typing import Final

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from vnibb.services.prediction_market_service import (
    NormalizedPredictionMarket,
    PredictionMarketValues,
    category_taxonomy,
    _upsert_prediction_market,
)


LIMITLESS_BASE_URL: Final = "https://api.limitless.exchange"
LIMITLESS_DEFAULT_LIMIT: Final = 200


class LimitlessPrices(BaseModel):
    """Outcome-price block on a Limitless market."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    yes: float | None = None
    no: float | None = None


class LimitlessMarketPayload(BaseModel):
    """One Limitless market."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: int | str
    title: str
    slug: str | None = None
    description: str | None = None
    category: str | None = None
    url: str | None = Field(default=None, alias="url")
    expiration: datetime | None = None
    active: bool = True
    closed: bool = False
    volume: float | None = None
    liquidity: float | None = None
    prices: LimitlessPrices | None = None


_LIMITLESS_MARKETS = TypeAdapter(list[LimitlessMarketPayload])


def normalize_limitless_market(payload: LimitlessMarketPayload) -> NormalizedPredictionMarket | None:
    """Normalize one Limitless market into the source-agnostic shape.

    Markets without a Yes price are dropped (Limitless can briefly expose
    unpriced markets while seeding). The No price is derived from Yes when
    absent to keep the row self-consistent.
    """
    yes_price = payload.prices.yes if payload.prices else None
    no_price = payload.prices.no if payload.prices else None
    if not isinstance(yes_price, (int, float)):
        return None
    yes_price = float(yes_price)
    if not isinstance(no_price, (int, float)):
        no_price = max(1.0 - yes_price, 0.0)
    return NormalizedPredictionMarket(
        source="limitless",
        source_id=str(payload.id),
        question=payload.title,
        slug=payload.slug,
        description=payload.description,
        category=category_taxonomy(payload.category),
        url=payload.url
        or (f"{LIMITLESS_BASE_URL}/markets/{payload.slug}" if payload.slug else None),
        end_date=payload.expiration,
        active=payload.active and not payload.closed,
        closed=payload.closed,
        volume=payload.volume,
        liquidity=payload.liquidity,
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, float(no_price)),
    )


async def fetch_limitless_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[LimitlessMarketPayload]:
    """Fetch active Limitless markets."""
    response = await client.get(
        "/markets",
        params={"limit": limit, "active": "true"},
    )
    response.raise_for_status()
    return _LIMITLESS_MARKETS.validate_json(response.content)


async def ingest_limitless_markets(
    session,
    client: httpx.AsyncClient,
    limit: int = LIMITLESS_DEFAULT_LIMIT,
) -> int:
    """Fetch, normalize, and upsert Limitless markets into the DB."""
    payloads = await fetch_limitless_markets(client, limit)
    count = 0
    dialect_name = session.get_bind().dialect.name
    for payload in payloads:
        market = normalize_limitless_market(payload)
        if market is None:
            continue
        values: PredictionMarketValues = market.to_values()
        await session.execute(_upsert_prediction_market(values, dialect_name))
        count += 1
    await session.commit()
    return count


async def ingest_limitless_markets_with_default_client(
    session,
    limit: int = LIMITLESS_DEFAULT_LIMIT,
) -> int:
    """Ingest Limitless markets using the production public endpoint."""
    async with httpx.AsyncClient(
        base_url=LIMITLESS_BASE_URL,
        follow_redirects=True,
        timeout=10.0,
        headers={"User-Agent": "vnibb/1.0 (prediction-market-ingest)"},
    ) as client:
        return await ingest_limitless_markets(session, client, limit)