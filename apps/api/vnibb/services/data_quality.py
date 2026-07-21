from __future__ import annotations

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
from vnibb.models.data_quality import DataQualityBreachState, DataQualityRun
from vnibb.models.news import CompanyEvent, CompanyNews
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio

logger = logging.getLogger(__name__)
QUALITY_SOURCE = "vietcap"
QUALITY_DATASET = "eod"


@dataclass(frozen=True)
class QualityThresholds:
    top_with_prices: int = 200
    top_with_5y_prices: int = 80
    top_with_ratios: int = 120
    top_with_company_news: int = 50
    top_with_company_events: int = 30


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _configured_market_holidays() -> set[date]:
    return {date.fromisoformat(value) for value in settings.market_holiday_dates}


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
    summary_counts: dict[str, int],
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
        "summary_counts": run.summary_counts,
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
    try:
        limits = thresholds or QualityThresholds()
        symbols = await _get_top_symbols(top_limit)
        threshold_5y = date.today().replace(year=date.today().year - 5) + timedelta(days=30)
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
        top_with_5y = sum(1 for row in price_span if row.min_date and row.min_date <= threshold_5y)
        metrics = {
            "top_with_prices": len(price_span),
            "top_with_5y_prices": top_with_5y,
            "top_with_ratios": len(ratio_rows.fetchall()),
            "top_with_company_news": len(news_rows.fetchall()),
            "top_with_company_events": len(event_rows.fetchall()),
        }
        targets = {
            "top_with_prices": limits.top_with_prices,
            "top_with_5y_prices": limits.top_with_5y_prices,
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
        report = {
            "generated_at": datetime.utcnow().isoformat(),
            "run_id": stable_run_id,
            "top_limit": top_limit,
            "targets": targets,
            "metrics": metrics,
            "freshness": freshness,
            "observed_market_date": observed_market_date.isoformat(),
            "market_day_staleness": market_staleness,
            "calendar": {
                "holiday_source": "MARKET_HOLIDAY_DATES",
                "limitation": "Only configured exchange closures are excluded.",
            },
            "warnings": warnings,
            "status": "warning" if warnings else "ok",
        }
        summary_counts = metrics | {"warning_count": len(warnings)}
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
                summary_counts={"warning_count": 0},
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
