"""Manifold Markets ingestion.

Open API at ``https://api.manifold.markets/v0``. Auth-optional. Manifold
is an AMM-style platform where YES probability is the market's
``probability`` field (a float in ``[0, 1]``). We map that directly to
``outcome_prices[0]`` so the math is uniform across sources.

Phase 10. The freeform category is preserved under ``extra.raw_category``
and the canonical taxonomy is applied via the shared ``category_taxonomy``
helper.
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


MANIFOLD_BASE_URL: Final = "https://api.manifold.markets/v0"
MANIFOLD_DEFAULT_LIMIT: Final = 200


class ManifoldMarketPayload(BaseModel):
    """One Manifold market (open API)."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: str
    slug: str | None = None
    question: str
    description: str | None = None
    category: str | None = None
    group_slugs: list[str] | None = Field(default=None, alias="groupSlugs")
    url: str | None = None
    close_time: datetime | None = Field(default=None, alias="closeTime")
    is_resolved: bool = Field(default=False, alias="isResolved")
    volume: float | None = None
    liquidity: float | None = None
    probability: float | None = None
    pool: dict | None = None


_MANIFOLD_MARKETS = TypeAdapter(list[ManifoldMarketPayload])


def normalize_manifold_market(payload: ManifoldMarketPayload) -> NormalizedPredictionMarket | None:
    """Normalize one Manifold market into the source-agnostic shape.

    Manifold exposes ``probability`` as the AMM's implied YES probability.
    Markets without a probability (or that are already resolved) are
    dropped so they don't pollute the active list.
    """
    if payload.is_resolved:
        return None
    if not isinstance(payload.probability, (int, float)):
        return None
    yes_price = float(payload.probability)
    if not 0 <= yes_price <= 1:
        return None
    return NormalizedPredictionMarket(
        source="manifold",
        source_id=str(payload.id),
        question=payload.question,
        slug=payload.slug,
        description=payload.description,
        category=category_taxonomy(payload.category),
        url=payload.url
        or (
            f"{MANIFOLD_BASE_URL}/market/{payload.slug or payload.id}"
        ),
        end_date=payload.close_time,
        active=True,
        closed=False,
        volume=payload.volume,
        liquidity=payload.liquidity,
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, max(1.0 - yes_price, 0.0)),
    )


async def fetch_manifold_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[ManifoldMarketPayload]:
    """Fetch active Manifold markets."""
    response = await client.get(
        "/markets",
        params={"limit": limit, "filter": "open"},
    )
    response.raise_for_status()
    return _MANIFOLD_MARKETS.validate_json(response.content)


async def ingest_manifold_markets(
    session,
    client: httpx.AsyncClient,
    limit: int = MANIFOLD_DEFAULT_LIMIT,
) -> int:
    """Fetch, normalize, and upsert Manifold markets into the DB."""
    payloads = await fetch_manifold_markets(client, limit)
    count = 0
    dialect_name = session.get_bind().dialect.name
    for payload in payloads:
        market = normalize_manifold_market(payload)
        if market is None:
            continue
        values: PredictionMarketValues = market.to_values()
        await session.execute(_upsert_prediction_market(values, dialect_name))
        count += 1
    await session.commit()
    return count


async def ingest_manifold_markets_with_default_client(
    session,
    limit: int = MANIFOLD_DEFAULT_LIMIT,
) -> int:
    """Ingest Manifold markets using the production public endpoint."""
    async with httpx.AsyncClient(
        base_url=MANIFOLD_BASE_URL,
        follow_redirects=True,
        timeout=10.0,
        headers={"User-Agent": "vnibb/1.0 (prediction-market-ingest)"},
    ) as client:
        return await ingest_manifold_markets(session, client, limit)