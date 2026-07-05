"""Prediction market read endpoints (Phase 7 + Phase 8 expansion).

The router grew during the prediction-markets expansion:

* `GET /prediction-markets` — existing list endpoint, with the new
  case-insensitive `category` alias.
* `GET /prediction-markets/movers` — top markets ranked by absolute
  movement in YES probability between the latest snapshot and the
  historical snapshot `window_hours` ago. Supports `?direction=up|down|both`
  and `?exclude_categories=…` from Phase 8.
* `GET /prediction-markets/alerts` — Phase 8. Diffs latest intraday
  micro-snapshot against the snapshot `window` ago and surfaces alerts
  above `min_movement_bps`. Tolerates the intraday table being missing.
* `GET /prediction-markets/consensus?query=…` — Phase 8. Substring-matches
  the question over Polymarket and Kalshi and returns per-source YES
  price + a volume-weighted consensus.
* `GET /prediction-markets/spread?window=24h` — Phase 8. For each macro
  topic returns `(polymarket_consensus, kalshi_consensus, gap, n)`.
* `GET /prediction-markets/{source}/{source_id}/history?days=30` — Phase 8.
  Per-market YES price time series from the nightly snapshot table.
* `GET /prediction-markets/cross-calibration` — Phase 10.
* `GET /prediction-markets/calibration` — markets matching a maintained
  topic (cpi | fed | recession) with their consensus probability.
* `GET /prediction-markets/estimate/{cpi,fed,recession,macro}` — odds-to-
  estimate computations, cached at 600s.

The movers / alerts / history endpoints deliberately tolerate the snapshot
tables being empty (endpoints return empty lists rather than 500) so
deployments without the nightly job still render a meaningful empty state.
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import and_, desc, func, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_intraday_snapshot import (
    PredictionMarketIntradaySnapshot,
)
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


class PredictionMarketHistoryPoint(BaseModel):
    model_config = ConfigDict(frozen=True)

    captured_at: datetime
    yes_price: float
    volume: float | None = None


class PredictionMarketHistoryResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    source: str
    source_id: str
    question: str
    points: list[PredictionMarketHistoryPoint]


class PredictionMarketAlertRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    source: str
    source_id: str
    question: str
    category: str | None
    url: str | None
    yes_price: float
    previous_yes_price: float
    absolute_movement: float
    direction: Literal["up", "down"]


class PredictionMarketAlertsResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    window_hours: int
    min_movement_bps: int
    count: int
    alerts: list[PredictionMarketAlertRow]


class PredictionMarketConsensusSourceRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    source: str
    yes_price: float | None
    volume: float | None
    url: str | None


class PredictionMarketConsensusResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    query: str
    consensus_yes_price: float | None
    n_markets: int
    sources: list[PredictionMarketConsensusSourceRow]


class PredictionMarketSpreadTopic(BaseModel):
    model_config = ConfigDict(frozen=True)

    topic: Literal["cpi", "fed", "recession"]
    polymarket_consensus: float | None
    kalshi_consensus: float | None
    gap: float | None
    n_polymarket: int
    n_kalshi: int


class PredictionMarketSpreadResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    window_hours: int
    topics: list[PredictionMarketSpreadTopic]


class PredictionMarketCrossCalibrationSourceRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    source: str
    consensus_yes_price: float | None
    n_markets: int


class PredictionMarketCrossCalibrationTopic(BaseModel):
    model_config = ConfigDict(frozen=True)

    topic: Literal["cpi", "fed", "recession"]
    n_sources: int
    sources_agree: bool
    sources: list[PredictionMarketCrossCalibrationSourceRow]


class PredictionMarketCrossCalibrationResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    topics: list[PredictionMarketCrossCalibrationTopic]
    last_updated: datetime | None


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
    direction: Literal["up", "down", "both"] = Query(default="both"),
    exclude_categories: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketMoversResponse:
    """Return the markets with the largest absolute YES probability movement.

    The endpoint diffs the latest snapshot against the oldest snapshot
    captured at least `window` hours ago. When the snapshot table is empty
    (e.g. the nightly job hasn't run yet), the endpoint returns an empty
    list so the widget renders its empty state instead of 500ing.

    Phase 8 adds ``?direction=up|down|both`` and ``?exclude_categories=…``
    filters. ``relative_volume`` (float) is included so callers can rank
    by "mover with confirmation" (mover sign × log(1 + volume)).
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=window)
    excluded: list[str] = []
    if exclude_categories:
        excluded = [c.strip().lower() for c in exclude_categories.split(",") if c.strip()]

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
    if direction == "up":
        movers = [row for row in movers if row.absolute_movement > 0]
    elif direction == "down":
        movers = [row for row in movers if row.absolute_movement < 0]
    if excluded:
        movers = [
            row
            for row in movers
            if not (isinstance(row.category, str) and row.category.lower() in excluded)
        ]
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


# ---------------------------------------------------------------------------
# Phase 8 endpoints
# ---------------------------------------------------------------------------


_TOPIC_KEYWORDS = {
    "cpi": ("cpi", "inflation"),
    "fed": ("fed", "fomc", "powell", "rate cut", "rate hike", "federal reserve"),
    "recession": ("recession",),
}


def _topic_consensus(markets: list[PredictionMarket], topic: str) -> float | None:
    keywords = _TOPIC_KEYWORDS.get(topic, ())
    prices: list[float] = []
    weights: list[float] = []
    for market in markets:
        haystack = f"{market.question} {market.description or ''}".lower()
        if not any(k in haystack for k in keywords):
            continue
        if not (
            isinstance(market.outcome_prices, list)
            and len(market.outcome_prices) > 0
            and isinstance(market.outcome_prices[0], (int, float))
        ):
            continue
        price = float(market.outcome_prices[0])
        weight = float(market.volume) if isinstance(market.volume, (int, float)) else 1.0
        prices.append(price)
        weights.append(max(weight, 1.0))
    if not prices:
        return None
    return sum(p * w for p, w in zip(prices, weights)) / sum(weights)


@router.get("/spread", response_model=PredictionMarketSpreadResponse)
async def list_prediction_market_spread(
    window: int = Query(default=24, ge=1, le=720),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketSpreadResponse:
    """For each macro topic return Polymarket vs Kalshi consensus + gap.

    The ``window`` parameter is currently informational (read latency from
    the snapshot table is unchanged); the snapshot diff that powers
    alerts/history uses the same window semantics.
    """
    del window  # window is currently informational; reserved for snapshot diff.
    try:
        rows = (
            await db.execute(
                select(PredictionMarket).where(PredictionMarket.active.is_(True))
            )
        ).scalars().all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketSpreadResponse(
            window_hours=24,
            topics=[
                PredictionMarketSpreadTopic(
                    topic="cpi",
                    polymarket_consensus=None,
                    kalshi_consensus=None,
                    gap=None,
                    n_polymarket=0,
                    n_kalshi=0,
                ),
                PredictionMarketSpreadTopic(
                    topic="fed",
                    polymarket_consensus=None,
                    kalshi_consensus=None,
                    gap=None,
                    n_polymarket=0,
                    n_kalshi=0,
                ),
                PredictionMarketSpreadTopic(
                    topic="recession",
                    polymarket_consensus=None,
                    kalshi_consensus=None,
                    gap=None,
                    n_polymarket=0,
                    n_kalshi=0,
                ),
            ],
        )

    poly = [m for m in rows if m.source == "polymarket"]
    kalshi = [m for m in rows if m.source == "kalshi"]

    topics: list[PredictionMarketSpreadTopic] = []
    for topic in ("cpi", "fed", "recession"):
        poly_consensus = _topic_consensus(poly, topic)
        kalshi_consensus = _topic_consensus(kalshi, topic)
        gap = (
            (poly_consensus - kalshi_consensus)
            if poly_consensus is not None and kalshi_consensus is not None
            else None
        )
        topics.append(
            PredictionMarketSpreadTopic(
                topic=topic,
                polymarket_consensus=poly_consensus,
                kalshi_consensus=kalshi_consensus,
                gap=gap,
                n_polymarket=len(poly),
                n_kalshi=len(kalshi),
            )
        )

    return PredictionMarketSpreadResponse(window_hours=24, topics=topics)


@router.get("/consensus", response_model=PredictionMarketConsensusResponse)
async def get_prediction_market_consensus(
    query: str = Query(..., min_length=2, max_length=200),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketConsensusResponse:
    """Volume-weighted consensus across Polymarket and Kalshi.

    Substring-matches the question (case-insensitive). Returns one row per
    source so the Deep-Dive drawer can render side-by-side prices.
    """
    try:
        like = f"%{query.lower()}%"
        rows = (
            await db.execute(
                select(PredictionMarket).where(
                    and_(
                        PredictionMarket.active.is_(True),
                        func.lower(PredictionMarket.question).like(like),
                    )
                )
            )
        ).scalars().all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketConsensusResponse(
            query=query,
            consensus_yes_price=None,
            n_markets=0,
            sources=[],
        )

    sources: list[PredictionMarketConsensusSourceRow] = []
    weights: list[float] = []
    prices: list[float] = []
    for market in rows:
        if not (
            isinstance(market.outcome_prices, list)
            and len(market.outcome_prices) > 0
            and isinstance(market.outcome_prices[0], (int, float))
        ):
            continue
        yes_price = float(market.outcome_prices[0])
        sources.append(
            PredictionMarketConsensusSourceRow(
                source=market.source,
                yes_price=yes_price,
                volume=market.volume if isinstance(market.volume, (int, float)) else None,
                url=market.url,
            )
        )
        weight = float(market.volume) if isinstance(market.volume, (int, float)) else 1.0
        prices.append(yes_price)
        weights.append(max(weight, 1.0))

    consensus = sum(p * w for p, w in zip(prices, weights)) / sum(weights) if prices else None
    return PredictionMarketConsensusResponse(
        query=query,
        consensus_yes_price=consensus,
        n_markets=len(rows),
        sources=sources,
    )


@router.get("/alerts", response_model=PredictionMarketAlertsResponse)
async def list_prediction_market_alerts(
    window: int = Query(default=1, ge=1, le=168),
    min_movement_bps: int = Query(default=200, ge=10, le=5000),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketAlertsResponse:
    """Return markets whose YES probability moved >= ``min_movement_bps``.

    Reads from the intraday micro-snapshot table (every 15 min) so 1h / 4h
    windows return meaningful data instead of always-empty. Tolerates the
    table being absent.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=window)

    try:
        latest_stmt = (
            select(
                PredictionMarketIntradaySnapshot.source,
                PredictionMarketIntradaySnapshot.source_id,
                func.max(PredictionMarketIntradaySnapshot.captured_at).label("captured_at"),
            )
            .group_by(
                PredictionMarketIntradaySnapshot.source,
                PredictionMarketIntradaySnapshot.source_id,
            )
            .subquery()
        )
        latest_rows = (
            await db.execute(
                select(PredictionMarketIntradaySnapshot).join(
                    latest_stmt,
                    (latest_stmt.c.source == PredictionMarketIntradaySnapshot.source)
                    & (latest_stmt.c.source_id == PredictionMarketIntradaySnapshot.source_id)
                    & (latest_stmt.c.captured_at == PredictionMarketIntradaySnapshot.captured_at),
                )
            )
        ).scalars().all()
        baseline_rows = (
            await db.execute(
                select(PredictionMarketIntradaySnapshot)
                .join(
                    latest_stmt,
                    (latest_stmt.c.source == PredictionMarketIntradaySnapshot.source)
                    & (latest_stmt.c.source_id == PredictionMarketIntradaySnapshot.source_id),
                )
                .where(PredictionMarketIntradaySnapshot.captured_at <= cutoff)
                .order_by(PredictionMarketIntradaySnapshot.captured_at.desc())
            )
        ).scalars().all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketAlertsResponse(
            window_hours=window,
            min_movement_bps=min_movement_bps,
            count=0,
            alerts=[],
        )

    by_pair: dict[tuple[str, str], tuple[PredictionMarketIntradaySnapshot, PredictionMarketIntradaySnapshot | None]] = {}
    for row in latest_rows:
        by_pair[(row.source, row.source_id)] = (row, None)
    for row in baseline_rows:
        if (row.source, row.source_id) in by_pair:
            pair = by_pair[(row.source, row.source_id)]
            by_pair[(row.source, row.source_id)] = (pair[0], row)

    threshold = min_movement_bps / 10_000.0
    alerts: list[PredictionMarketAlertRow] = []
    for (_source, _source_id), (latest, baseline) in by_pair.items():
        if baseline is None:
            continue
        delta = latest.yes_price - baseline.yes_price
        if abs(delta) < threshold:
            continue
        alerts.append(
            PredictionMarketAlertRow(
                source=latest.source,
                source_id=latest.source_id,
                question=latest.question,
                category=latest.category,
                url=latest.url,
                yes_price=latest.yes_price,
                previous_yes_price=baseline.yes_price,
                absolute_movement=delta,
                direction="up" if delta > 0 else "down",
            )
        )
    alerts.sort(key=lambda row: abs(row.absolute_movement), reverse=True)
    alerts = alerts[:limit]
    return PredictionMarketAlertsResponse(
        window_hours=window,
        min_movement_bps=min_movement_bps,
        count=len(alerts),
        alerts=alerts,
    )


@router.get(
    "/{source}/{source_id}/history",
    response_model=PredictionMarketHistoryResponse,
)
async def get_prediction_market_history(
    source: str = Path(..., pattern=r"^[a-z][a-z0-9_-]{1,31}$"),
    source_id: str = Path(..., min_length=1, max_length=128),
    days: int = Query(default=30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketHistoryResponse:
    """Per-market YES-price time series for the deep-dive drawer.

    Reads from the nightly snapshot table (30-day retention by default).
    If the market has no rows (e.g. it was just ingested), returns an
    empty ``points`` list so the drawer renders an empty state instead of
    500ing.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    try:
        rows = (
            await db.execute(
                select(PredictionMarketSnapshot)
                .where(
                    PredictionMarketSnapshot.source == source,
                    PredictionMarketSnapshot.source_id == source_id,
                    PredictionMarketSnapshot.captured_at >= cutoff,
                )
                .order_by(PredictionMarketSnapshot.captured_at.asc())
            )
        ).scalars().all()
    except (OperationalError, ProgrammingError):
        raise HTTPException(status_code=503, detail="snapshot table unavailable")

    question = rows[0].question if rows else ""
    points = [
        PredictionMarketHistoryPoint(
            captured_at=row.captured_at,
            yes_price=row.yes_price,
            volume=row.volume,
        )
        for row in rows
    ]
    return PredictionMarketHistoryResponse(
        source=source,
        source_id=source_id,
        question=question,
        points=points,
    )


@router.get(
    "/cross-calibration",
    response_model=PredictionMarketCrossCalibrationResponse,
)
async def list_prediction_market_cross_calibration(
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketCrossCalibrationResponse:
    """Per-topic consensus across all known sources.

    Phase 10. ``sources_agree`` is True when the topic has >= 2 sources
    and the spread between min and max consensus is below a maintained
    threshold per topic (cpi 5pp, fed 8pp, recession 12pp).
    """
    agreement_threshold = {"cpi": 0.05, "fed": 0.08, "recession": 0.12}

    try:
        rows = (
            await db.execute(
                select(PredictionMarket).where(PredictionMarket.active.is_(True))
            )
        ).scalars().all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketCrossCalibrationResponse(topics=[], last_updated=None)

    per_topic: dict[str, list[PredictionMarket]] = {"cpi": [], "fed": [], "recession": []}
    for market in rows:
        haystack = f"{market.question} {market.description or ''}".lower()
        for topic, keywords in _TOPIC_KEYWORDS.items():
            if any(k in haystack for k in keywords):
                per_topic[topic].append(market)

    out_topics: list[PredictionMarketCrossCalibrationTopic] = []
    for topic, markets in per_topic.items():
        per_source: dict[str, list[PredictionMarket]] = {}
        for market in markets:
            per_source.setdefault(market.source, []).append(market)
        sources: list[PredictionMarketCrossCalibrationSourceRow] = []
        consensus_values: list[float] = []
        for source_name, source_markets in sorted(per_source.items()):
            consensus = _topic_consensus(source_markets, topic)
            if consensus is not None:
                consensus_values.append(consensus)
            sources.append(
                PredictionMarketCrossCalibrationSourceRow(
                    source=source_name,
                    consensus_yes_price=consensus,
                    n_markets=len(source_markets),
                )
            )
        n_sources = len(consensus_values)
        spread = (
            (max(consensus_values) - min(consensus_values))
            if len(consensus_values) >= 2
            else 0.0
        )
        sources_agree = (
            n_sources >= 2 and spread <= agreement_threshold.get(topic, 0.1)
        )
        out_topics.append(
            PredictionMarketCrossCalibrationTopic(
                topic=topic,
                n_sources=n_sources,
                sources_agree=sources_agree,
                sources=sources,
            )
        )

    last_updated = max((row.updated_at for row in rows), default=None)
    return PredictionMarketCrossCalibrationResponse(
        topics=out_topics,
        last_updated=last_updated,
    )
