"""Explicit offline fixture seeding; never a production provider fallback."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.services.prediction_market_service import (
    NormalizedPredictionMarket,
    PredictionMarketValues,
    category_taxonomy,
    persist_prediction_markets,
)
from vnibb.services.prediction_market_policy import MAX_INGEST_MARKETS, MAX_MARKET_PAYLOAD_BYTES

logger = logging.getLogger(__name__)


SEED_FIXTURE_DIR: Final = Path(__file__).parent / "seed_fixtures"


def _coerce_to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and 0 <= value <= 1:
        return float(value)
    return None


def _normalise_predictit_row(row: dict[str, Any]) -> NormalizedPredictionMarket | None:
    contracts = row.get("contracts") or []
    priced: list[float] = []
    for contract in contracts:
        price = _coerce_to_float(contract.get("LatestYesPrice"))
        if price is not None:
            priced.append(price)
    if not priced:
        return None
    yes_price = sum(priced) / len(priced)
    return NormalizedPredictionMarket(
        source="predictit",
        source_id=str(row["id"]),
        question=row["name"],
        slug=row.get("shortName"),
        description=row.get("subCategory"),
        category=category_taxonomy(row.get("category")),
        url=row.get("url"),
        end_date=None,
        active=True,
        closed=False,
        volume=None,
        liquidity=None,
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, max(1.0 - yes_price, 0.0)),
    )


def _normalise_limitless_row(row: dict[str, Any]) -> NormalizedPredictionMarket | None:
    prices = row.get("prices") or {}
    yes_price = _coerce_to_float(prices.get("yes"))
    if yes_price is None:
        return None
    no_price = _coerce_to_float(prices.get("no"))
    if no_price is None:
        no_price = max(1.0 - yes_price, 0.0)
    return NormalizedPredictionMarket(
        source="limitless",
        source_id=str(row["id"]),
        question=row["title"],
        slug=row.get("slug"),
        description=row.get("description"),
        category=category_taxonomy(row.get("category")),
        url=row.get("url"),
        end_date=None,
        active=True,
        closed=False,
        volume=row.get("volume"),
        liquidity=row.get("liquidity"),
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, no_price),
    )


def _normalise_manifold_row(row: dict[str, Any]) -> NormalizedPredictionMarket | None:
    if row.get("isResolved"):
        return None
    yes_price = _coerce_to_float(row.get("probability"))
    if yes_price is None:
        return None
    return NormalizedPredictionMarket(
        source="manifold",
        source_id=str(row["id"]),
        question=row["question"],
        slug=row.get("slug"),
        description=row.get("description"),
        category=category_taxonomy(row.get("category")),
        url=row.get("url"),
        end_date=None,
        active=True,
        closed=False,
        volume=row.get("volume"),
        liquidity=row.get("liquidity"),
        outcomes=("Yes", "No"),
        outcome_prices=(yes_price, max(1.0 - yes_price, 0.0)),
    )


async def _seed_from_fixture(
    session: AsyncSession,
    fixture_name: str,
    normaliser,
    *,
    path: str | None = None,
) -> int:
    fixture = Path(path) if path else SEED_FIXTURE_DIR / fixture_name
    if not fixture.exists():
        logger.warning("Seed fixture %s absent; skipping", fixture)
        return 0
    if fixture.stat().st_size > MAX_MARKET_PAYLOAD_BYTES:
        raise ValueError(f"Seed fixture {fixture} exceeds ingest byte limit")
    try:
        payload = json.loads(fixture.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        logger.warning("Seed fixture %s is not valid JSON: %s", fixture, exc)
        return 0
    if not isinstance(payload, list):
        logger.warning("Seed fixture %s top-level must be a list", fixture)
        return 0
    values: list[PredictionMarketValues] = []
    for row in payload[:MAX_INGEST_MARKETS]:
        if not isinstance(row, dict):
            continue
        market = normaliser(row)
        if market is None:
            continue
        value = market.to_values()
        value["is_synthetic"] = True
        values.append(value)
    count = await persist_prediction_markets(session, values)
    logger.info("Seeded %d synthetic markets from %s", count, fixture)
    return count


async def seed_predictit_from_fixture(session: AsyncSession, *, path: str | None = None) -> int:
    """Import explicitly requested offline PredictIt fixture data."""
    return await _seed_from_fixture(session, "predictit_markets.json", _normalise_predictit_row, path=path)


async def seed_limitless_from_fixture(session: AsyncSession, *, path: str | None = None) -> int:
    """Import explicitly requested offline Limitless fixture data."""
    return await _seed_from_fixture(session, "limitless_markets.json", _normalise_limitless_row, path=path)


async def seed_manifold_from_fixture(session: AsyncSession, *, path: str | None = None) -> int:
    """Import explicitly requested offline Manifold fixture data."""
    return await _seed_from_fixture(session, "manifold_markets.json", _normalise_manifold_row, path=path)