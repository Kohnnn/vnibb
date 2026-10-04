"""Limitless exchange ingestion.

Documented public REST API at ``https://api.limitless.exchange``
(openapi at ``/api-json``, no auth). Active markets live at
``GET /markets/active`` which paginates with ``page`` + ``limit`` (max
25) and answers ``{"data": [...], "totalMarketsCount": N}``; the bare
``/markets`` path does not exist.

Each row is either a ``single`` market (docs, ``prices`` as
``[yes, no]``) or a ``group`` (a ladder whose tradable outcomes are the
nested ``markets`` children, each with its own ``prices``). CLOB rows
quote decimal probabilities, AMM rows quote cents, so the pair is scaled
by 100 when either side exceeds 1. Only live rows (``status=FUNDED``,
not expired/secret) are ingested; every row keeps its browser URL and
its question text, with group children prefixed by the group title.
"""

from __future__ import annotations

import html
import re
from datetime import datetime
from typing import Final

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from vnibb.services.prediction_market_http import (
    PredictionMarketFetchError,
    fetch_json_with_retry,
)
from vnibb.services.prediction_market_policy import (
    MAX_INGEST_MARKETS,
    MAX_MARKET_TEXT_BYTES,
)
from vnibb.services.prediction_market_service import (
    NormalizedPredictionMarket,
    bounded_market_limit,
    canonical_topics,
    category_taxonomy,
    persist_prediction_markets,
)

LIMITLESS_BASE_URL: Final = "https://api.limitless.exchange"
LIMITLESS_ACTIVE_PATH: Final = "/markets/active"
LIMITLESS_WEB_URL: Final = "https://limitless.exchange"
#: The documented endpoint rejects ``limit`` above 25.
LIMITLESS_PAGE_SIZE: Final = 25
LIMITLESS_MAX_PAGES: Final = MAX_INGEST_MARKETS // LIMITLESS_PAGE_SIZE
LIMITLESS_DEFAULT_LIMIT: Final = 200

_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


class LimitlessMarketPayload(BaseModel):
    """One Limitless market or ladder group, as returned by ``/markets/active``."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: int | str
    title: str
    slug: str | None = None
    stable_slug: str | None = Field(default=None, alias="stableSlug")
    description: str | None = None
    categories: list[str] = Field(default_factory=list)
    expiration: datetime | None = Field(default=None, alias="expirationTimestamp")
    status: str | None = None
    hidden: bool | None = None
    market_type: str | None = Field(default=None, alias="marketType")
    trade_type: str | None = Field(default=None, alias="tradeType")
    volume_formatted: float | None = Field(default=None, alias="volumeFormatted")
    liquidity_formatted: float | None = Field(default=None, alias="liquidityFormatted")
    expired: bool | None = None
    #: ``[yes, no]`` as decimals (CLOB) or cents (AMM); null on ladder groups.
    prices: list[float] | None = None
    markets: list[LimitlessMarketPayload] = Field(default_factory=list)


_LIMITLESS_MARKETS = TypeAdapter(list[LimitlessMarketPayload])


def _plain_text(value: str | None) -> str | None:
    """Flatten the provider's HTML description into storable plain text."""
    if not value:
        return None
    text = _WHITESPACE_RE.sub(" ", html.unescape(_TAG_RE.sub(" ", value))).strip()
    if not text:
        return None
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_MARKET_TEXT_BYTES:
        text = encoded[:MAX_MARKET_TEXT_BYTES].decode("utf-8", errors="ignore")
    return text


def _is_live(payload: LimitlessMarketPayload) -> bool:
    return (
        (payload.status or "").strip().upper() == "FUNDED"
        and payload.expired is not True
        and payload.hidden is not True
    )


def _outcome_prices(payload: LimitlessMarketPayload) -> tuple[float, float] | None:
    """Return the ``(yes, no)`` probabilities, normalising cents to fractions."""
    prices = payload.prices
    if not isinstance(prices, list) or len(prices) != 2:
        return None
    if not all(isinstance(value, (int, float)) for value in prices):
        return None
    trade_type = (payload.trade_type or "").strip().lower()
    scale = (
        100.0
        if trade_type == "amm" or (trade_type != "clob" and max(prices) > 1.0)
        else 1.0
    )
    yes_price = float(prices[0]) / scale
    no_price = float(prices[1]) / scale
    if not (0.0 <= yes_price <= 1.0 and 0.0 <= no_price <= 1.0):
        return None
    return yes_price, no_price


def _market_url(payload: LimitlessMarketPayload) -> str | None:
    slug = payload.slug or payload.stable_slug
    return f"{LIMITLESS_WEB_URL}/markets/{slug}" if slug else None


def normalize_limitless_market(payload: LimitlessMarketPayload) -> NormalizedPredictionMarket | None:
    """Normalize one Limitless single market into the source-agnostic shape.

    Rows that are not live (resolved/expired/secret) and rows without a
    usable ``[yes, no]`` pair are dropped. Ladder groups carry no prices of
    their own and must be flattened first (see ``_flatten_markets``).
    """
    if not _is_live(payload):
        return None
    prices = _outcome_prices(payload)
    if prices is None:
        return None
    yes_price, no_price = prices
    raw_category = next((category for category in payload.categories if category), None)
    derived_topics = canonical_topics(payload.title, raw_category)
    extra: dict[str, object] = {}
    if raw_category:
        extra["raw_category"] = raw_category
    if derived_topics:
        extra["canonical_topics"] = derived_topics
    return NormalizedPredictionMarket(
        source="limitless",
        source_id=str(payload.id),
        question=payload.title,
        slug=payload.slug,
        description=_plain_text(payload.description),
        category=category_taxonomy(raw_category),
        url=_market_url(payload),
        end_date=payload.expiration,
        active=True,
        closed=False,
        volume=payload.volume_formatted,
        liquidity=payload.liquidity_formatted,
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, no_price),
        extra=extra or None,
    )


def _flatten_markets(payload: LimitlessMarketPayload) -> list[LimitlessMarketPayload]:
    """Expand a ladder group into its tradable children (singles pass through).

    Group children repeat the group's question in their own ``title`` only
    as a strike label, so the parent title is prefixed to keep the child
    self-describing.
    """
    if not payload.markets:
        return [payload]
    children: list[LimitlessMarketPayload] = []
    for child in payload.markets:
        children.append(
            child.model_copy(
                update={
                    "title": f"{payload.title} - {child.title}",
                    "categories": child.categories or payload.categories,
                }
            )
        )
    return children


async def fetch_limitless_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[LimitlessMarketPayload]:
    """Fetch live Limitless markets from the documented paginated endpoint.

    ``limit`` bounds how many top-level rows are collected; ladder groups
    are flattened afterwards, so the returned row count can be higher
    (bounded by ``MAX_INGEST_MARKETS``).
    """
    target = bounded_market_limit(limit)
    page = 1
    rows: list[LimitlessMarketPayload] = []
    while page <= LIMITLESS_MAX_PAGES and len(rows) < target:
        body = await fetch_json_with_retry(
            client,
            source="limitless",
            url=LIMITLESS_ACTIVE_PATH,
            params={"limit": LIMITLESS_PAGE_SIZE, "page": page},
        )
        if not isinstance(body, dict) or not isinstance(body.get("data"), list):
            raise PredictionMarketFetchError(
                "limitless", None, "unexpected response envelope: expected a 'data' list",
            )
        page_rows = _LIMITLESS_MARKETS.validate_python(body["data"])
        if not page_rows:
            break
        rows.extend(page_rows)
        if len(page_rows) < LIMITLESS_PAGE_SIZE:
            break
        page += 1
    flattened = [child for payload in rows for child in _flatten_markets(payload)]
    return flattened[:MAX_INGEST_MARKETS]


async def ingest_limitless_markets(
    session,
    client: httpx.AsyncClient,
    limit: int = LIMITLESS_DEFAULT_LIMIT,
) -> int:
    """Fetch, normalize, and upsert Limitless markets into the DB."""
    payloads = await fetch_limitless_markets(client, limit)
    values = [market.to_values() for payload in payloads
              if (market := normalize_limitless_market(payload)) is not None]
    return await persist_prediction_markets(session, values)


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
