"""Prediction market read endpoints (Phase 7 expansion).

The router grew during the prediction-markets expansion:
* `GET /prediction-markets` — existing list endpoint, with the new
  case-insensitive `category` alias.
* `GET /prediction-markets/movers` — top markets ranked by absolute
  movement in YES probability between the latest snapshot and the
  historical snapshot `window_hours` ago.
* `GET /prediction-markets/calibration` — markets matching a maintained
  topic (cpi | fed | recession) with their consensus probability.
* `GET /prediction-markets/estimate/{cpi,fed,recession,macro}` — odds-to-
  estimate computations, cached at 600s.

The movers endpoint deliberately tolerates the snapshot table being empty
(endpoints return an empty list rather than 500) so deployments without the
nightly job still render a meaningful empty state in the widget.
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, func, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_snapshot import PredictionMarketSnapshot
from vnibb.services.prediction_market_estimator import (
    estimate_cpi,
    estimate_fed,
    estimate_macro_composite,
    estimate_recession,
)

router = APIRouter()


class PredictionMarketRead(BaseModel):
    """Prediction market response row."""

    model_config = ConfigDict(from_attributes=True, frozen=True)

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


class PredictionMarketsResponse(BaseModel):
    """Prediction market list response."""

    model_config = ConfigDict(frozen=True)

    count: int
    data: list[PredictionMarketRead]


class PredictionMarketMoverRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    source: str
    source_id: str
    question: str
    category: str | None
    url: str | None
    yes_price: float
    previous_yes_price: float
    absolute_movement: float


class PredictionMarketMoversResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    window_hours: int
    count: int
    movers: list[PredictionMarketMoverRow]


class PredictionMarketCalibrationResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    topic: str
    consensus_yes_price: float | None
    n_markets: int
    last_updated: datetime | None
    markets: list[PredictionMarketRead]


@router.get("", response_model=PredictionMarketsResponse)
async def list_prediction_markets(
    source: str | None = Query(default=None, pattern=r"^[a-z][a-z0-9_-]{1,31}$"),
    active: bool | None = Query(default=None),
    # Category alias mapping. Frontend widgets send friendly names; we map
    # Gamma/Kalshi freeform categories into canonical buckets.
    category: str | None = Query(default=None, pattern=r"^[a-z][a-z0-9_-]{1,31}$"),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketsResponse:
    """Return persisted prediction markets from the database."""
    stmt = select(PredictionMarket).order_by(
        PredictionMarket.end_date.is_(None),
        PredictionMarket.end_date.asc(),
        PredictionMarket.id.asc(),
    )
    if source is not None:
        stmt = stmt.where(PredictionMarket.source == source)
    if active is not None:
        stmt = stmt.where(PredictionMarket.active.is_(active))
    if category is not None:
        # Friendly alias. The DB stores categories verbatim; comparison is
        # case-insensitive so users can pass "Economic" or "economic".
        stmt = stmt.where(PredictionMarket.category.ilike(category))
    try:
        result = await db.execute(stmt.limit(limit))
    except (OperationalError, ProgrammingError) as error:
        message = str(error.orig).lower()
        if "prediction_markets" in message and (
            "no such table" in message or "does not exist" in message
        ):
            return PredictionMarketsResponse(count=0, data=[])
        raise
    rows = result.scalars().all()
    data = [PredictionMarketRead.model_validate(row) for row in rows]
    return PredictionMarketsResponse(count=len(data), data=data)


@router.get("/movers", response_model=PredictionMarketMoversResponse)
async def list_prediction_market_movers(
    window: int = Query(default=24, ge=1, le=720),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketMoversResponse:
    """Return the markets with the largest absolute YES probability movement.

    The endpoint diffs the latest snapshot against the oldest snapshot
    captured at least `window` hours ago. When the snapshot table is empty
    (e.g. the nightly job hasn't run yet), the endpoint returns an empty
    list so the widget renders its empty state instead of 500ing.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=window)

    latest_stmt = (
        select(
            PredictionMarketSnapshot.source,
            PredictionMarketSnapshot.source_id,
            func.max(PredictionMarketSnapshot.captured_at).label("captured_at"),
        )
        .group_by(PredictionMarketSnapshot.source, PredictionMarketSnapshot.source_id)
        .subquery()
    )

    try:
        latest_rows = (
            await db.execute(
                select(PredictionMarketSnapshot)
                .join(
                    latest_stmt,
                    (latest_stmt.c.source == PredictionMarketSnapshot.source)
                    & (latest_stmt.c.source_id == PredictionMarketSnapshot.source_id)
                    & (latest_stmt.c.captured_at == PredictionMarketSnapshot.captured_at),
                )
                .where(PredictionMarketSnapshot.captured_at >= cutoff)
            )
        ).scalars().all()
        baseline_rows = (
            await db.execute(
                select(PredictionMarketSnapshot)
                .join(
                    latest_stmt,
                    (latest_stmt.c.source == PredictionMarketSnapshot.source)
                    & (latest_stmt.c.source_id == PredictionMarketSnapshot.source_id),
                )
                .where(PredictionMarketSnapshot.captured_at <= cutoff)
                .order_by(PredictionMarketSnapshot.captured_at.desc())
            )
        ).scalars().all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketMoversResponse(window_hours=window, count=0, movers=[])

    by_pair: dict[tuple[str, str], tuple[PredictionMarketSnapshot, PredictionMarketSnapshot | None]] = {}
    for row in latest_rows:
        by_pair[(row.source, row.source_id)] = (row, None)
    for row in baseline_rows:
        if (row.source, row.source_id) in by_pair:
            pair = by_pair[(row.source, row.source_id)]
            by_pair[(row.source, row.source_id)] = (pair[0], row)

    movers: list[PredictionMarketMoverRow] = []
    for (_source, _source_id), (latest, baseline) in by_pair.items():
        if baseline is None:
            continue
        delta = latest.yes_price - baseline.yes_price
        movers.append(
            PredictionMarketMoverRow(
                source=latest.source,
                source_id=latest.source_id,
                question=latest.question,
                category=latest.category,
                url=latest.url,
                yes_price=latest.yes_price,
                previous_yes_price=baseline.yes_price,
                absolute_movement=delta,
            )
        )

    movers.sort(key=lambda row: abs(row.absolute_movement), reverse=True)
    movers = movers[:limit]
    return PredictionMarketMoversResponse(
        window_hours=window,
        count=len(movers),
        movers=movers,
    )


@router.get("/calibration", response_model=PredictionMarketCalibrationResponse)
async def list_prediction_market_calibration(
    topic: Literal["cpi", "fed", "recession"] = Query(default="cpi"),
    limit: int = Query(default=25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketCalibrationResponse:
    """List markets tagged for a maintained topic and the consensus YES price.

    The current implementation uses simple substring matching across the
    canonical taxonomy tags. Phase 7.5 will replace this with the
    estimator-backed result; the endpoint is here so the Macro Calibration
    widget can fetch the same payload both through /calibration (raw
    markets) and /estimate/{topic} (curated odds-to-estimate output).
    """
    keywords = {
        "cpi": ("cpi", "inflation", "core cpi", "headline"),
        "fed": ("fed", "fomc", "rate cut", "rate hike", "powell", "federal reserve"),
        "recession": ("recession", "us recession", "global recession"),
    }
    markers = keywords[topic]
    stmt = select(PredictionMarket).where(PredictionMarket.active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    matching: list[PredictionMarket] = []
    for market in rows:
        haystack = f"{market.question} {market.description or ''} {market.slug or ''}".lower()
        if any(marker in haystack for marker in markers):
            matching.append(market)
    matching = matching[:limit]
    prices = [
        market.outcome_prices[0]
        for market in matching
        if isinstance(market.outcome_prices, list)
        and len(market.outcome_prices) > 0
        and isinstance(market.outcome_prices[0], (int, float))
    ]
    consensus = sum(prices) / len(prices) if prices else None
    return PredictionMarketCalibrationResponse(
        topic=topic,
        consensus_yes_price=consensus,
        n_markets=len(matching),
        last_updated=matching[0].updated_at if matching else None,
        markets=[PredictionMarketRead.model_validate(market) for market in matching],
    )


@router.get("/estimate/cpi")
async def estimate_cpi_endpoint(db: AsyncSession = Depends(get_db)) -> dict:
    return await estimate_cpi(db)


@router.get("/estimate/fed")
async def estimate_fed_endpoint(db: AsyncSession = Depends(get_db)) -> dict:
    return await estimate_fed(db)


@router.get("/estimate/recession")
async def estimate_recession_endpoint(db: AsyncSession = Depends(get_db)) -> dict:
    return await estimate_recession(db)


@router.get("/estimate/macro")
async def estimate_macro_endpoint(db: AsyncSession = Depends(get_db)) -> dict:
    return await estimate_macro_composite(db)
