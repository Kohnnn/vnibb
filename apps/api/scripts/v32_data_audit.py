#!/usr/bin/env python3
"""
Sprint V32 data completeness audit.

Produces:
- table-level row counts
- top-symbol coverage for prices/ratios/news/events
- core-symbol historical span
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Select, func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from vnibb.core.database import async_session_maker
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.market_news import MarketNews
from vnibb.models.news import CompanyEvent, CompanyNews
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio


@dataclass
class CoverageSummary:
    total_stocks: int
    top_symbols: int
    top_with_prices: int
    top_with_5y_prices: int
    top_with_ratios: int
    top_with_company_news: int
    top_with_company_events: int
    oldest_price_in_top: str | None
    latest_price_in_top: str | None
    latest_ratio_update: str | None
    latest_company_news: str | None
    latest_company_event: str | None


def to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


async def scalar(stmt: Select[Any]) -> Any:
    async with async_session_maker() as session:
        result = await session.execute(stmt)
        return result.scalar()


async def table_count(model: Any) -> int:
    result = await scalar(select(func.count()).select_from(model))
    return int(result or 0)


async def get_top_symbols(limit: int) -> list[str]:
    async with async_session_maker() as session:
        latest = await session.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
        snapshot_date = latest.scalar()
        if snapshot_date:
            rows = await session.execute(
                select(ScreenerSnapshot.symbol)
                .where(ScreenerSnapshot.snapshot_date == snapshot_date)
                .order_by(ScreenerSnapshot.market_cap.desc().nullslast())
                .limit(limit)
            )
            symbols = [row[0] for row in rows.fetchall() if row[0]]
            if symbols:
                return symbols

        rows = await session.execute(
            select(Stock.symbol).where(Stock.is_active == 1).order_by(Stock.symbol.asc()).limit(limit)
        )
        return [row[0] for row in rows.fetchall() if row[0]]


async def coverage_for_symbols(symbols: list[str]) -> CoverageSummary:
    if not symbols:
        return CoverageSummary(
            total_stocks=0,
            top_symbols=0,
            top_with_prices=0,
            top_with_5y_prices=0,
            top_with_ratios=0,
            top_with_company_news=0,
            top_with_company_events=0,
            oldest_price_in_top=None,
            latest_price_in_top=None,
            latest_ratio_update=None,
            latest_company_news=None,
            latest_company_event=None,
        )

    total_stocks = int(await scalar(select(func.count()).select_from(Stock).where(Stock.is_active == 1)) or 0)

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
            select(FinancialRatio.symbol, func.max(FinancialRatio.updated_at))
            .where(FinancialRatio.symbol.in_(symbols))
            .group_by(FinancialRatio.symbol)
        )
        ratio_cov = ratio_rows.fetchall()

        news_rows = await session.execute(
            select(CompanyNews.symbol, func.max(CompanyNews.published_date))
            .where(CompanyNews.symbol.in_(symbols))
            .group_by(CompanyNews.symbol)
        )
        news_cov = news_rows.fetchall()

        event_rows = await session.execute(
            select(CompanyEvent.symbol, func.max(CompanyEvent.event_date))
            .where(CompanyEvent.symbol.in_(symbols))
            .group_by(CompanyEvent.symbol)
        )
        event_cov = event_rows.fetchall()

    threshold_5y = date.today().replace(year=date.today().year - 5)
    min_dates = [row.min_date for row in price_span if row.min_date is not None]
    max_dates = [row.max_date for row in price_span if row.max_date is not None]

    top_with_5y = sum(1 for row in price_span if row.min_date and row.min_date <= threshold_5y)

    latest_ratio_update = max((row[1] for row in ratio_cov if row[1] is not None), default=None)
    latest_company_news = max((row[1] for row in news_cov if row[1] is not None), default=None)
    latest_company_event = max((row[1] for row in event_cov if row[1] is not None), default=None)

    return CoverageSummary(
        total_stocks=total_stocks,
        top_symbols=len(symbols),
        top_with_prices=len(price_span),
        top_with_5y_prices=top_with_5y,
        top_with_ratios=len(ratio_cov),
        top_with_company_news=len(news_cov),
        top_with_company_events=len(event_cov),
        oldest_price_in_top=to_iso(min(min_dates) if min_dates else None),
        latest_price_in_top=to_iso(max(max_dates) if max_dates else None),
        latest_ratio_update=to_iso(latest_ratio_update),
        latest_company_news=to_iso(latest_company_news),
        latest_company_event=to_iso(latest_company_event),
    )


async def core_symbol_spans(symbols: list[str]) -> list[dict[str, Any]]:
    async with async_session_maker() as session:
        rows = await session.execute(
            select(
                StockPrice.symbol,
                func.min(StockPrice.time).label("min_date"),
                func.max(StockPrice.time).label("max_date"),
                func.count().label("rows"),
            )
            .where(StockPrice.symbol.in_(symbols))
            .group_by(StockPrice.symbol)
            .order_by(StockPrice.symbol.asc())
        )
        return [
            {
                "symbol": row.symbol,
                "min_date": to_iso(row.min_date),
                "max_date": to_iso(row.max_date),
                "rows": int(row.rows),
            }
            for row in rows.fetchall()
        ]


async def build_report(top_limit: int, core_symbols: list[str]) -> dict[str, Any]:
    top_symbols = await get_top_symbols(top_limit)
    summary = await coverage_for_symbols(top_symbols)
    core_spans = await core_symbol_spans(core_symbols)

    table_counts = {
        "stocks": await table_count(Stock),
        "stock_prices": await table_count(StockPrice),
        "income_statements": await table_count(IncomeStatement),
        "balance_sheets": await table_count(BalanceSheet),
        "cash_flows": await table_count(CashFlow),
        "financial_ratios": await table_count(FinancialRatio),
        "market_news": await table_count(MarketNews),
        "company_news": await table_count(CompanyNews),
        "company_events": await table_count(CompanyEvent),
    }

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "top_limit": top_limit,
        "table_counts": table_counts,
        "top_symbol_coverage": asdict(summary),
        "core_symbol_spans": core_spans,
        "top_symbols_sample": top_symbols[: min(15, len(top_symbols))],
    }


def print_report(report: dict[str, Any]) -> None:
    coverage = report["top_symbol_coverage"]
    print("# V32 Data Audit")
    print(f"- Generated: `{report['generated_at']}`")
    print(f"- Top-symbol scope: `{coverage['top_symbols']}`")
    print("")
    print("## Table Counts")
    for key, value in report["table_counts"].items():
        print(f"- {key}: `{value}`")
    print("")
    print("## Top Symbol Coverage")
    for key in [
        "total_stocks",
        "top_with_prices",
        "top_with_5y_prices",
        "top_with_ratios",
        "top_with_company_news",
        "top_with_company_events",
        "oldest_price_in_top",
        "latest_price_in_top",
        "latest_ratio_update",
        "latest_company_news",
        "latest_company_event",
    ]:
        print(f"- {key}: `{coverage.get(key)}`")
    print("")
    print("## Core Symbol Price Spans")
    for row in report["core_symbol_spans"]:
        print(
            f"- {row['symbol']}: {row['min_date']} -> {row['max_date']} "
            f"({row['rows']} rows)"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Sprint V32 data completeness audit")
    parser.add_argument("--top-limit", type=int, default=200, help="Top symbols to include")
    parser.add_argument(
        "--core-symbols",
        type=str,
        default="VNM,FPT,VCB,HPG,VIC",
        help="Comma-separated core symbols for span checks",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default="",
        help="Optional output path for JSON report",
    )
    return parser.parse_args()


async def _main() -> int:
    args = parse_args()
    core_symbols = [s.strip().upper() for s in args.core_symbols.split(",") if s.strip()]
    report = await build_report(args.top_limit, core_symbols)
    print_report(report)

    if args.output_json:
        output = Path(args.output_json)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nSaved JSON report to `{output}`")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
