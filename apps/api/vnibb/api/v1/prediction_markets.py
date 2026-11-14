"""Prediction market read endpoints (Phase 7 + Phase 8 expansion).

The router grew during the prediction-markets expansion:

* `GET /prediction-markets` — existing list endpoint, with the new
  case-insensitive `category` alias.
* `GET /prediction-markets/movers` — top markets ranked by absolute
  movement in YES probability between the latest snapshot and the
  historical snapshot `window_hours` ago. Supports `?direction=up|down|both`
  and `?exclude_categories=…` from Phase 8.
* `GET /prediction-markets/alerts` — Phase 8. Diffs the latest intraday
  micro-snapshot against the nearest baseline at or before the `window`
  cutoff, bounded by an explicit sampling tolerance at both ends, and
  surfaces movements above `min_movement_bps`. Reports an explicit
  `status`/`coverage` block so storage failure, an empty universe, a
  missing baseline, stale coverage and a genuine zero-alert result stay
  distinguishable.
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
from sqlalchemy import Float, and_, case, cast, exists, func, literal_column, or_, select
from sqlalchemy import String as SA_String
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
from vnibb.services.prediction_market_policy import (
    MAX_MARKET_OUTCOMES,
    PREDICTION_MARKET_ALERT_BASELINE_TOLERANCE,
    PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES,
    active_market_candidates,
    observed_yes_price,
    snapshot_eligibility,
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
    extra: dict | None = None
    is_synthetic: bool = False


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
    live_market_count: int = 0
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
    # Both legs of the comparison on the source observation clock.
    # ``elapsed_seconds`` is the actual span, never the requested window.
    baseline_observed_at: datetime
    current_observed_at: datetime
    elapsed_seconds: int


class PredictionMarketAlertCoverage(BaseModel):
    """Per-market coverage of this window, independent of ``limit``/threshold.

    Omissions are derivable: ``comparable - evaluated`` (no admissible current)
    and ``current - evaluated`` (no admissible baseline). Catalogue size is
    deliberately absent: it measures the catalogue, not this window.
    """

    model_config = ConfigDict(frozen=True)

    comparable_markets: int
    current_markets: int
    evaluated_markets: int


AlertStatus = Literal["unavailable", "empty", "no_baseline", "stale", "complete"]


class PredictionMarketAlertsResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    window_hours: int
    min_movement_bps: int
    count: int
    alerts: list[PredictionMarketAlertRow]
    # ``unavailable`` means the comparison never ran, so ``count == 0`` carries
    # no information about movement. ``complete`` is the only status that
    # licenses an aggregate no-movement claim.
    status: AlertStatus
    coverage: PredictionMarketAlertCoverage | None
    # Sampling contract the status was evaluated under.
    cadence_minutes: int
    baseline_tolerance_seconds: int
    # Calculation clock of this evaluation; not a proxy for source freshness.
    evaluated_at: datetime
    # Max admissible observation across the evaluated set; the actual source
    # clock, never invented from the request time.
    data_observed_through: datetime | None


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
    active: bool | None = Query(default=True),
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
    market = PredictionMarket if active is False else active_market_candidates(
        datetime.now(UTC), (source,) if source else KNOWN_PREDICTION_MARKET_SOURCES
    )
    stmt = select(market)
    if active is False:
        stmt = stmt.order_by(market.end_date.is_(None), market.end_date.asc(), market.id.asc())
    else:
        stmt = stmt.order_by(market.updated_at.desc(), market.id.asc())
    if source is not None:
        stmt = stmt.where(market.source == source)
    if active is False:
        stmt = stmt.where(market.active.is_(False), market.is_synthetic.is_(False))
    if category is not None:
        category_values = {
            "economic": ("economic", "economics"),
        }.get(category, (category,))
        stmt = stmt.where(func.lower(market.category).in_(category_values))
    if search is not None:
        like_pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(market.question).like(like_pattern),
                func.lower(market.description).like(like_pattern),
            )
        )
    if topic is not None:
        # ``extra`` is a JSON column. We cast to text for portability — the
        # ``canonical_topics`` list is serialised as JSON inside the column
        # so a LIKE over ``"<topic>"`` matches either a single-element list
        # or the topic within a longer list.
        stmt = stmt.where(
            cast(market.extra, SA_String).like(f'%"{topic}"%')
        )
    archive_stmt = None
    if active is False:
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
        if archive_stmt is None:
            data = [PredictionMarketRead.model_validate(row) for row in live]
            return PredictionMarketsResponse(count=len(data), data=data)
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
    """True only for a genuinely absent prediction-market table.

    ``[a-z_]*`` deliberately spans underscores, so the intraday relation
    (``prediction_market_intraday_snapshots``) is recognised alongside the
    catalogue, archive and nightly snapshot tables: a partially provisioned
    database must degrade to an explicit unavailable status, not a 500.
    """
    message = str(error.orig).lower()
    return (
        re.search(r"\bprediction_market[a-z_]*\b", message) is not None
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


def _snapshot_movements(
    model, cutoff: datetime, limit: int, *, now: datetime, threshold: float = 0.0,
    direction: str = "both", excluded: list[str] | None = None, recent: bool = False,
    tolerance: timedelta | None = None,
):
    """Rank complete per-market movements in SQL before transferring result rows.

    ``now`` is supplied by the caller so one response never mixes two clocks.
    ``tolerance`` stays ``None`` for ``/movers``: that endpoint ranks the largest
    move rather than making a per-window claim, so it keeps its unbounded
    baseline and byte-identical behaviour. Only ``/alerts`` passes a band.
    """
    market = active_market_candidates(now)
    eligible = select(market.source, market.source_id).cte("eligible_markets")
    eligible_snapshot = exists(select(1).where(
        eligible.c.source == model.source, eligible.c.source_id == model.source_id,
    ))
    latest = (
        select(
            model.source, model.source_id, model.question, model.category, model.url,
            model.yes_price, model.captured_at,
            func.row_number().over(
                partition_by=(model.source, model.source_id),
                order_by=(model.captured_at.desc(), model.id.desc()),
            ).label("rn"),
        )
        .where(eligible_snapshot, model.captured_at >= cutoff if recent else True)
        .subquery()
    )
    baseline_conditions = [eligible_snapshot, model.captured_at <= cutoff]
    if tolerance is not None:
        latest = (
            select(
                model.source, model.source_id, model.question, model.category, model.url,
                model.yes_price, model.captured_at,
                func.row_number().over(
                    partition_by=(model.source, model.source_id),
                    order_by=(model.captured_at.desc(), model.id.desc()),
                ).label("rn"),
            )
            .where(
                eligible_snapshot,
                model.captured_at >= (cutoff if recent else now - tolerance),
                model.captured_at <= now,
                model.yes_price >= 0,
                model.yes_price <= 1,
            )
            .subquery()
        )
        baseline_conditions.extend(
            [model.captured_at >= cutoff - tolerance, model.yes_price >= 0, model.yes_price <= 1]
        )
    baseline = (
        select(
            model.source, model.source_id, model.yes_price,
            func.row_number().over(
                partition_by=(model.source, model.source_id),
                order_by=(model.captured_at.desc(), model.id.desc()),
            ).label("rn"),
        )
        .where(*baseline_conditions)
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


def _alert_legs(model, eligible_snapshot, *, lower: datetime, upper: datetime):
    """Latest *admissible* observation per market inside one half of the window.

    Both bounds and the ``[0, 1]`` price test are applied before ranking, so the
    selected row is the latest usable measurement rather than the latest row
    overall. A non-finite (-NaN) price fails both comparisons on either dialect
    and is therefore never comparable.
    """
    ranked = (
        select(
            model.source, model.source_id, model.question, model.category, model.url,
            model.yes_price, model.captured_at,
            func.row_number().over(
                partition_by=(model.source, model.source_id),
                order_by=(model.captured_at.desc(), model.id.desc()),
            ).label("rn"),
        )
        .where(
            eligible_snapshot,
            model.captured_at >= lower,
            model.captured_at <= upper,
            model.yes_price >= 0,
            model.yes_price <= 1,
        )
        .subquery()
    )
    return select(
        ranked.c.source, ranked.c.source_id, ranked.c.question, ranked.c.category,
        ranked.c.url, ranked.c.yes_price, ranked.c.captured_at,
    ).where(ranked.c.rn == 1).subquery()


def _alert_legs_query(model, *, cutoff: datetime, now: datetime, tolerance: timedelta):
    """The two admissible half-window legs for the alert comparison."""
    market = active_market_candidates(now)
    eligible = select(market.source, market.source_id).cte("eligible_markets")
    eligible_snapshot = exists(
        select(1).where(
            eligible.c.source == model.source,
            eligible.c.source_id == model.source_id,
        )
    )
    current = _alert_legs(model, eligible_snapshot, lower=now - tolerance, upper=now)
    baseline = _alert_legs(model, eligible_snapshot, lower=cutoff - tolerance, upper=cutoff)
    return current, baseline


async def _alert_coverage(
    db: AsyncSession, current, baseline,
) -> tuple[PredictionMarketAlertCoverage, datetime | None]:
    """Count window coverage per market, before ``min_movement_bps`` and ``limit``.

    ``comparable`` has an admissible baseline, ``current`` an admissible current
    observation, ``evaluated`` both. Nothing here is inferred from the cutoff,
    and neither ``limit`` nor the movement threshold can change these numbers.
    """
    evaluated = select(
        func.count().label("evaluated"),
        func.max(current.c.captured_at).label("observed_through"),
    ).select_from(current.join(baseline, and_(
        current.c.source == baseline.c.source,
        current.c.source_id == baseline.c.source_id,
    )))
    comparable_markets = int(
        (await db.execute(select(func.count()).select_from(baseline))).scalar_one()
    )
    current_markets = int(
        (await db.execute(select(func.count()).select_from(current))).scalar_one()
    )

    row = (await db.execute(evaluated)).one()
    return (
        PredictionMarketAlertCoverage(
            comparable_markets=comparable_markets,
            current_markets=current_markets,
            evaluated_markets=int(row.evaluated or 0),
        ),
        row.observed_through,
    )


def _alert_rows(current, baseline, *, threshold: float, limit: int):
    """Rank evaluated movements by size in SQL, then transfer at most ``limit``."""
    delta = current.c.yes_price - baseline.c.yes_price
    return (
        select(
            current.c.source,
            current.c.source_id,
            current.c.question,
            current.c.category,
            current.c.url,
            current.c.yes_price,
            baseline.c.yes_price.label("previous_yes_price"),
            current.c.captured_at.label("current_observed_at"),
            baseline.c.captured_at.label("baseline_observed_at"),
            delta.label("movement"),
        )
        .select_from(current.join(baseline, and_(
            current.c.source == baseline.c.source,
            current.c.source_id == baseline.c.source_id,
        )))
        .where(func.abs(delta) >= threshold)
        .order_by(func.abs(delta).desc(), current.c.source, current.c.source_id)
        .limit(limit)
    )


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
        market_counts = {}
        snapshot_stats = {}
        for source in KNOWN_PREDICTION_MARKET_SOURCES:
            market = active_market_candidates(now, (source,))
            market_counts[source] = int((await db.execute(
                select(func.count(market.id))
            )).scalar_one())
            snapshots = select(
                func.count(PredictionMarketSnapshot.id),
                func.max(PredictionMarketSnapshot.captured_at),
            ).join(market, and_(
                PredictionMarketSnapshot.source == market.source,
                PredictionMarketSnapshot.source_id == market.source_id,
            )).where(PredictionMarketSnapshot.captured_at >= now - timedelta(days=30))
            snapshot_stats[source] = (await db.execute(snapshots)).one()
        synthetic_counts = dict(
            (
                await db.execute(
                    select(PredictionMarket.source, func.count(PredictionMarket.id))
                    .where(PredictionMarket.is_synthetic.is_(True))
                    .group_by(PredictionMarket.source)
                )
            ).all()
        )
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
        if market_count > 0:
            status = "stale"
        if market_count > 0 and latest_snapshot_at is not None:
            latest = latest_snapshot_at
            if latest.tzinfo is None:
                latest = latest.replace(tzinfo=UTC)
            if now - latest <= timedelta(seconds=PREDICTION_MARKET_STALE_AFTER_SECONDS):
                status = "synced"
        sources.append(
            PredictionMarketSourceHealthRow(
                source=source,
                status=status,
                market_count=market_count,
                live_market_count=market_count,
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
            snapshot_model, cutoff, limit, now=now, direction=direction,
            excluded=excluded, recent=True,
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
            absolute_movement=abs(row.movement),
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
    """List explicit topic matches and their consensus, filtered before the limit."""
    markers = _TOPIC_KEYWORDS[topic]
    market = PredictionMarket
    stmt = (
        select(market)
        .where(*snapshot_eligibility(datetime.now(UTC)))
        .where(_topic_matches(markers, market=market))
        .order_by(market.updated_at.desc(), market.id.asc())
        .limit(limit)
    )
    matching = (await db.execute(stmt)).scalars().all()
    prices = [price for market in matching if (price := observed_yes_price(market)) is not None]
    consensus = sum(prices) / len(prices) if prices else None
    return PredictionMarketCalibrationResponse(
        topic=topic,
        consensus_yes_price=consensus,
        n_markets=len(matching),
        last_updated=max((market.updated_at for market in matching), default=None),
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


def _topic_matches(keywords: tuple[str, ...], *, market=PredictionMarket):
    text = market.question + " " + func.coalesce(market.description, "")
    phrases = "|".join("[- \t\r\n\f\v]+".join(keyword.split()) for keyword in keywords)
    return func.lower(text).regexp_match(r"(^|[^a-z0-9_])(" + phrases + r")([^a-z0-9_]|$)")


def _observed_price_sql(market, db: AsyncSession):
    postgres = db.bind.dialect.name == "postgresql"
    value = market.outcome_prices[0]
    first_numeric = (
        func.json_typeof(value) == "number"
        if postgres
        else func.json_type(market.outcome_prices, "$[0]").in_(("integer", "real"))
    )
    first = case((first_numeric, cast(value.as_string(), Float)))
    is_array = (
        func.json_typeof(market.outcome_prices) == "array"
        if postgres
        else func.json_type(market.outcome_prices) == "array"
    )
    bounded = and_(
        is_array,
        case((is_array, func.json_array_length(market.outcome_prices)), else_=0).between(1, MAX_MARKET_OUTCOMES),
    )
    array = case(
        (bounded, market.outcome_prices),
        else_=literal_column("'[]'::json") if postgres else "[]",
    )
    elements = (
        func.json_array_elements(array).table_valued("value")
        if postgres
        else func.json_each(array).table_valued("value", "type")
    )
    numeric = (
        func.json_typeof(elements.c.value) == "number"
        if postgres
        else elements.c.type.in_(("integer", "real"))
    )
    price = case((numeric, cast(cast(elements.c.value, SA_String), Float)))
    malformed = or_(~numeric, price < 0, price > 1)
    valid = and_(
        bounded,
        first_numeric,
        ~exists(select(1).select_from(elements).where(malformed)),
        exists(select(1).select_from(elements).where(price > 0)),
    )
    return first, valid


def _topic_aggregates(db: AsyncSession):
    """Return source-level counts and weighted topic sums, never market objects.

    SQL JSON type checks apply the shared price rule to every admitted outcome:
    every price is numeric and within [0, 1], and at least one is positive.
    Both PostgreSQL and SQLite use bounded, correlated JSON expansion.
    """
    market = PredictionMarket
    price, numeric = _observed_price_sql(market, db)
    weight = case((market.volume >= 1, market.volume), else_=1.0)
    columns = [market.source, func.count(market.id).label("source_count"),
               func.max(market.updated_at).label("latest_updated")]
    for topic, keywords in _TOPIC_KEYWORDS.items():
        matches = _topic_matches(keywords, market=market)
        valid = and_(matches, numeric)
        columns.extend(
            (
                func.sum(case((matches, 1), else_=0)).label(f"{topic}_count"),
                func.sum(case((valid, price * weight), else_=0.0)).label(f"{topic}_weighted"),
                func.sum(case((valid, weight), else_=0.0)).label(f"{topic}_weight"),
            )
        )
    return (
        select(*columns)
        .where(*snapshot_eligibility(datetime.now(UTC)))
        .group_by(market.source)
    )


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
        rows = (await db.execute(_topic_aggregates(db))).all()
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
    market = active_market_candidates(datetime.now(UTC))
    price, numeric = _observed_price_sql(market, db)
    weight = case((market.volume >= 1, market.volume), else_=1.0)
    try:
        rows = (await db.execute(
            select(
                market.source,
                func.count(market.id).label("n_markets"),
                func.sum(case((numeric, price * weight), else_=0.0)).label("weighted"),
                func.sum(case((numeric, weight), else_=0.0)).label("weight"),
                func.sum(case((numeric, market.volume))).label("volume"),
                func.max(case((numeric, market.url))).label("url"),
                func.sum(case((numeric, 1), else_=0)).label("priced_count"),
            )
            .where(func.lower(market.question).contains(query.lower(), autoescape=True))
            .group_by(market.source)
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
            volume=float(row.volume) if row.volume is not None else None,
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

    Reads the intraday micro-snapshot table and compares the latest admissible
    current observation against the latest admissible baseline at or before the
    window cutoff. Each leg must sit inside ``window ± tolerance`` of its own
    edge, so a 49-hour pair can never be reported as a 1-hour move and the
    disclosed ``elapsed_seconds`` always agrees with the SQL bounds.

    ``status`` distinguishes an unreadable store (``unavailable``), no
    observations (``empty``), no admissible baseline (``no_baseline``), partial
    coverage (``stale``) and a fully evaluated window (``complete``). HTTP 200
    is retained, but ``count == 0`` only licenses a no-movement claim when
    ``status`` is ``complete`` and ``evaluated_markets > 0``.
    """
    window_hours = _resolve_window_hours(window_hours, window, 1)
    # One clock for universe eligibility, both sampling bounds, coverage and the
    # elapsed assertion. Nothing below may call ``datetime.now()`` again.
    now = datetime.now(UTC)
    cutoff = now - timedelta(hours=window_hours)
    tolerance = PREDICTION_MARKET_ALERT_BASELINE_TOLERANCE
    span = timedelta(hours=window_hours)

    def _response(*, status: AlertStatus, coverage=None, observed_through=None, alerts=()) -> PredictionMarketAlertsResponse:
        return PredictionMarketAlertsResponse(
            window_hours=window_hours,
            min_movement_bps=min_movement_bps,
            count=len(alerts),
            alerts=list(alerts),
            status=status,
            coverage=coverage,
            cadence_minutes=PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES,
            baseline_tolerance_seconds=int(tolerance.total_seconds()),
            evaluated_at=now,
            data_observed_through=observed_through,
        )

    try:
        current, baseline = _alert_legs_query(
            PredictionMarketIntradaySnapshot, cutoff=cutoff, now=now, tolerance=tolerance,
        )
        coverage, observed_through = await _alert_coverage(db, current, baseline)
        rows = (await db.execute(_alert_rows(
            current, baseline, threshold=min_movement_bps / 10_000.0, limit=limit,
        ))).all()
    except (OperationalError, ProgrammingError) as error:
        # Only a genuinely absent intraday relation is an expected "no store";
        # every other storage failure must surface as a server error rather
        # than as an ordinary empty alert list.
        if not _is_missing_prediction_market_relation(error):
            raise
        return _response(status="unavailable")

    if coverage.comparable_markets == 0 and coverage.current_markets == 0:
        return _response(status="empty", coverage=coverage)
    if coverage.comparable_markets == 0:
        return _response(status="no_baseline", coverage=coverage)

    alerts = []
    for row in rows:
        elapsed = int((row.current_observed_at - row.baseline_observed_at).total_seconds())
        # The disclosed quantity must agree with the SQL bounds even if a future
        # query edit, clock skew or naive/aware mixing slips through.
        if not span - tolerance <= timedelta(seconds=elapsed) <= span + tolerance:
            continue
        alerts.append(PredictionMarketAlertRow(
            source=row.source, source_id=row.source_id, question=row.question,
            category=row.category, url=row.url, yes_price=row.yes_price,
            previous_yes_price=row.previous_yes_price, movement=row.movement,
            absolute_movement=abs(row.movement),
            direction="up" if row.movement > 0 else "down",
            baseline_observed_at=row.baseline_observed_at,
            current_observed_at=row.current_observed_at,
            elapsed_seconds=elapsed,
        ))

    status: AlertStatus = (
        "complete"
        if coverage.evaluated_markets == coverage.comparable_markets == coverage.current_markets
        else "stale"
    )
    return _response(
        status=status, coverage=coverage, observed_through=observed_through, alerts=alerts,
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
    """Return retained observations rather than inferring odds from today's quote.

    Nightly and intraday records are written only for genuine eligible markets.
    A catalogue row may lose its price vector or be pruned before its recorded
    observations expire; an existing synthetic catalogue row remains excluded.
    Intraday observations take precedence at duplicate timestamps.
    """
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    try:
        observations = {}
        for model, row_limit in (
            (PredictionMarketSnapshot, 90),
            (PredictionMarketIntradaySnapshot, 7 * 24 * 4),
        ):
            rows = (await db.execute(
                select(model).where(
                    model.source == source,
                    model.source_id == source_id,
                    model.captured_at >= cutoff,
                    model.yes_price.is_not(None),
                    ~exists(select(PredictionMarket.id).where(
                        PredictionMarket.source == model.source,
                        PredictionMarket.source_id == model.source_id,
                        PredictionMarket.is_synthetic.is_(True),
                    )),
                ).order_by(model.captured_at.desc()).limit(row_limit)
            )).scalars().all()
            for row in rows:
                observations[row.captured_at] = row
        rows = [observations[at] for at in sorted(observations)]
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
        rows = (await db.execute(_topic_aggregates(db))).all()
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


@router.get("/{source}/{source_id}", response_model=PredictionMarketRead)
async def get_prediction_market_detail(
    source: str = Path(..., pattern=r"^[a-z][a-z0-9_-]{1,31}$"),
    source_id: str = Path(..., min_length=1, max_length=128),
    db: AsyncSession = Depends(get_db),
) -> PredictionMarketRead:
    market = (await db.execute(select(PredictionMarket).where(
        PredictionMarket.source == source,
        PredictionMarket.source_id == source_id,
        *snapshot_eligibility(datetime.now(UTC)),
    ).limit(1))).scalar_one_or_none()
    if market is None:
        raise HTTPException(status_code=404, detail="Current market data unavailable")
    return PredictionMarketRead.model_validate(market)
