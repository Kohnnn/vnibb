"""Data quality coverage and freshness checks for scheduled monitoring."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from vnibb.core.database import async_session_maker
from vnibb.models.news import CompanyEvent, CompanyNews
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio

logger = logging.getLogger(__name__)


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


async def run_data_quality_check(
    top_limit: int = 200,
    max_stale_days: int = 7,
    output_path: str | None = None,
    thresholds: QualityThresholds | None = None,
) -> dict[str, Any]:
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
            select(CompanyNews.symbol)
            .where(CompanyNews.symbol.in_(symbols))
            .group_by(CompanyNews.symbol)
        )

        event_rows = await session.execute(
            select(CompanyEvent.symbol)
            .where(CompanyEvent.symbol.in_(symbols))
            .group_by(CompanyEvent.symbol)
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

    warnings: list[str] = []
    for key, target in targets.items():
        if metrics[key] < target:
            warnings.append(f"{key} below target ({metrics[key]}/{target})")

    stale_cutoff = datetime.utcnow() - timedelta(days=max_stale_days)
    freshness = {
        "latest_price": _to_iso(latest_price_value),
        "latest_ratio": _to_iso(latest_ratio_value),
        "latest_news": _to_iso(latest_news_value),
        "latest_event": _to_iso(latest_event_value),
    }

    latest_ratio_dt = latest_ratio_value
    if isinstance(latest_ratio_dt, datetime) and latest_ratio_dt < stale_cutoff:
        warnings.append("financial_ratios freshness exceeded 7 days")

    report = {
        "generated_at": datetime.utcnow().isoformat(),
        "top_limit": top_limit,
        "targets": targets,
        "metrics": metrics,
        "freshness": freshness,
        "warnings": warnings,
        "status": "warning" if warnings else "ok",
    }

    if output_path:
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(json.dumps(report, indent=2), encoding="utf-8")

    return report


async def run_scheduled_data_quality_check() -> None:
    output_file = Path(__file__).resolve().parents[2] / "scripts" / "data_quality_daily.json"
    report = await run_data_quality_check(output_path=str(output_file))
    if report["warnings"]:
        logger.warning("Data quality check produced warnings: %s", "; ".join(report["warnings"]))
    else:
        logger.info("Data quality check passed with all targets satisfied")
