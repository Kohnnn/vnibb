"""Polymarket Gamma ingestion and prediction market persistence."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Final, TypedDict

import httpx
from pydantic import BaseModel, ConfigDict, Field, Json, TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.prediction_market import PredictionMarket
from vnibb.services.prediction_market_policy import (
    MAX_CATALOGUE_RELATION_BYTES,
    MAX_INGEST_MARKETS,
    MAX_MARKET_EXTRA_BYTES,
    MAX_MARKET_OUTCOMES,
    MAX_MARKET_PAYLOAD_BYTES,
    MAX_MARKET_TEXT_BYTES,
    MAX_SOURCE_MARKETS,
    is_kalshi_combo,
)

logger = logging.getLogger(__name__)


class PredictionMarketAdmissionError(RuntimeError):
    """A provider batch cannot safely be admitted to the catalogue."""


def bounded_market_limit(limit: int) -> int:
    if limit < 1:
        raise ValueError("prediction market fetch limit must be positive")
    return min(limit, MAX_INGEST_MARKETS)


def _valid_market_size(values: PredictionMarketValues) -> bool:
    outcomes = values.get("outcomes", [])
    prices = values.get("outcome_prices", [])
    return (
        all(len(str(values.get(field) or "").encode("utf-8")) <= MAX_MARKET_TEXT_BYTES
            for field in ("source_id", "question", "slug", "description", "category", "url"))
        and len(values.get("source_id", "")) <= 128
        and len(values.get("slug") or "") <= 255
        and len(values.get("category") or "") <= 100
        and len(outcomes) <= MAX_MARKET_OUTCOMES
        and len(prices) <= MAX_MARKET_OUTCOMES
        and len(json.dumps(outcomes).encode("utf-8")) <= MAX_MARKET_TEXT_BYTES
        and len(json.dumps(prices).encode("utf-8")) <= MAX_MARKET_TEXT_BYTES
        and len(json.dumps(values.get("extra", {})).encode("utf-8")) <= MAX_MARKET_EXTRA_BYTES
    )


def _is_live_market(values: PredictionMarketValues, now: datetime) -> bool:
    end_date = values.get("end_date")
    if end_date is not None:
        end_date = end_date.replace(tzinfo=UTC) if end_date.tzinfo is None else end_date.astimezone(UTC)
    return values.get("active") is True and values.get("closed") is False and (end_date is None or end_date > now)

async def _catalogue_storage_bytes(session: AsyncSession, dialect_name: str) -> int:
    if dialect_name == "postgresql":
        return (await session.execute(
            text("SELECT pg_total_relation_size('prediction_markets'::regclass)")
        )).scalar_one()
    pages = (await session.execute(text("PRAGMA page_count"))).scalar_one()
    page_size = (await session.execute(text("PRAGMA page_size"))).scalar_one()
    return pages * page_size


async def persist_prediction_markets(session: AsyncSession, values: list[PredictionMarketValues]) -> int:
    """Refresh real IDs and admit bounded new IDs while storage has headroom.

    PostgreSQL preflight serializes all ingests and reserves at least 256 KiB
    of relation growth per mutation, including MVCC churn and index writes.
    A full relation refuses every mutation; a full source still refreshes IDs.
    """
    if len(values) > MAX_INGEST_MARKETS:
        raise PredictionMarketAdmissionError("prediction market ingest batch exceeds limit")
    if not values:
        return 0
    values = list({(row["source"], row["source_id"]): row for row in values}.values())
    dialect_name = session.get_bind().dialect.name
    if dialect_name not in {"postgresql", "sqlite"}:
        raise UnsupportedPredictionMarketDialectError(dialect_name)
    for row in values:
        if row["source"] == "kalshi" and is_kalshi_combo(row["source_id"], row.get("slug")):
            raise PredictionMarketAdmissionError(f"Kalshi combo market {row['source_id']} is not admissible")
        if not _valid_market_size(row):
            raise PredictionMarketAdmissionError(f"{row.get('source')} market {row.get('source_id')} exceeds field size limit")
    try:
        if dialect_name == "postgresql":
            await session.execute(text("SELECT pg_advisory_xact_lock(943416618)"))
        else:
            try:
                await session.execute(text("BEGIN IMMEDIATE"))
            except OperationalError as exc:
                if "cannot start a transaction within a transaction" not in str(exc):
                    raise
                # Preserve the caller's transaction while taking its writer lock.
                await session.execute(text("UPDATE prediction_markets SET id=id WHERE id=-1"))
        relation_bytes = await _catalogue_storage_bytes(session, dialect_name)
        reserve = len(values) * 256 * 1024
        if relation_bytes + reserve > MAX_CATALOGUE_RELATION_BYTES:
            raise PredictionMarketAdmissionError(
                f"Catalogue storage ceiling: relation {relation_bytes} bytes plus {reserve} byte reserve "
                f"exceeds {MAX_CATALOGUE_RELATION_BYTES}; no markets mutated"
            )

        by_source: dict[str, set[str]] = {}
        for row in values:
            by_source.setdefault(row["source"], set()).add(row["source_id"])
        existing: set[tuple[str, str]] = set()
        for source, ids in by_source.items():
            matches = await session.execute(
                select(PredictionMarket.source_id).where(
                    PredictionMarket.source == source, PredictionMarket.source_id.in_(ids)
                )
            )
            existing.update((source, source_id) for source_id in matches.scalars())

        now = datetime.now(UTC)
        new_rows = [
            row for row in values
            if (row["source"], row["source_id"]) not in existing
            and _is_live_market(row, now)
        ]

        available: dict[str, int] = {}
        for source in {row["source"] for row in new_rows}:
            source_rows = await session.execute(
                select(PredictionMarket.id).where(
                    PredictionMarket.source == source,
                    text("(source <> 'kalshi' OR source_id NOT LIKE 'KXMV%')")
                ).limit(MAX_SOURCE_MARKETS + 1)
            )
            available[source] = max(0, MAX_SOURCE_MARKETS - len(source_rows.scalars().all()))

        admitted: set[tuple[str, str]] = set()
        for row in new_rows:
            source, source_id = row["source"], row["source_id"]
            if (source, source_id) not in admitted and available.get(source, 0) > 0:
                admitted.add((source, source_id))
                available[source] -= 1
        accepted = [row for row in values if (row["source"], row["source_id"]) in existing | admitted]
        rejected = len(values) - len(accepted)
        for row in accepted:
            await session.execute(_upsert_prediction_market(row, dialect_name))
        await session.commit()
        if rejected:
            raise PredictionMarketAdmissionError(
                f"Catalogue admission blocked for {rejected} new markets (storage/source cap); refreshed {len(accepted)} existing markets"
            )
        return len(accepted)
    except BaseException:
        await session.rollback()
        raise

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


class PredictionMarketValues(TypedDict, total=False):
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
    extra: dict
    updated_at: datetime
    is_synthetic: bool


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
    extra: dict = field(default_factory=dict)

    def to_values(self) -> PredictionMarketValues:
        values: PredictionMarketValues = {
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


class UnsupportedPredictionMarketDialectError(RuntimeError):
    """Raised when prediction market upsert has no SQL dialect implementation."""

    def __init__(self, dialect_name: str) -> None:
        self.dialect_name = dialect_name
        super().__init__(f"Unsupported prediction market SQL dialect: {dialect_name}")


_GAMMA_MARKETS = TypeAdapter(list[GammaMarketPayload])


#: Loose keywords that flag a prediction market as politics-shaped regardless
#: of how the upstream tagged the canonical ``category``. Used by the
#: ``ElectionOddsWidget`` to surface mis-tagged political markets.
ELECTION_TEXT_KEYWORDS: tuple[str, ...] = (
    "trump",
    "biden",
    "harris",
    "newsom",
    "desantis",
    "vance",
    "democrat",
    "republican",
    "election",
    "presidential",
    "white house",
    "senate",
    "congress",
    "house of representatives",
    "impeach",
    "2028",
    "2026 midterm",
    "primary",
    "nominee",
    "governor",
    "GOP",
    "DNC",
    "RNC",
    "Pence",
    "Obama",
    "Clinton",
    "DeSantis",
)


def canonical_topics(question: str, category: str | None = None) -> list[str]:
    """Derive a list of canonical topics from a market's question + category.

    Used by ``extra.canonical_topics`` so widgets can filter on
    semantics (politics / macro / sports / election) without trusting the
    upstream's freeform ``category``.
    """
    haystack = (question or "").lower()
    if category:
        haystack = f"{haystack} {category.lower()}"
    topics: list[str] = []
    if any(marker in haystack for marker in ELECTION_TEXT_KEYWORDS):
        topics.append("election")
    if any(marker in haystack for marker in ("cpi", "inflation", "fed", "fomc", "recession", "rate", "macro")):
        topics.append("macro")
    if any(marker in haystack for marker in ("world cup", "fifa", "nba", "nfl", "mlb", "tennis", "olymp")):
        topics.append("sports")
    if any(marker in haystack for marker in ("btc", "bitcoin", "eth", "ethereum", "crypto", "stablecoin")):
        topics.append("crypto")
    return topics


def normalize_gamma_market(payload: GammaMarketPayload) -> NormalizedPredictionMarket:
    """Normalize one Gamma market payload into the source-agnostic DB shape.

    The freeform `category` is mapped through `category_taxonomy` to keep the
    values queryable by the read endpoint. Note that the raw original
    category is intentionally NOT retained here — callers (ingestion code,
    tests) verify against the canonical taxonomy because the Gamma upstream
    string is volatile and not a contract.
    """
    question = payload.question
    canonical_category = category_taxonomy(payload.category)
    derived_topics = canonical_topics(question, payload.category)
    extra: dict[str, Any] = {}
    if payload.category:
        extra["raw_category"] = payload.category
    if derived_topics:
        extra["canonical_topics"] = derived_topics
    return NormalizedPredictionMarket(
        source="polymarket",
        source_id=str(payload.id),
        question=question,
        slug=payload.slug,
        description=payload.description,
        category=canonical_category,
        url=payload.url,
        end_date=payload.end_date,
        active=payload.active,
        closed=payload.closed,
        volume=payload.volume,
        liquidity=payload.liquidity,
        outcomes=tuple(payload.outcomes),
        outcome_prices=tuple(payload.outcome_prices),
        extra=extra or None,
    )


async def fetch_polymarket_gamma_markets(
    client: httpx.AsyncClient,
    limit: int,
) -> list[GammaMarketPayload]:
    """Fetch a bounded active Gamma market page from Polymarket."""
    response = await client.get(
        "/markets",
        params={"active": "true", "closed": "false", "limit": bounded_market_limit(limit)},
    )
    response.raise_for_status()
    if len(response.content) > MAX_MARKET_PAYLOAD_BYTES:
        raise PredictionMarketAdmissionError("Polymarket response exceeds ingest byte limit")
    return _GAMMA_MARKETS.validate_json(response.content)[:MAX_INGEST_MARKETS]


async def ingest_polymarket_gamma_markets(
    session: AsyncSession,
    client: httpx.AsyncClient,
    limit: int = 100,
) -> int:
    """Fetch, normalize, and upsert Polymarket Gamma markets into the DB."""
    payloads = await fetch_polymarket_gamma_markets(client, limit)
    return await persist_prediction_markets(
        session,
        [normalize_gamma_market(payload).to_values() for payload in payloads],
    )


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
            # Provenance must be authoritative in both directions: a live sync
            # overwriting a fixture row has to clear the flag, and a fixture
            # fallback must set it.
            "is_synthetic": stmt.excluded.is_synthetic,
            "extra": stmt.excluded.extra,
            "updated_at": stmt.excluded.updated_at,
        },
    )
