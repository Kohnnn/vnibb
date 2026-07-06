"""Offline seed path for prediction-market ingest.

The public PredictIt, Limitless, and Manifold APIs are occasionally
unreachable from the OCI host (rate-limited, captive-portal redirects,
gRPC weirdness). When that happens, ``ingest_*_with_default_client``
already raises so the scheduler's per-source ``try/except`` keeps the
rest of the pipeline alive. But the read endpoints then return empty
lists and the widgets render "no markets available".

This module closes that gap by upserting rows from a checked-in JSON
snapshot. The fixtures are committed under
``apps/api/vnibb/services/seed_fixtures/{predictit,limitless,manifold}_markets.json``
and refreshed periodically. Each ``seed_*_from_json`` call is idempotent
(re-uses the same upsert key as the live ingestion).
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.services.prediction_market_service import (
    NormalizedPredictionMarket,
    PredictionMarketValues,
    _upsert_prediction_market,
    category_taxonomy,
)

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
    allow_empty_fixture: bool = True,
) -> int:
    path = SEED_FIXTURE_DIR / fixture_name
    if not path.exists():
        if allow_empty_fixture:
            logger.info("Seed fixture %s absent; skipping", path)
            return 0
        raise FileNotFoundError(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        logger.warning("Seed fixture %s is not valid JSON: %s", path, exc)
        return 0
    if not isinstance(payload, list):
        logger.warning("Seed fixture %s top-level must be a list", path)
        return 0

    dialect_name = session.get_bind().dialect.name
    count = 0
    for row in payload:
        if not isinstance(row, dict):
            continue
        market = normaliser(row)
        if market is None:
            continue
        values: PredictionMarketValues = market.to_values()
        await session.execute(_upsert_prediction_market(values, dialect_name))
        count += 1
    await session.commit()
    logger.info("Seeded %d markets from %s", count, path)
    return count


async def seed_predictit_from_fixture(session: AsyncSession, *, path: str | None = None) -> int:
    """Upsert PredictIt markets from a checked-in JSON fixture."""
    if path:
        # Honor an explicit override (used by ad-hoc seed scripts).
        original = SEED_FIXTURE_DIR / "predictit_markets.json"
        os.environ.setdefault("PREDICTIT_SEED_PATH_OVERRIDE", path)
        try:
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
        except FileNotFoundError:
            logger.warning("Explicit PredictIt seed path %s missing", path)
            return 0
        count = 0
        dialect_name = session.get_bind().dialect.name
        for row in payload if isinstance(payload, list) else []:
            market = _normalise_predictit_row(row)
            if market is None:
                continue
            await session.execute(
                _upsert_prediction_market(market.to_values(), dialect_name)
            )
            count += 1
        await session.commit()
        logger.info("Seeded %d PredictIt markets from %s", count, path)
        return count
    return await _seed_from_fixture(
        session, "predictit_markets.json", _normalise_predictit_row
    )


async def seed_limitless_from_fixture(session: AsyncSession, *, path: str | None = None) -> int:
    """Upsert Limitless markets from a checked-in JSON fixture."""
    if path:
        try:
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
        except FileNotFoundError:
            logger.warning("Explicit Limitless seed path %s missing", path)
            return 0
        count = 0
        dialect_name = session.get_bind().dialect.name
        for row in payload if isinstance(payload, list) else []:
            market = _normalise_limitless_row(row)
            if market is None:
                continue
            await session.execute(
                _upsert_prediction_market(market.to_values(), dialect_name)
            )
            count += 1
        await session.commit()
        logger.info("Seeded %d Limitless markets from %s", count, path)
        return count
    return await _seed_from_fixture(
        session, "limitless_markets.json", _normalise_limitless_row
    )


async def seed_manifold_from_fixture(session: AsyncSession, *, path: str | None = None) -> int:
    """Upsert Manifold markets from a checked-in JSON fixture."""
    if path:
        try:
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
        except FileNotFoundError:
            logger.warning("Explicit Manifold seed path %s missing", path)
            return 0
        count = 0
        dialect_name = session.get_bind().dialect.name
        for row in payload if isinstance(payload, list) else []:
            market = _normalise_manifold_row(row)
            if market is None:
                continue
            await session.execute(
                _upsert_prediction_market(market.to_values(), dialect_name)
            )
            count += 1
        await session.commit()
        logger.info("Seeded %d Manifold markets from %s", count, path)
        return count
    return await _seed_from_fixture(
        session, "manifold_markets.json", _normalise_manifold_row
    )