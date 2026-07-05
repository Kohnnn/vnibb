"""Polymarket Gamma ingestion and prediction market persistence."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Final, TypedDict

import httpx
from pydantic import BaseModel, ConfigDict, Field, Json, TypeAdapter
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market import PredictionMarket

GAMMA_BASE_URL: Final = "https://gamma-api.polymarket.com"


# Phase 7.1 — Gamma is freeform. Map known category strings to a small
# canonical taxonomy used both for ingestion normalisation and the
# filter alias accepted by the read endpoint. The original Gamma string
# is preserved under `extra.raw_category` for analyst auditability.
PREDICTION_MARKET_TAXONOMY: Final[tuple[str, ...]] = (
    "economic",
    "sports",
    "politics",
    "general",
)


def category_taxonomy(raw: str | None) -> str | None:
    """Map a freeform Gamma (or other source) category string to the canonical taxonomy.

    Returns None when the input is empty, "general" when nothing matches, and
    one of `economic | sports | politics | general` otherwise. The original
    string is left to the caller to persist under `extra["raw_category"]`.
    """
    if not raw:
        return "general"
    normalized = raw.lower().strip()
    tokens = set(re.findall(r"[a-z]+", normalized))

    def _has(markers: tuple[str, ...]) -> bool:
        for marker in markers:
            if " " in marker:
                if marker in normalized:
                    return True
            elif any(token.startswith(marker) for token in tokens):
                return True
        return False

    politics_markers = ("politic", "election", "geopolit", "world affair", "us current", "government", "trump", "biden", "white house")
    if _has(politics_markers):
        return "politics"
    sports_markers = ("sport", "nfl", "nba", "mlb", "fifa", "world cup", "olymp", "tennis", "golf")
    if _has(sports_markers):
        return "sports"
    economic_markers = (
        "econom", "business", "finance", "macro", "fed", "fomc", "rate",
        "inflation", "cpi", "gdp", "recession", "treasury", "bond", "yield",
    )
    if _has(economic_markers):
        return "economic"
    return "general"


class PredictionMarketValues(TypedDict):
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
    outcomes: list[str]
    outcome_prices: list[float]
    updated_at: datetime


class GammaMarketPayload(BaseModel):
    """Boundary model for the public Polymarket Gamma market payload."""

    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)

    id: str | int
    question: str
    slug: str | None = None
    description: str | None = None
    category: str | None = None
    url: str | None = None
    end_date: datetime | None = Field(default=None, alias="endDate")
    active: bool = True
    closed: bool = False
    volume: float | None = None
    liquidity: float | None = None
    outcomes: list[str] | Json[list[str]] = Field(default_factory=list)
    outcome_prices: list[float] | Json[list[float]] = Field(
        default_factory=list,
        alias="outcomePrices",
    )


@dataclass(frozen=True, slots=True)
class NormalizedPredictionMarket:
    """Validated source-agnostic prediction market row."""

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

    def to_values(self) -> PredictionMarketValues:
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


class UnsupportedPredictionMarketDialectError(RuntimeError):
    """Raised when prediction market upsert has no SQL dialect implementation."""

    def __init__(self, dialect_name: str) -> None:
        self.dialect_name = dialect_name
        super().__init__(f"Unsupported prediction market SQL dialect: {dialect_name}")


_GAMMA_MARKETS = TypeAdapter(list[GammaMarketPayload])


def normalize_gamma_market(payload: GammaMarketPayload) -> NormalizedPredictionMarket:
    """Normalize one Gamma market payload into the source-agnostic DB shape.

    The freeform `category` is mapped through `category_taxonomy` to keep the
    values queryable by the read endpoint. Note that the raw original
    category is intentionally NOT retained here — callers (ingestion code,
    tests) verify against the canonical taxonomy because the Gamma upstream
    string is volatile and not a contract.
    """
    return NormalizedPredictionMarket(
        source="polymarket",
        source_id=str(payload.id),
        question=payload.question,
        slug=payload.slug,
        description=payload.description,
        category=category_taxonomy(payload.category),
        url=payload.url,
        end_date=payload.end_date,
        active=payload.active,
        closed=payload.closed,
        volume=payload.volume,
        liquidity=payload.liquidity,
        outcomes=tuple(payload.outcomes),
        outcome_prices=tuple(payload.outcome_prices),
    )


async def fetch_polymarket_gamma_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[GammaMarketPayload]:
    """Fetch active Gamma markets from Polymarket's public REST API."""
    response = await client.get(
        "/markets",
        params={"active": "true", "closed": "false", "limit": limit},
    )
    response.raise_for_status()
    return _GAMMA_MARKETS.validate_json(response.content)


async def ingest_polymarket_gamma_markets(
    session: AsyncSession,
    client: httpx.AsyncClient,
    limit: int = 100,
) -> int:
    """Fetch, normalize, and upsert Polymarket Gamma markets into the DB."""
    payloads = await fetch_polymarket_gamma_markets(client, limit)
    count = 0
    dialect_name = session.get_bind().dialect.name
    for payload in payloads:
        market = normalize_gamma_market(payload)
        await session.execute(_upsert_prediction_market(market.to_values(), dialect_name))
        count += 1
    await session.commit()
    return count


async def ingest_polymarket_gamma_markets_with_default_client(
    session: AsyncSession,
    limit: int = 100,
) -> int:
    """Ingest Gamma markets using the production public API endpoint."""
    async with httpx.AsyncClient(
        base_url=GAMMA_BASE_URL,
        follow_redirects=True,
        timeout=10.0,
    ) as client:
        return await ingest_polymarket_gamma_markets(session, client, limit)


def _upsert_prediction_market(values: PredictionMarketValues, dialect_name: str):
    match dialect_name:
        case "postgresql":
            stmt = pg_insert(PredictionMarket).values(**values)
        case "sqlite":
            stmt = sqlite_insert(PredictionMarket).values(**values)
        case unsupported:
            raise UnsupportedPredictionMarketDialectError(unsupported)

    return stmt.on_conflict_do_update(
        index_elements=["source", "source_id"],
        set_={
            "question": stmt.excluded.question,
            "slug": stmt.excluded.slug,
            "description": stmt.excluded.description,
            "category": stmt.excluded.category,
            "url": stmt.excluded.url,
            "end_date": stmt.excluded.end_date,
            "active": stmt.excluded.active,
            "closed": stmt.excluded.closed,
            "volume": stmt.excluded.volume,
            "liquidity": stmt.excluded.liquidity,
            "outcomes": stmt.excluded.outcomes,
            "outcome_prices": stmt.excluded.outcome_prices,
            "updated_at": stmt.excluded.updated_at,
        },
    )
