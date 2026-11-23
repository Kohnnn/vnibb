from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.core.market_calendar import OFFICIAL_MARKET_HOLIDAYS, market_calendar_metadata
from vnibb.models.data_quality import DataQualityBreachState, DataQualityRun
from vnibb.models.news import CompanyEvent, CompanyNews
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio

logger = logging.getLogger(__name__)
QUALITY_SOURCE = "vietcap"
QUALITY_DATASET = "eod"
MONGO_EOD_AUDIT_SYMBOL_LIMIT = 20
MONGO_EOD_AUDIT_LOOKBACK_DAYS = 90
MONGO_EOD_AUDIT_MAX_TIME_MS = 1_500
PRICE_ROW_5Y_METRIC = "top_with_price_row_at_or_before_5y_cutoff"
PRICE_ROW_5Y_CUTOFF_POLICY = "host_date_minus_5y_plus_30d_inclusive"
MONGO_EOD_RUN_OUTCOME_KEY = "mongo_eod_quality"


@dataclass(frozen=True)
class QualityThresholds:
    top_with_prices: int = 200
    top_with_price_row_at_or_before_5y_cutoff: int = 80
    top_with_ratios: int = 120
    top_with_company_news: int = 50
    top_with_company_events: int = 30


def price_row_five_year_cutoff(anchor: date) -> date:
    """Inclusive old-row cutoff with a 30-day allowance, not a session window."""
    if anchor.month == 2 and anchor.day == 29:
        anchor = anchor.replace(day=28)
    return anchor.replace(year=anchor.year - 5) + timedelta(days=30)


def normalize_archived_price_row_metric(counts: dict[str, Any]) -> dict[str, Any]:
    """Read the archive's old metric as one retained row, never as coverage."""
    if "top_with_5y_prices" not in counts:
        return counts
    normalized = dict(counts)
    old_row_count = normalized.pop("top_with_5y_prices")
    normalized.setdefault(PRICE_ROW_5Y_METRIC, old_row_count)
    return normalized


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _configured_market_holidays() -> set[date]:
    return OFFICIAL_MARKET_HOLIDAYS | {date.fromisoformat(value) for value in settings.market_holiday_dates}


def is_market_business_day(anchor: date, holidays: Iterable[date] = ()) -> bool:
    return anchor.weekday() < 5 and anchor not in set(holidays)


def latest_market_business_day(anchor: date, holidays: Iterable[date] = ()) -> date:
    holiday_dates = set(holidays)
    while not is_market_business_day(anchor, holiday_dates):
        anchor -= timedelta(days=1)
    return anchor


def market_day_staleness(
    latest_market_date: date | None,
    observed_market_date: date,
    holidays: Iterable[date] = (),
) -> int | None:
    if latest_market_date is None:
        return None
    holiday_dates = set(holidays)
    cursor = latest_market_date
    staleness = 0
    while cursor < observed_market_date:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5 and cursor not in holiday_dates:
            staleness += 1
    return staleness


def _vietcap_freshness_warning(
    latest: date | None,
    max_stale_days: int,
    *,
    today: date | None = None,
    holidays: Iterable[date] = (),
) -> str | None:
    if latest is None:
        return "vietcap_eod corpus empty or unreadable"
    observed_market_date = latest_market_business_day(today or date.today(), holidays)
    staleness = market_day_staleness(latest, observed_market_date, holidays)
    if staleness is not None and staleness > max_stale_days:
        return f"vietcap_eod freshness exceeded {max_stale_days} days (latest {latest.isoformat()})"
    return None


def _market_today() -> date:
    return datetime.now(ZoneInfo(settings.vn_timezone)).date()


async def _get_top_symbols(limit: int) -> list[str]:
    async with async_session_maker() as session:
        snapshot_result = await session.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
        latest_snapshot = snapshot_result.scalar()
        if latest_snapshot:
            rows = await session.execute(
                select(ScreenerSnapshot.symbol)
                .where(
                    ScreenerSnapshot.snapshot_date == latest_snapshot,
                    ScreenerSnapshot.market_cap.is_not(None),
                )
                .order_by(ScreenerSnapshot.market_cap.desc().nullslast())
                .limit(limit)
            )
            symbols = [row[0] for row in rows.fetchall() if row[0]]
            if symbols:
                return symbols
        fallback_rows = await session.execute(
            select(Stock.symbol)
            .where(Stock.is_active == 1)
            .order_by(Stock.symbol.asc())
            .limit(limit)
        )
        return [row[0] for row in fallback_rows.fetchall() if row[0]]


async def _vietcap_corpus_latest_date() -> date | None:
    from vnibb.services.mongo_market_data_service import get_mongo_market_data_service

    service = get_mongo_market_data_service()
    if not service.enabled:
        return None
    return await service.get_source_latest_trade_date(QUALITY_SOURCE)


def _mongo_eod_quality_status(summary: dict[str, int]) -> tuple[str, list[str]]:
    failures = [
        key
        for key in (
            "missing_or_non_vnd_price_unit",
            "invalid_ohlcv",
            "missing_provenance",
            "exact_duplicates",
            "same_source_duplicates",
        )
        if summary.get(key, 0)
    ]
    warnings = ["cross_source_overlaps"] if summary.get("cross_source_overlaps", 0) else []
    if summary.get("audited_documents", 0) == 0:
        warnings.append("empty_sample")
    elif summary.get("coverage_symbols", 0) < summary.get("audited_symbols", 0):
        warnings.append("partial_sample_coverage")
    return ("failed" if failures else "warning" if warnings else "ok", failures + warnings)


def _mongo_eod_sample_coverage(
    requested: int, represented: int | None, *, read_failed: bool = False
) -> dict[str, int | str]:
    if represented is None:
        status = "not_assessed"
    elif represented == 0:
        status = "empty"
    else:
        status = "partial" if represented < requested else "complete"
    return {
        "status": status,
        "requested_symbols": requested,
        "represented_symbols": represented or 0,
        "no_row_symbols": requested - represented if represented is not None else 0,
        "failed_read_symbols": requested if read_failed else 0,
        "unknown_symbols": requested if represented is None and not read_failed else 0,
        "session_eligibility": "not_assessed",
    }


def _mongo_eod_quality_unavailable(
    category: str, symbol_count: int, *, read_outcome: str
) -> dict[str, Any]:
    return {
        "status": category,
        "read_outcome": read_outcome,
        "integrity_status": "not_assessed",
        "admission_status": "not_assessed",
        "freshness_status": "not_assessed",
        "sample_coverage": _mongo_eod_sample_coverage(
            symbol_count, None, read_failed=read_outcome == "read_failed"
        ),
        "summary_counts": {
            "audited_symbols": symbol_count,
            "audited_documents": 0,
            "missing_or_non_vnd_price_unit": 0,
            "invalid_ohlcv": 0,
            "missing_provenance": 0,
            "exact_duplicates": 0,
            "same_source_duplicates": 0,
            "cross_source_overlaps": 0,
            "coverage_symbols": 0,
        },
        "details": {"max_time_ms": MONGO_EOD_AUDIT_MAX_TIME_MS, "category": category},
        "issues": [f"mongo_eod_{category}"],
    }


async def get_mongo_eod_quality_summary(symbols: Iterable[str]) -> dict[str, Any]:
    from vnibb.services.mongo_market_data_service import get_mongo_market_data_service

    sample_symbols = list(dict.fromkeys(str(symbol).upper() for symbol in symbols if symbol))[
        :MONGO_EOD_AUDIT_SYMBOL_LIMIT
    ]
    if not sample_symbols:
        return _mongo_eod_quality_unavailable("no_symbols", 0, read_outcome="no_symbols")
    cutoff = datetime.utcnow() - timedelta(days=MONGO_EOD_AUDIT_LOOKBACK_DAYS)
    match = {
        "symbol": {"$in": sample_symbols},
        "tradeDate": {"$gte": cutoff},
        # Match literal scalar symbols so grouping cannot exceed the requested sample.
        "$expr": {"$eq": [{"$type": "$symbol"}, "string"]},
    }
    converted_fields = {
        f"_{field}": {
            "$convert": {"input": f"${field}", "to": "double", "onError": None, "onNull": None}
        }
        for field in ("open", "high", "low", "close", "volume")
    }
    finite_prices = [
        {"$and": [{"$isNumber": f"${field}"}, {"$gt": [f"${field}", 0]}]}
        for field in ("_open", "_high", "_low", "_close")
    ]
    valid_ohlcv = {
        "$and": [
            *finite_prices,
            {"$gte": ["$_high", "$_open"]},
            {"$gte": ["$_high", "$_low"]},
            {"$gte": ["$_high", "$_close"]},
            {"$lte": ["$_low", "$_open"]},
            {"$lte": ["$_low", "$_high"]},
            {"$lte": ["$_low", "$_close"]},
            {"$isNumber": "$_volume"},
            {"$gte": ["$_volume", 0]},
            {"$eq": ["$_volume", {"$trunc": "$_volume"}]},
        ]
    }

    quality_checks = {
        "missing_or_non_vnd_price_unit": {"$ne": ["$priceUnit", "VND"]},
        "missing_provenance": {
            "$or": [
                check
                for field in ("source", "sourceKey", "updatedAt", "schemaVersion")
                for check in (
                    {"$in": [{"$type": f"${field}"}, ["missing", "null"]]},
                    {"$eq": [f"${field}", ""]},
                )
            ]
        },
        "invalid_ohlcv": {"$not": [valid_ohlcv]},
    }
    date_rows = {"$match": {"$expr": {"$eq": [{"$type": "$tradeDate"}, "date"]}}}
    trade_day = {"$dateToString": {"format": "%Y-%m-%d", "date": "$tradeDate"}}
    pipeline = [
        {"$match": match},
        {
            "$project": {
                "_id": 0,
                "symbol": 1,
                "tradeDate": 1,
                "source": 1,
                "priceUnit": 1,
                "sourceKey": 1,
                "updatedAt": 1,
                "schemaVersion": 1,
                **converted_fields,
            }
        },
        # Every facet consumes the same matched stream, including concurrent arrivals.
        {
            "$facet": {
                "quality_by_symbol": [
                    {"$set": quality_checks},
                    {
                        "$group": {
                            "_id": "$symbol",
                            "documents": {"$sum": 1},
                            "first_trade_date": {"$min": "$tradeDate"},
                            "last_trade_date": {"$max": "$tradeDate"},
                            **{key: {"$sum": {"$cond": [f"${key}", 1, 0]}} for key in quality_checks},
                        }
                    },
                    {"$sort": {"_id": 1}},
                    {
                        "$project": {
                            "_id": 0,
                            "symbol": "$_id",
                            "documents": 1,
                            "first_trade_date": 1,
                            "last_trade_date": 1,
                            **dict.fromkeys(quality_checks, 1),
                        }
                    },
                ],
                "exact_duplicates": [
                    {
                        "$group": {
                            "_id": {"symbol": "$symbol", "date": "$tradeDate", "source": "$source"},
                            "documents": {"$sum": 1},
                        }
                    },
                    {"$match": {"documents": {"$gt": 1}}},
                    {"$count": "groups"},
                ],
                "same_source_duplicates": [
                    date_rows,
                    {
                        "$group": {
                            "_id": {"symbol": "$symbol", "day": trade_day, "source": "$source"},
                            "documents": {"$sum": 1},
                        }
                    },
                    {"$match": {"documents": {"$gt": 1}}},
                    {"$count": "groups"},
                ],
                "cross_source_overlaps": [
                    date_rows,
                    {
                        "$group": {
                            "_id": {"symbol": "$symbol", "day": trade_day},
                            "sources": {"$addToSet": "$source"},
                        }
                    },
                    {"$match": {"$expr": {"$gt": [{"$size": "$sources"}, 1]}}},
                    {"$count": "groups"},
                ],
            }
        },
    ]

    def _failure(exc: Exception, read_outcome: str) -> dict[str, Any]:
        is_timeout = isinstance(exc, TimeoutError) or getattr(exc, "timeout", False)
        category = "timeout" if is_timeout else "unavailable"
        logger.warning("Mongo EOD quality audit %s (%s: %s)", category, read_outcome, type(exc).__name__)
        return _mongo_eod_quality_unavailable(category, len(sample_symbols), read_outcome=read_outcome)

    def _read() -> dict[str, Any]:
        try:
            service = get_mongo_market_data_service()
            if not service.enabled:
                return _mongo_eod_quality_unavailable(
                    "unavailable", len(sample_symbols), read_outcome="disabled"
                )
            collection = service._get_collection("market_prices_eod")
        except Exception as exc:
            return _failure(exc, "setup_failed")

        try:
            rows = list(collection.aggregate(pipeline, maxTimeMS=MONGO_EOD_AUDIT_MAX_TIME_MS))
        except Exception as exc:
            return _failure(exc, "read_failed")

        facets = rows[0] if rows else {}
        coverage = facets.get("quality_by_symbol", [])
        duplicate_counts = {}
        for key in ("exact_duplicates", "same_source_duplicates", "cross_source_overlaps"):
            groups = facets.get(key, [])
            duplicate_counts[key] = groups[0]["groups"] if groups else 0
        summary = {
            "audited_symbols": len(sample_symbols),
            "audited_documents": sum(row["documents"] for row in coverage),
            **{key: sum(row.get(key, 0) for row in coverage) for key in quality_checks},
            **duplicate_counts,
            "coverage_symbols": len(coverage),
        }
        status, issues = _mongo_eod_quality_status(summary)
        if status == "failed":
            integrity_status = "failed"
        elif not summary["audited_documents"]:
            integrity_status = "not_assessed"
        else:
            integrity_status = "warning" if summary["cross_source_overlaps"] else "ok"
        return {
            "status": status,
            "read_outcome": "observed",
            "integrity_status": integrity_status,
            "admission_status": "not_assessed",
            "freshness_status": "not_assessed",
            "sample_coverage": _mongo_eod_sample_coverage(len(sample_symbols), len(coverage)),
            "summary_counts": summary,
            "details": {
                "max_time_ms": MONGO_EOD_AUDIT_MAX_TIME_MS,
                "lookback_days": MONGO_EOD_AUDIT_LOOKBACK_DAYS,
                "coverage": [
                    {
                        "symbol": row["symbol"],
                        "documents": row["documents"],
                        "first_trade_date": _to_iso(row.get("first_trade_date")),
                        "last_trade_date": _to_iso(row.get("last_trade_date")),
                    }
                    for row in coverage
                ],
            },
            "issues": issues,
        }

    return await asyncio.to_thread(_read)


async def ensure_quality_run(
    session: AsyncSession,
    *,
    run_id: str,
    started_at: datetime,
    source: str = QUALITY_SOURCE,
    dataset: str = QUALITY_DATASET,
) -> DataQualityRun:
    existing = (
        await session.execute(select(DataQualityRun).where(DataQualityRun.run_id == run_id))
    ).scalar_one_or_none()
    if existing:
        return existing
    run = DataQualityRun(
        run_id=run_id,
        started_at=started_at,
        status="running",
        source=source,
        dataset=dataset,
    )
    session.add(run)
    try:
        await session.commit()
        return run
    except IntegrityError:
        await session.rollback()
        return (
            await session.execute(select(DataQualityRun).where(DataQualityRun.run_id == run_id))
        ).scalar_one()


async def complete_quality_run(
    session: AsyncSession,
    *,
    run_id: str,
    status: str,
    completed_at: datetime,
    observed_market_date: date,
    latest_market_date: date | None,
    market_day_staleness_value: int | None,
    summary_counts: dict[str, Any],
    error_category: str | None,
) -> DataQualityRun:
    run = await ensure_quality_run(session, run_id=run_id, started_at=completed_at)
    run.status = status
    run.completed_at = completed_at
    run.observed_market_date = observed_market_date
    run.latest_market_date = latest_market_date
    run.market_day_staleness = market_day_staleness_value
    run.summary_counts = summary_counts
    run.error_category = error_category
    await session.commit()
    return run


async def update_sustained_breach_state(
    session: AsyncSession,
    *,
    source: str,
    dataset: str,
    category: str,
    breached: bool,
    observed_at: datetime,
    observed_market_date: date | None = None,
    market_day: bool | None = None,
    holidays: Iterable[date] = (),
) -> bool:
    observed_date = observed_at.date()
    observed_market_date = observed_market_date or latest_market_business_day(observed_date, holidays)
    if market_day is None:
        market_day = is_market_business_day(observed_date, holidays)
    if not market_day:
        return False
    breach_key = f"{source}:{dataset}:{category}"
    state = (
        await session.execute(
            select(DataQualityBreachState).where(DataQualityBreachState.breach_key == breach_key)
        )
    ).scalar_one_or_none()
    if state and (
        latest_market_business_day(state.last_seen_at.date(), holidays) >= observed_market_date
        or (
            state.resolved_at is not None
            and latest_market_business_day(state.resolved_at.date(), holidays) >= observed_market_date
        )
    ):
        return False
    if not breached:
        if state and state.resolved_at is None:
            state.resolved_at = observed_at
            state.consecutive_runs = 0
            await session.commit()
        return False
    if state is None:
        state = DataQualityBreachState(
            breach_key=breach_key,
            source=source,
            dataset=dataset,
            category=category,
            first_seen_at=observed_at,
            last_seen_at=observed_at,
            consecutive_runs=1,
        )
        session.add(state)
    elif state.resolved_at is not None:
        state.first_seen_at = observed_at
        state.last_seen_at = observed_at
        state.consecutive_runs = 1
        state.sustained_at = None
        state.resolved_at = None
    else:
        state.last_seen_at = observed_at
        state.consecutive_runs += 1
    newly_sustained = False
    if state.consecutive_runs >= settings.data_quality_sustained_breach_runs and state.sustained_at is None:
        state.sustained_at = observed_at
        newly_sustained = True
    await session.commit()
    return newly_sustained


async def get_last_successful_quality_run(
    session: AsyncSession,
    *,
    source: str = QUALITY_SOURCE,
    dataset: str = QUALITY_DATASET,
) -> DataQualityRun | None:
    return (
        await session.execute(
            select(DataQualityRun)
            .where(
                DataQualityRun.source == source,
                DataQualityRun.dataset == dataset,
                DataQualityRun.status == "ok",
            )
            .order_by(DataQualityRun.completed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def get_latest_quality_run(
    session: AsyncSession,
    *,
    source: str = QUALITY_SOURCE,
    dataset: str = QUALITY_DATASET,
) -> DataQualityRun | None:
    return (
        await session.execute(
            select(DataQualityRun)
            .where(
                DataQualityRun.source == source,
                DataQualityRun.dataset == dataset,
                DataQualityRun.completed_at.is_not(None),
            )
            .order_by(DataQualityRun.completed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def get_quality_run_trend(
    session: AsyncSession,
    *,
    market_days: int = 30,
    source: str = QUALITY_SOURCE,
    dataset: str = QUALITY_DATASET,
) -> list[DataQualityRun]:
    rows = (
        await session.execute(
            select(DataQualityRun)
            .where(
                DataQualityRun.source == source,
                DataQualityRun.dataset == dataset,
                DataQualityRun.completed_at.is_not(None),
                DataQualityRun.observed_market_date.is_not(None),
            )
            .order_by(DataQualityRun.observed_market_date.desc(), DataQualityRun.completed_at.desc())
        )
    ).scalars()
    trend: list[DataQualityRun] = []
    observed_dates: set[date] = set()
    for run in rows:
        if run.observed_market_date in observed_dates:
            continue
        observed_dates.add(run.observed_market_date)
        trend.append(run)
        if len(trend) == market_days:
            break
    return trend


def serialize_quality_run(run: DataQualityRun | None) -> dict[str, Any] | None:
    if run is None:
        return None
    counts = (
        dict(normalize_archived_price_row_metric(run.summary_counts))
        if run.summary_counts is not None
        else None
    )
    mongo_outcome = counts.pop(MONGO_EOD_RUN_OUTCOME_KEY, None) if counts is not None else None
    return {
        "run_id": run.run_id,
        "started_at": _to_iso(run.started_at),
        "completed_at": _to_iso(run.completed_at),
        "status": run.status,
        "source": run.source,
        "dataset": run.dataset,
        "observed_market_date": _to_iso(run.observed_market_date),
        "latest_market_date": _to_iso(run.latest_market_date),
        "market_day_staleness": run.market_day_staleness,
        "historical_session_coverage_status": "not_assessed",
        "summary_counts": counts,
        "mongo_eod_quality": mongo_outcome,
        "error_category": run.error_category,
    }


async def run_data_quality_check(
    top_limit: int = 200,
    max_stale_days: int = 7,
    vietcap_max_stale_days: int = 5,
    output_path: str | None = None,
    thresholds: QualityThresholds | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    started_at = datetime.utcnow()
    stable_run_id = run_id or f"manual-data-quality:{uuid4()}"
    holidays = _configured_market_holidays()
    market_today = _market_today()
    observed_market_date = latest_market_business_day(market_today, holidays)
    market_day = is_market_business_day(market_today, holidays)
    async with async_session_maker() as session:
        await ensure_quality_run(session, run_id=stable_run_id, started_at=started_at)
    summary_counts: dict[str, Any] = {"warning_count": 0}
    try:
        limits = thresholds or QualityThresholds()
        symbols = await _get_top_symbols(top_limit)
        price_row_cutoff = price_row_five_year_cutoff(date.today())
        async with async_session_maker() as session:
            price_rows = await session.execute(
                select(
                    StockPrice.symbol,
                    func.min(StockPrice.time).label("min_date"),
                    func.max(StockPrice.time).label("max_date"),
                )
                .where(StockPrice.symbol.in_(symbols))
                .group_by(StockPrice.symbol)
            )
            price_span = price_rows.fetchall()
            ratio_rows = await session.execute(
                select(FinancialRatio.symbol)
                .where(
                    FinancialRatio.symbol.in_(symbols),
                    (
                        FinancialRatio.pe_ratio.is_not(None)
                        | FinancialRatio.pb_ratio.is_not(None)
                        | FinancialRatio.roe.is_not(None)
                        | FinancialRatio.roa.is_not(None)
                    ),
                )
                .group_by(FinancialRatio.symbol)
            )
            news_rows = await session.execute(
                select(CompanyNews.symbol).where(CompanyNews.symbol.in_(symbols)).group_by(CompanyNews.symbol)
            )
            event_rows = await session.execute(
                select(CompanyEvent.symbol).where(CompanyEvent.symbol.in_(symbols)).group_by(CompanyEvent.symbol)
            )
            latest_price = await session.execute(select(func.max(StockPrice.time)))
            latest_ratio = await session.execute(select(func.max(FinancialRatio.updated_at)))
            latest_news = await session.execute(select(func.max(CompanyNews.published_date)))
            latest_event = await session.execute(select(func.max(CompanyEvent.event_date)))
        latest_price_value = latest_price.scalar()
        latest_ratio_value = latest_ratio.scalar()
        latest_news_value = latest_news.scalar()
        latest_event_value = latest_event.scalar()
        top_with_old_price_row = sum(
            1 for row in price_span if row.min_date is not None and row.min_date <= price_row_cutoff
        )
        metrics = {
            "top_with_prices": len(price_span),
            PRICE_ROW_5Y_METRIC: top_with_old_price_row,
            "top_with_ratios": len(ratio_rows.fetchall()),
            "top_with_company_news": len(news_rows.fetchall()),
            "top_with_company_events": len(event_rows.fetchall()),
        }
        targets = {
            "top_with_prices": limits.top_with_prices,
            PRICE_ROW_5Y_METRIC: limits.top_with_price_row_at_or_before_5y_cutoff,
            "top_with_ratios": limits.top_with_ratios,
            "top_with_company_news": limits.top_with_company_news,
            "top_with_company_events": limits.top_with_company_events,
        }
        warnings = [
            f"{key} below target ({metrics[key]}/{target})"
            for key, target in targets.items()
            if metrics[key] < target
        ]
        stale_cutoff = datetime.utcnow() - timedelta(days=max_stale_days)
        freshness = {
            "latest_price": _to_iso(latest_price_value),
            "latest_ratio": _to_iso(latest_ratio_value),
            "latest_news": _to_iso(latest_news_value),
            "latest_event": _to_iso(latest_event_value),
        }
        if isinstance(latest_ratio_value, datetime) and latest_ratio_value < stale_cutoff:
            warnings.append(f"financial_ratios freshness exceeded {max_stale_days} days")
        mongo_eod_quality = await get_mongo_eod_quality_summary(symbols)
        if mongo_eod_quality["status"] != "ok":
            warnings.extend(mongo_eod_quality["issues"])
        # Keep the sample observation even if the independent Vietcap freshness read fails.
        summary_counts = metrics | mongo_eod_quality["summary_counts"] | {
            "warning_count": len(warnings),
            MONGO_EOD_RUN_OUTCOME_KEY: {
                key: mongo_eod_quality[key]
                for key in ("status", "read_outcome", "integrity_status", "sample_coverage")
            },
        }
        vietcap_latest = await _vietcap_corpus_latest_date()
        market_staleness = market_day_staleness(vietcap_latest, observed_market_date, holidays)
        freshness["vietcap_eod"] = _to_iso(vietcap_latest)
        vietcap_warning = _vietcap_freshness_warning(
            vietcap_latest,
            vietcap_max_stale_days,
            today=_market_today(),
            holidays=holidays,
        )
        if vietcap_warning:
            warnings.append(vietcap_warning)
            summary_counts["warning_count"] = len(warnings)
        report = {
            "generated_at": datetime.utcnow().isoformat(),
            "run_id": stable_run_id,
            "top_limit": top_limit,
            "targets": targets,
            "metrics": metrics,
            "price_row_five_year_cutoff": price_row_cutoff.isoformat(),
            "price_row_five_year_cutoff_policy": PRICE_ROW_5Y_CUTOFF_POLICY,
            "historical_session_coverage_status": "not_assessed",
            "freshness": freshness,
            "mongo_eod_quality": mongo_eod_quality,
            "observed_market_date": observed_market_date.isoformat(),
            "market_day_staleness": market_staleness,
            "calendar": market_calendar_metadata(market_today),
            "warnings": warnings,
            "status": "failed" if mongo_eod_quality["status"] == "failed" else "warning" if warnings else "ok",
        }
        completed_at = datetime.utcnow()
        async with async_session_maker() as session:
            await complete_quality_run(
                session,
                run_id=stable_run_id,
                status=report["status"],
                completed_at=completed_at,
                observed_market_date=observed_market_date,
                latest_market_date=vietcap_latest,
                market_day_staleness_value=market_staleness,
                summary_counts=summary_counts,
                error_category="freshness_breach" if vietcap_warning else None,
            )
            newly_sustained = await update_sustained_breach_state(
                session,
                source=QUALITY_SOURCE,
                dataset=QUALITY_DATASET,
                category="market_day_staleness",
                breached=vietcap_warning is not None,
                observed_at=completed_at,
                observed_market_date=observed_market_date,
                market_day=market_day,
                holidays=holidays,
            )
        report["sustained_breach_new"] = newly_sustained
        if output_path:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)
            output_file.write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report
    except Exception as exc:
        async with async_session_maker() as session:
            await complete_quality_run(
                session,
                run_id=stable_run_id,
                status="failed",
                completed_at=datetime.utcnow(),
                observed_market_date=observed_market_date,
                latest_market_date=None,
                market_day_staleness_value=None,
                summary_counts=summary_counts,
                error_category=type(exc).__name__[:64],
            )
        raise


async def run_scheduled_data_quality_check() -> None:
    output_file = Path(__file__).resolve().parents[2] / "scripts" / "data_quality_daily.json"
    run_date = _market_today().isoformat()
    report = await run_data_quality_check(
        output_path=str(output_file),
        run_id=f"daily-data-quality:{run_date}",
    )
    if report["warnings"]:
        logger.warning("Data quality check produced warnings: %s", "; ".join(report["warnings"]))
    else:
        logger.info("Data quality check passed with all targets satisfied")
    if report["sustained_breach_new"]:
        logger.error("Data quality sustained breach recorded without delivery integration")
