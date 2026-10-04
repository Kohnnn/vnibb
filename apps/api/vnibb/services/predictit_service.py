"""PredictIt ingestion.

Official public market-data feed at
``https://www.predictit.org/api/marketdata/all/`` (no auth). The feed
returns every market with its contracts in one document and takes no
query parameters; each contract carries the wire price fields
``lastTradePrice`` / ``bestBuyYesCost`` / ``lastClosePrice`` and a
``status`` of ``Open`` or ``Closed``.

The endpoint sits behind Cloudflare, so a blocked egress path surfaces as
the provider's real 403 instead of any fabricated data. Prices are
dollars in ``[0, 1]``; the market row keeps the unweighted mean of the
priced contracts' probabilities so the existing Yes/No consumer contract
is unchanged, while ``active`` mirrors whether any contract is still
open.
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
from vnibb.services.prediction_market_policy import MAX_INGEST_MARKETS
from vnibb.services.prediction_market_service import (
    NormalizedPredictionMarket,
    bounded_market_limit,
    canonical_topics,
    category_taxonomy,
    persist_prediction_markets,
)

PREDICTIT_BASE_URL: Final = "https://www.predictit.org/api"
PREDICTIT_MARKETDATA_PATH: Final = "/marketdata/all/"
PREDICTIT_WEB_URL: Final = "https://www.predictit.org"
PREDICTIT_DEFAULT_LIMIT: Final = 200


class PredictItContractPayload(BaseModel):
    """One contract (Yes/No side) under a PredictIt market."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: int | str | None = None
    name: str | None = None
    status: str | None = None
    last_trade_price: float | None = Field(default=None, alias="lastTradePrice")
    best_buy_yes_cost: float | None = Field(default=None, alias="bestBuyYesCost")
    best_sell_yes_cost: float | None = Field(default=None, alias="bestSellYesCost")
    last_close_price: float | None = Field(default=None, alias="lastClosePrice")
    #: ISO timestamp, or the literal ``"NA"`` when the contract has none.
    date_end: str | None = Field(default=None, alias="dateEnd")


class PredictItMarketPayload(BaseModel):
    """One market (set of contracts) on PredictIt."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: int | str
    name: str
    short_name: str | None = Field(default=None, alias="shortName")
    url: str | None = Field(default=None, alias="url")
    contracts: list[PredictItContractPayload] = Field(default_factory=list)
    time_stamp: str | None = Field(default=None, alias="timeStamp")


_PREDICTIT_MARKETS = TypeAdapter(list[PredictItMarketPayload])


def _predictit_url(market: PredictItMarketPayload) -> str:
    if market.url:
        return str(market.url)
    if market.short_name:
        slug = "".join(
            ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in market.short_name.lower()
        ).strip("-")
        if slug:
            return f"{PREDICTIT_WEB_URL}/predictions/markets/detail/{market.id}/{slug}"
    return f"{PREDICTIT_WEB_URL}/predictions/markets/detail/{market.id}"


def _contract_probability(contract: PredictItContractPayload) -> float | None:
    """Return the contract's traded probability, preferring the last trade.

    Falls back to the current best buy-yes offer and then the prior close,
    matching the field precedence the public feed documents.
    """
    for value in (contract.last_trade_price, contract.best_buy_yes_cost, contract.last_close_price):
        if isinstance(value, (int, float)) and 0.0 <= float(value) <= 1.0:
            return float(value)
    return None


def _contract_end_date(contract: PredictItContractPayload) -> datetime | None:
    raw = (contract.date_end or "").strip()
    if not raw or raw.upper() == "NA":
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def normalize_predictit_market(payload: PredictItMarketPayload) -> NormalizedPredictionMarket | None:
    """Normalize one PredictIt market into the source-agnostic shape.

    PredictIt returns a list of binary contracts under each market; we
    collapse that into a single ``outcomes=["Yes", "No"]`` row whose
    ``outcome_prices[0]`` is the unweighted mean of the priced contracts'
    traded probabilities. A market is ``active`` while at least one of its
    contracts is still open, and its ``end_date`` is the latest contract
    end date the feed publishes (``"NA"`` means unknown). Markets without
    any priced contract are dropped.
    """
    priced = [
        (contract, probability)
        for contract in payload.contracts
        if (probability := _contract_probability(contract)) is not None
    ]
    if not priced:
        return None
    yes_price = sum(probability for _, probability in priced) / len(priced)
    end_dates = [
        end_date
        for contract, _ in priced
        if (end_date := _contract_end_date(contract)) is not None
    ]
    active = any((contract.status or "").strip().lower() == "open" for contract, _ in priced)
    derived_topics = canonical_topics(payload.name)
    extra = {"canonical_topics": derived_topics} if derived_topics else None
    return NormalizedPredictionMarket(
        source="predictit",
        source_id=str(payload.id),
        question=payload.name,
        slug=payload.short_name,
        description=None,
        category=category_taxonomy(None),
        url=_predictit_url(payload),
        end_date=max(end_dates) if end_dates else None,
        active=active,
        closed=not active,
        volume=None,
        liquidity=None,
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, max(1.0 - yes_price, 0.0)),
        extra=extra,
    )


async def fetch_predictit_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[PredictItMarketPayload]:
    """Fetch the official PredictIt market-data feed via the resilient fetcher.

    The feed publishes every market in one document and accepts no query
    parameters, so ``limit`` only bounds how many parsed rows are kept.
    """
    body = await fetch_json_with_retry(
        client, source="predictit", url=PREDICTIT_MARKETDATA_PATH,
    )
    if isinstance(body, dict) and isinstance(body.get("markets"), list):
        raw_rows = body["markets"]
    elif isinstance(body, list):
        raw_rows = body
    else:
        raise PredictionMarketFetchError(
            "predictit", None, "unexpected response envelope: expected a 'markets' list",
        )
    rows = _PREDICTIT_MARKETS.validate_python(raw_rows[:bounded_market_limit(limit)])
    return rows[:MAX_INGEST_MARKETS]


async def ingest_predictit_markets(
    session,
    client: httpx.AsyncClient,
    limit: int = PREDICTIT_DEFAULT_LIMIT,
) -> int:
    """Fetch, normalize, and upsert PredictIt markets into the DB.

    The feed also publishes fully closed markets; those normalise to
    ``active=False`` and are filtered out here (like the Kalshi adapter)
    so the catalogue admission gate only ever sees live markets.
    """
    payloads = await fetch_predictit_markets(client, limit)
    values = [market.to_values() for payload in payloads
              if (market := normalize_predictit_market(payload)) is not None and market.active]
    return await persist_prediction_markets(session, values)


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
