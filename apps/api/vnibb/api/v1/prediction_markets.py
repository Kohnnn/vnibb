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

import re
from datetime import UTC, datetime, timedelta
from typing import Final, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Float, String as SA_String
from sqlalchemy import and_, case, cast, exists, func, or_, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db
from vnibb.models.prediction_market import PredictionMarket
from vnibb.models.prediction_market_archive import PredictionMarketArchive
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

KNOWN_PREDICTION_MARKET_SOURCES: Final[tuple[str, ...]] = (
    "polymarket",
    "kalshi",
    "predictit",
    "limitless",
    "manifold",
)
PREDICTION_MARKET_STALE_AFTER_SECONDS: Final = 86_400


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
    movement: float
    absolute_movement: float


class PredictionMarketMoversResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    window_hours: int
    count: int
    movers: list[PredictionMarketMoverRow]


class PredictionMarketSourceHealthRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    source: str
    status: Literal["synced", "stale", "empty"]
    market_count: int
    snapshot_count: int
    latest_snapshot_at: datetime | None
    stale_after_seconds: int
    # Provenance. A source whose rows all came from the checked-in fixture is
    # not actually synced, and reporting it as such is what let a provider
    # outage look like a healthy feed.
    synthetic_market_count: int = 0


class PredictionMarketSourceHealthResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    sources: list[PredictionMarketSourceHealthRow]


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
    movement: float
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
    # Substring search over the question text. Powers the ElectionOddsWidget
    # politics-shaped regex and any free-text search.
    search: str | None = Query(default=None, max_length=200),
    # Topic selector that ORs over ``extra.canonical_topics`` via
    # ``PredictionMarket.extra``. Valid values: ``election``, ``macro``,
    # ``sports``, ``crypto``.
    topic: str | None = Query(default=None, pattern=r"^[a-z][a-z0-9_-]{1,31}$"),
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
        category_values = {
            "economic": ("economic", "economics"),
        }.get(category, (category,))
        stmt = stmt.where(func.lower(PredictionMarket.category).in_(category_values))
    if search is not None:
        like_pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(PredictionMarket.question).like(like_pattern),
                func.lower(PredictionMarket.description).like(like_pattern),
            )
        )
    if topic is not None:
        # ``extra`` is a JSON column. We cast to text for portability — the
        # ``canonical_topics`` list is serialised as JSON inside the column
        # so a LIKE over ``"<topic>"`` matches either a single-element list
        # or the topic within a longer list.
        stmt = stmt.where(
            cast(PredictionMarket.extra, SA_String).like(f'%"{topic}"%')
        )
    archive_stmt = None
    if active is not True:
        payload = PredictionMarketArchive.payload
        archive_stmt = select(PredictionMarketArchive).order_by(
            payload["end_date"].as_string().is_(None),
            payload["end_date"].as_string().asc(),
            PredictionMarketArchive.market_id.asc(),
        )
        # Archive copies may coexist with their live row before lifecycle deletion.
        archive_stmt = archive_stmt.where(~exists(
            select(PredictionMarket.id).where(PredictionMarket.id == PredictionMarketArchive.market_id)
        ))
        if source is not None:
            archive_stmt = archive_stmt.where(payload["source"].as_string() == source)
        if category is not None:
            archive_stmt = archive_stmt.where(func.lower(payload["category"].as_string()).in_(category_values))
        if search is not None:
            archive_stmt = archive_stmt.where(or_(
                func.lower(payload["question"].as_string()).like(like_pattern),
                func.lower(payload["description"].as_string()).like(like_pattern),
            ))
        if topic is not None:
            archive_stmt = archive_stmt.where(
                cast(payload["extra"], SA_String).like(f'%"{topic}"%')
            )
    try:
        live = (await db.execute(stmt.limit(limit))).scalars().all()
        archived = (await db.execute(archive_stmt.limit(limit))).scalars().all() if archive_stmt is not None else []
    except (OperationalError, ProgrammingError) as error:
        if _is_missing_prediction_market_relation(error):
            return PredictionMarketsResponse(count=0, data=[])
        raise
    # Each branch is independently sorted and bounded. Merging at most 2*limit
    # rows preserves the original order without ever loading historical corpus.
    rows = [(market.end_date, market.id, PredictionMarketRead.model_validate(market)) for market in live]
    rows.extend(
        (item.end_date, archive.market_id, item)
        for archive in archived
        for item in [PredictionMarketRead.model_validate(archive.payload)]
    )
    rows.sort(key=lambda row: (row[0] is None, row[0].isoformat() if row[0] else "", row[1]))
    data = [row[2] for row in rows[:limit]]
    return PredictionMarketsResponse(count=len(data), data=data)


def _is_missing_prediction_market_relation(error: OperationalError | ProgrammingError) -> bool:
    message = str(error.orig).lower()
    return (
        re.search(
            r"\bprediction_market(?:s|_snapshots)\b",
            message,
        ) is not None
        and (
            getattr(error.orig, "pgcode", None) == "42P01"
            or "no such table" in message
            or "relation" in message and "does not exist" in message
        )
    )


def _resolve_window_hours(
    window_hours: int | None, window: int | None, default: int
) -> int:
    canonical = window_hours if isinstance(window_hours, int) else None
    legacy = window if isinstance(window, int) else None
    if canonical is not None and legacy is not None and canonical != legacy:
        raise HTTPException(
            status_code=422,
            detail="window_hours and window must match when both are supplied",
        )
    return canonical if canonical is not None else legacy if legacy is not None else default


def _snapshot_movements(model, cutoff: datetime, limit: int, *, threshold: float = 0.0, direction: str = "both", excluded: list[str] | None = None, recent: bool = False):
    """Rank complete per-market movements in SQL before transferring result rows."""
    latest = (
        select(
            model.source, model.source_id, model.question, model.category, model.url,
            model.yes_price, model.captured_at,
            func.row_number().over(
                partition_by=(model.source, model.source_id),
                order_by=(model.captured_at.desc(), model.id.desc()),
            ).label("rn"),
        )
        .where(model.captured_at >= cutoff if recent else True)
        .subquery()
    )
    baseline = (
        select(
            model.source, model.source_id, model.yes_price,
            func.row_number().over(
                partition_by=(model.source, model.source_id),
                order_by=(model.captured_at.desc(), model.id.desc()),
            ).label("rn"),
        )
        .where(model.captured_at <= cutoff)
        .subquery()
    )
    delta = latest.c.yes_price - baseline.c.yes_price
    stmt = select(latest.c.source, latest.c.source_id, latest.c.question,
                  latest.c.category, latest.c.url, latest.c.yes_price,
                  baseline.c.yes_price.label("previous_yes_price"), delta.label("movement"))
    stmt = stmt.join(baseline, and_(
        latest.c.source == baseline.c.source,
        latest.c.source_id == baseline.c.source_id,
        baseline.c.rn == 1,
    )).where(latest.c.rn == 1, func.abs(delta) >= threshold)
    if direction == "up":
        stmt = stmt.where(delta > 0)
    elif direction == "down":
        stmt = stmt.where(delta < 0)
    if excluded:
        stmt = stmt.where(or_(latest.c.category.is_(None), func.lower(latest.c.category).not_in(excluded)))
    return stmt.order_by(func.abs(delta).desc(), latest.c.source, latest.c.source_id).limit(limit)


@router.get("/source-health", response_model=PredictionMarketSourceHealthResponse)
async def get_prediction_market_source_health(
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketSourceHealthResponse:
    now = datetime.now(UTC)
    empty_rows = [
        PredictionMarketSourceHealthRow(
            source=source,
            status="empty",
            market_count=0,
            snapshot_count=0,
            latest_snapshot_at=None,
            stale_after_seconds=PREDICTION_MARKET_STALE_AFTER_SECONDS,
        )
        for source in KNOWN_PREDICTION_MARKET_SOURCES
    ]
    try:
        # Presence, not an exact population count. `prediction_markets` holds
        # ~13.3M rows, nearly all from one source, and `GROUP BY source` over
        # it cannot use an index (the planner expects millions of rows per
        # group, so it prefers a parallel seq scan) -- measured at 114-143s,
        # which made this health endpoint time out. A bounded probe answers
        # the only question health actually asks, at index speed.
        market_counts = {
            source: int(
                (
                    await db.execute(
                        select(PredictionMarket.id)
                        .where(PredictionMarket.source == source)
                        .limit(1)
                    )
                ).first()
                is not None
            )
            for source in KNOWN_PREDICTION_MARKET_SOURCES
        }
        synthetic_counts = dict(
            (
                await db.execute(
                    select(PredictionMarket.source, func.count(PredictionMarket.id))
                    .where(PredictionMarket.is_synthetic.is_(True))
                    .group_by(PredictionMarket.source)
                )
            ).all()
        )
        # Same shape as above, same problem: 2.23M snapshot rows, and the
        # aggregate's count was only ever used to decide `empty` vs `stale`.
        # Fetch the latest timestamp per source (indexed, cheap) and derive
        # presence from it, rather than grouping the whole table.
        snapshot_stats = {
            source: (
                int(
                    (
                        await db.execute(
                            select(PredictionMarketSnapshot.id)
                            .where(PredictionMarketSnapshot.source == source)
                            .limit(1)
                        )
                    ).first()
                    is not None
                ),
                (
                    await db.execute(
                        select(func.max(PredictionMarketSnapshot.captured_at)).where(
                            PredictionMarketSnapshot.source == source
                        )
                    )
                ).scalar(),
            )
            for source in KNOWN_PREDICTION_MARKET_SOURCES
        }
    except (OperationalError, ProgrammingError) as error:
        if _is_missing_prediction_market_relation(error):
            return PredictionMarketSourceHealthResponse(sources=empty_rows)
        raise HTTPException(
            status_code=503,
            detail="prediction market source health unavailable",
        ) from None

    sources: list[PredictionMarketSourceHealthRow] = []
    for source in KNOWN_PREDICTION_MARKET_SOURCES:
        market_count = int(market_counts.get(source, 0))
        synthetic_market_count = int(synthetic_counts.get(source, 0))
        snapshot_count, latest_snapshot_at = snapshot_stats.get(source, (0, None))
        status: Literal["synced", "stale", "empty"] = "empty"
        if market_count > 0 or snapshot_count > 0:
            status = "stale"
        if latest_snapshot_at is not None:
            latest = latest_snapshot_at
            if latest.tzinfo is None:
                latest = latest.replace(tzinfo=UTC)
            if now - latest <= timedelta(seconds=PREDICTION_MARKET_STALE_AFTER_SECONDS):
                status = "synced"
        # A source whose rows are entirely fixture-derived is not synced no
        # matter how fresh its snapshot looks: the ingest fell back, which
        # means the provider did not deliver.
        if market_count > 0 and synthetic_market_count >= market_count:
            status = "stale"
        sources.append(
            PredictionMarketSourceHealthRow(
                source=source,
                status=status,
                market_count=market_count,
                snapshot_count=int(snapshot_count),
                latest_snapshot_at=latest_snapshot_at,
                stale_after_seconds=PREDICTION_MARKET_STALE_AFTER_SECONDS,
                synthetic_market_count=synthetic_market_count,
            )
        )
    return PredictionMarketSourceHealthResponse(sources=sources)


@router.get("/movers", response_model=PredictionMarketMoversResponse)
async def list_prediction_market_movers(
    window_hours: int | None = Query(default=None, ge=1, le=720),
    window: int | None = Query(default=None, ge=1, le=720),
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
    window_hours = _resolve_window_hours(window_hours, window, 24)
    snapshot_model = (
        PredictionMarketIntradaySnapshot
        if window_hours < 24
        else PredictionMarketSnapshot
    )
    now = datetime.now(UTC)
    cutoff = now - timedelta(hours=window_hours)
    excluded: list[str] = []
    if exclude_categories:
        excluded = [c.strip().lower() for c in exclude_categories.split(",") if c.strip()]

    try:
        rows = (await db.execute(_snapshot_movements(
            snapshot_model, cutoff, limit, direction=direction, excluded=excluded, recent=True
        ))).all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketMoversResponse(window_hours=window_hours, count=0, movers=[])

    movers = [
        PredictionMarketMoverRow(
            source=row.source,
            source_id=row.source_id,
            question=row.question,
            category=row.category,
            url=row.url,
            yes_price=row.yes_price,
            previous_yes_price=row.previous_yes_price,
            movement=row.movement,
            absolute_movement=row.movement,
        )
        for row in rows
    ]
    return PredictionMarketMoversResponse(window_hours=window_hours, count=len(movers), movers=movers)


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
    stmt = (
        select(PredictionMarket)
        .where(PredictionMarket.active.is_(True), _topic_matches(markers, include_slug=True))
        .order_by(PredictionMarket.id)
        .limit(limit)
    )
    matching = (await db.execute(stmt)).scalars().all()
    prices = [
        market.outcome_prices[0]
        for market in matching
        if isinstance(market.outcome_prices, list)
        and market.outcome_prices
        and type(market.outcome_prices[0]) in (int, float)
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


def _topic_matches(keywords: tuple[str, ...], *, include_slug: bool = False):
    text = PredictionMarket.question + " " + func.coalesce(PredictionMarket.description, "")
    if include_slug:
        text = text + " " + func.coalesce(PredictionMarket.slug, "")
    haystack = func.lower(text)
    return or_(*(haystack.contains(keyword, autoescape=True) for keyword in keywords))


def _topic_aggregates(db: AsyncSession):
    """Return source-level counts and weighted topic sums, never market objects.

    SQL JSON type checks preserve the old Python rule: the first price must be
    numeric (not a string, null, object or boolean). Both dialects are used by
    this project: PostgreSQL in production and SQLite in API fixtures.
    """
    price_json = PredictionMarket.outcome_prices[0]
    dialect = db.bind.dialect.name
    numeric = (
        func.json_typeof(price_json) == "number"
        if dialect == "postgresql"
        else func.json_type(PredictionMarket.outcome_prices, "$[0]").in_(("integer", "real"))
    )
    price = cast(price_json.as_string(), Float)
    weight = case((PredictionMarket.volume >= 1, PredictionMarket.volume), else_=1.0)
    columns = [PredictionMarket.source, func.count(PredictionMarket.id).label("source_count")]
    for topic, keywords in _TOPIC_KEYWORDS.items():
        matches = _topic_matches(keywords)
        valid = and_(matches, numeric)
        columns.extend(
            (
                func.sum(case((matches, 1), else_=0)).label(f"{topic}_count"),
                func.sum(case((valid, price * weight), else_=0.0)).label(f"{topic}_weighted"),
                func.sum(case((valid, weight), else_=0.0)).label(f"{topic}_weight"),
            )
        )
    return select(*columns).where(PredictionMarket.active.is_(True)).group_by(PredictionMarket.source)


def _weighted_topic(row, topic: str) -> float | None:
    weight = getattr(row, f"{topic}_weight")
    return float(getattr(row, f"{topic}_weighted")) / float(weight) if weight else None


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
        rows = (await db.execute(_topic_aggregates(db).where(
            PredictionMarket.source.in_(("polymarket", "kalshi"))
        ))).all()
    except (OperationalError, ProgrammingError):
        rows = []

    by_source = {row.source: row for row in rows}
    topics: list[PredictionMarketSpreadTopic] = []
    for topic in _TOPIC_KEYWORDS:
        poly = by_source.get("polymarket")
        kalshi = by_source.get("kalshi")
        poly_consensus = _weighted_topic(poly, topic) if poly else None
        kalshi_consensus = _weighted_topic(kalshi, topic) if kalshi else None
        gap = (
            poly_consensus - kalshi_consensus
            if poly_consensus is not None and kalshi_consensus is not None
            else None
        )
        topics.append(
            PredictionMarketSpreadTopic(
                topic=topic,
                polymarket_consensus=poly_consensus,
                kalshi_consensus=kalshi_consensus,
                gap=gap,
                n_polymarket=int(poly.source_count) if poly else 0,
                n_kalshi=int(kalshi.source_count) if kalshi else 0,
            )
        )
    return PredictionMarketSpreadResponse(window_hours=24, topics=topics)


@router.get("/consensus", response_model=PredictionMarketConsensusResponse)
async def get_prediction_market_consensus(
    query: str = Query(..., min_length=2, max_length=200),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketConsensusResponse:
    """Volume-weighted consensus across Polymarket and Kalshi.

    Substring-matches the question (case-insensitive), aggregating all matching
    rows into one result per source before transferring them to the API.
    """
    price_json = PredictionMarket.outcome_prices[0]
    numeric = (
        func.json_typeof(price_json) == "number"
        if db.bind.dialect.name == "postgresql"
        else func.json_type(PredictionMarket.outcome_prices, "$[0]").in_(("integer", "real"))
    )
    price = cast(price_json.as_string(), Float)
    weight = case((PredictionMarket.volume >= 1, PredictionMarket.volume), else_=1.0)
    try:
        rows = (await db.execute(
            select(
                PredictionMarket.source,
                func.count(PredictionMarket.id).label("n_markets"),
                func.sum(case((numeric, price * weight), else_=0.0)).label("weighted"),
                func.sum(case((numeric, weight), else_=0.0)).label("weight"),
                func.sum(case((numeric, PredictionMarket.volume), else_=0.0)).label("volume"),
                func.max(case((numeric, PredictionMarket.url))).label("url"),
                func.sum(case((numeric, 1), else_=0)).label("priced_count"),
            )
            .where(PredictionMarket.active.is_(True),
                   func.lower(PredictionMarket.question).contains(query.lower(), autoescape=True))
            .group_by(PredictionMarket.source)
        )).all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketConsensusResponse(
            query=query, consensus_yes_price=None, n_markets=0, sources=[],
        )

    total_weight = sum(float(row.weight) for row in rows)
    sources = [
        PredictionMarketConsensusSourceRow(
            source=row.source,
            yes_price=float(row.weighted) / float(row.weight) if row.weight else None,
            volume=float(row.volume) if row.weight else None,
            url=row.url if row.priced_count == 1 else None,
        )
        for row in sorted(rows, key=lambda item: item.source)
    ]
    return PredictionMarketConsensusResponse(
        query=query,
        consensus_yes_price=sum(float(row.weighted) for row in rows) / total_weight if total_weight else None,
        n_markets=sum(int(row.n_markets) for row in rows),
        sources=sources,
    )


@router.get("/alerts", response_model=PredictionMarketAlertsResponse)
async def list_prediction_market_alerts(
    window_hours: int | None = Query(default=None, ge=1, le=168),
    window: int | None = Query(default=None, ge=1, le=168),
    min_movement_bps: int = Query(default=200, ge=10, le=5000),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketAlertsResponse:
    """Return markets whose YES probability moved >= ``min_movement_bps``.

    Reads from the intraday micro-snapshot table (every 15 min) so 1h / 4h
    windows return meaningful data instead of always-empty. Tolerates the
    table being absent.
    """
    window_hours = _resolve_window_hours(window_hours, window, 1)
    now = datetime.now(UTC)
    cutoff = now - timedelta(hours=window_hours)

    try:
        rows = (await db.execute(_snapshot_movements(
            PredictionMarketIntradaySnapshot, cutoff, limit,
            threshold=min_movement_bps / 10_000.0,
        ))).all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketAlertsResponse(
            window_hours=window_hours, min_movement_bps=min_movement_bps,
            count=0, alerts=[],
        )
    alerts = [
        PredictionMarketAlertRow(
            source=row.source, source_id=row.source_id, question=row.question,
            category=row.category, url=row.url, yes_price=row.yes_price,
            previous_yes_price=row.previous_yes_price, movement=row.movement,
            absolute_movement=row.movement,
            direction="up" if row.movement > 0 else "down",
        )
        for row in rows
    ]
    return PredictionMarketAlertsResponse(
        window_hours=window_hours, min_movement_bps=min_movement_bps,
        count=len(alerts), alerts=alerts,
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
    now = datetime.now(UTC)
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
        raise HTTPException(status_code=503, detail="snapshot table unavailable") from None

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
        rows = (await db.execute(_topic_aggregates(db).add_columns(
            func.max(PredictionMarket.updated_at).label("latest_updated")
        ))).all()
    except (OperationalError, ProgrammingError):
        return PredictionMarketCrossCalibrationResponse(topics=[], last_updated=None)

    out_topics: list[PredictionMarketCrossCalibrationTopic] = []
    for topic in _TOPIC_KEYWORDS:
        sources: list[PredictionMarketCrossCalibrationSourceRow] = []
        consensus_values: list[float] = []
        for row in sorted(rows, key=lambda item: item.source):
            if not getattr(row, f"{topic}_count"):
                continue
            consensus = _weighted_topic(row, topic)
            if consensus is not None:
                consensus_values.append(consensus)
            sources.append(
                PredictionMarketCrossCalibrationSourceRow(
                    source=row.source,
                    consensus_yes_price=consensus,
                    n_markets=int(getattr(row, f"{topic}_count")),
                )
            )
        n_sources = len(consensus_values)
        spread = max(consensus_values) - min(consensus_values) if n_sources >= 2 else 0.0
        out_topics.append(
            PredictionMarketCrossCalibrationTopic(
                topic=topic,
                n_sources=n_sources,
                sources_agree=n_sources >= 2 and spread <= agreement_threshold[topic],
                sources=sources,
            )
        )

    return PredictionMarketCrossCalibrationResponse(
        topics=out_topics,
        last_updated=max((row.latest_updated for row in rows if row.latest_updated), default=None),
    )
