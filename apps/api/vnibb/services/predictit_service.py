"""PredictIt ingestion.

Public REST API at ``https://www.predictit.org/api/markets`` (no auth).
Rate limit ~30 req/min. The endpoint returns one row per market; each
market carries a list of contracts whose ``LatestYesPrice`` we map to
the source-agnostic prediction-market row.

Phase 9: the freeform category is mapped through the canonical taxonomy
(``politics`` and ``general`` are the two buckets the public PredictIt
corpus naturally falls into) and the original is preserved under
``extra.raw_category``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Final

import httpx
from pydantic import BaseModel, ConfigDict, Field, Json, TypeAdapter

from vnibb.services.prediction_market_service import (
    NormalizedPredictionMarket,
    PredictionMarketValues,
    category_taxonomy,
    _upsert_prediction_market,
)


PREDICTIT_BASE_URL: Final = "https://www.predictit.org/api"
PREDICTIT_DEFAULT_LIMIT: Final = 200


class PredictItContractPayload(BaseModel):
    """One contract (Yes/No side) under a PredictIt market."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: int | str | None = None
    name: str | None = None
    latest_yes_price: float | None = Field(default=None, alias="LatestYesPrice")
    latest_no_price: float | None = Field(default=None, alias="LatestNoPrice")


class PredictItMarketPayload(BaseModel):
    """One market (set of contracts) on PredictIt."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: int | str
    name: str
    short_name: str | None = Field(default=None, alias="shortName")
    url: str | None = Field(default=None, alias="url")
    category: str | None = None
    sub_category: str | None = Field(default=None, alias="subCategory")
    contracts: list[PredictItContractPayload] = Field(default_factory=list)
    time_stamp: str | None = Field(default=None, alias="timeStamp")


_PREDICTIT_MARKETS = TypeAdapter(list[PredictItMarketPayload])


def _predictit_url(market: PredictItMarketPayload) -> str | None:
    if market.url:
        return str(market.url)
    if market.short_name:
        slug = "".join(
            ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in market.short_name.lower()
        ).strip("-")
        if slug:
            return f"https://www.predictit.org/predictions/markets/detail/{market.id}/{slug}"
    return f"https://www.predictit.org/predictions/markets/detail/{market.id}"


def normalize_predictit_market(payload: PredictItMarketPayload) -> NormalizedPredictionMarket | None:
    """Normalize one PredictIt market into the source-agnostic shape.

    PredictIt returns a list of binary contracts under each market; we
    collapse that into a single ``outcomes=["Yes", "No"]`` row whose
    ``outcome_prices[0]`` is the volume-weighted ``LatestYesPrice`` of the
    contracts. Markets without any priced contracts are dropped.
    """
    priced_contracts = [
        contract
        for contract in payload.contracts
        if isinstance(contract.latest_yes_price, (int, float))
    ]
    if not priced_contracts:
        return None
    weighted_sum = sum(float(c.latest_yes_price or 0.0) for c in priced_contracts)
    yes_price = weighted_sum / len(priced_contracts)
    return NormalizedPredictionMarket(
        source="predictit",
        source_id=str(payload.id),
        question=payload.name,
        slug=payload.short_name,
        description=payload.sub_category,
        category=category_taxonomy(payload.category),
        url=_predictit_url(payload),
        end_date=None,
        active=True,
        closed=False,
        volume=None,
        liquidity=None,
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, max(1.0 - yes_price, 0.0)),
    )


async def fetch_predictit_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[PredictItMarketPayload]:
    """Fetch all active PredictIt markets."""
    response = await client.get(
        "/markets",
        params={"limit": limit, "active": "true"},
    )
    response.raise_for_status()
    return _PREDICTIT_MARKETS.validate_json(response.content)


async def ingest_predictit_markets(
    session,
    client: httpx.AsyncClient,
    limit: int = PREDICTIT_DEFAULT_LIMIT,
) -> int:
    """Fetch, normalize, and upsert PredictIt markets into the DB."""
    payloads = await fetch_predictit_markets(client, limit)
    count = 0
    dialect_name = session.get_bind().dialect.name
    for payload in payloads:
        market = normalize_predictit_market(payload)
        if market is None:
            continue
        values: PredictionMarketValues = market.to_values()
        await session.execute(_upsert_prediction_market(values, dialect_name))
        count += 1
    await session.commit()
    return count


async def ingest_predictit_markets_with_default_client(
    session,
    limit: int = PREDICTIT_DEFAULT_LIMIT,
) -> int:
    """Ingest PredictIt markets using the production public endpoint."""
    async with httpx.AsyncClient(
        base_url=PREDICTIT_BASE_URL,
        follow_redirects=True,
        timeout=10.0,
        headers={"User-Agent": "vnibb/1.0 (prediction-market-ingest)"},
    ) as client:
        return await ingest_predictit_markets(session, client, limit)