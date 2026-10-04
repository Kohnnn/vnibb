"""Manifold Markets ingestion.

Open API at ``https://api.manifold.markets/v0``. Auth-optional. Manifold
is an AMM-style platform where YES probability is the market's
``probability`` field (a float in ``[0, 1]``). We map that directly to
``outcome_prices[0]`` so the math is uniform across sources.

The listing endpoint is ``GET /search-markets``: the older ``/markets``
collection rejects ``filter`` outright and returns closed markets
alongside open ones. ``filter=open`` + ``contractType=BINARY`` is the
documented pair that restricts the response to tradable binary markets
(limit max 1000 per page); ``token=ALL`` keeps every token type in the
catalogue, matching the previous all-tokens behaviour.

``LiteMarket`` has no category field, so the shared ``category_taxonomy``
helper falls back to its default and derived topics are stored under
``extra.canonical_topics``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Final

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from vnibb.services.prediction_market_http import (
    PredictionMarketFetchError,
    fetch_json_with_retry,
)
from vnibb.services.prediction_market_service import (
    NormalizedPredictionMarket,
    bounded_market_limit,
    canonical_topics,
    category_taxonomy,
    persist_prediction_markets,
)

MANIFOLD_BASE_URL: Final = "https://api.manifold.markets/v0"
MANIFOLD_SEARCH_PATH: Final = "/search-markets"
MANIFOLD_WEB_URL: Final = "https://manifold.markets"
#: The documented ceiling for a single ``search-markets`` page.
MANIFOLD_MAX_LIMIT: Final = 1000
MANIFOLD_DEFAULT_LIMIT: Final = 200


class ManifoldMarketPayload(BaseModel):
    """One Manifold market (open API ``LiteMarket`` projection)."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: str
    slug: str | None = None
    question: str
    url: str | None = None
    close_time: datetime | None = Field(default=None, alias="closeTime")
    is_resolved: bool = Field(default=False, alias="isResolved")
    outcome_type: str | None = Field(default=None, alias="outcomeType")
    volume: float | None = None
    #: The wire field is ``totalLiquidity``; the DB column stays ``liquidity``.
    liquidity: float | None = Field(default=None, alias="totalLiquidity")
    probability: float | None = None


_MANIFOLD_MARKETS = TypeAdapter(list[ManifoldMarketPayload])


def _market_url(payload: ManifoldMarketPayload) -> str | None:
    if payload.url:
        return payload.url
    slug = payload.slug or payload.id
    return f"{MANIFOLD_WEB_URL}/market/{slug}" if slug else None


def normalize_manifold_market(payload: ManifoldMarketPayload) -> NormalizedPredictionMarket | None:
    """Normalize one Manifold market into the source-agnostic shape.

    Manifold exposes ``probability`` as the AMM's implied YES probability,
    but only binary (and pseudo-numeric) contracts define it. Markets that
    are resolved, non-binary, or missing an in-range probability are
    dropped so they don't pollute the active list.
    """
    if payload.is_resolved:
        return None
    outcome_type = (payload.outcome_type or "").strip().upper()
    if outcome_type and outcome_type != "BINARY":
        return None
    if not isinstance(payload.probability, (int, float)):
        return None
    yes_price = float(payload.probability)
    if not 0.0 <= yes_price <= 1.0:
        return None
    # ``LiteMarket`` has no category field; topics are derived from the question.
    derived_topics = canonical_topics(payload.question)
    extra: dict[str, object] = {}
    if derived_topics:
        extra["canonical_topics"] = derived_topics
    return NormalizedPredictionMarket(
        source="manifold",
        source_id=str(payload.id),
        question=payload.question,
        slug=payload.slug,
        description=None,
        category=category_taxonomy(None),
        url=_market_url(payload),
        end_date=payload.close_time,
        active=True,
        closed=False,
        volume=payload.volume,
        liquidity=payload.liquidity,
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, max(1.0 - yes_price, 0.0)),
        extra=extra or None,
    )


async def fetch_manifold_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[ManifoldMarketPayload]:
    """Fetch open binary Manifold markets via the resilient JSON fetcher."""
    page_limit = min(bounded_market_limit(limit), MANIFOLD_MAX_LIMIT)
    body = await fetch_json_with_retry(
        client,
        source="manifold",
        url=MANIFOLD_SEARCH_PATH,
        params={
            "filter": "open",
            "contractType": "BINARY",
            "token": "ALL",
            "limit": page_limit,
        },
    )
    if not isinstance(body, list):
        raise PredictionMarketFetchError(
            "manifold", None, "unexpected response envelope: expected a market list",
        )
    return _MANIFOLD_MARKETS.validate_python(body[:page_limit])


async def ingest_manifold_markets(
    session,
    client: httpx.AsyncClient,
    limit: int = MANIFOLD_DEFAULT_LIMIT,
) -> int:
    """Fetch, normalize, and upsert Manifold markets into the DB."""
    payloads = await fetch_manifold_markets(client, limit)
    values = [market.to_values() for payload in payloads
              if (market := normalize_manifold_market(payload)) is not None]
    return await persist_prediction_markets(session, values)


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
