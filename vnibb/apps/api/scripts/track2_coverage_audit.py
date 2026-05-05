#!/usr/bin/env python3
"""Track 2 completeness audit for core VN symbols."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from vnibb.core.database import async_session_maker
from vnibb.models.company import Company, Shareholder
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.news import Dividend
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio

DEFAULT_SYMBOLS = "VNM,FPT,TCB,HPG,SHS,VIC,BID,CTG,MBB,VPB,ACB,STB,HDB,TPB,SSI,VND,BSR,GAS,PLX,PNJ"


@dataclass
class PeriodCoverage:
    rows: int
    latest_period: str | None


@dataclass
class DateCoverage:
    rows: int
    latest_date: str | None


@dataclass
class SymbolCoverage:
    symbol: str
    stock_sector: str | None
    company_sector: str | None
    price_earliest: str | None
    price_latest: str | None
    price_days: int
    income_rows: int
    income_latest_period: str | None
    balance_rows: int
    balance_latest_period: str | None
    cashflow_rows: int
    cashflow_latest_period: str | None
    ratio_rows: int
    ratio_latest_period: str | None
    dividend_rows: int
    dividend_latest_date: str | None
    shareholder_rows: int
    shareholder_latest_date: str | None


def parse_symbols(raw: str) -> list[str]:
    return [symbol.strip().upper() for symbol in raw.split(",") if symbol.strip()]


def to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def normalize_period(period: Any, fiscal_year: Any, fiscal_quarter: Any) -> str | None:
    if period not in (None, ""):
        return str(period)
    if fiscal_year is None:
        return None
    if fiscal_quarter not in (None, 0):
        return f"Q{int(fiscal_quarter)}-{int(fiscal_year)}"
    return str(int(fiscal_year))


async def load_sector_maps(
    symbols: list[str],
) -> tuple[dict[str, str | None], dict[str, str | None]]:
    async with async_session_maker() as session:
        stock_rows = await session.execute(
            select(Stock.symbol, Stock.sector).where(Stock.symbol.in_(symbols))
        )
        company_rows = await session.execute(
            select(Company.symbol, Company.sector).where(Company.symbol.in_(symbols))
        )

    stock_map = {str(symbol).upper(): sector for symbol, sector in stock_rows.fetchall()}
    company_map = {str(symbol).upper(): sector for symbol, sector in company_rows.fetchall()}
    return stock_map, company_map


async def load_price_coverage(symbols: list[str]) -> dict[str, dict[str, Any]]:
    async with async_session_maker() as session:
        rows = await session.execute(
            select(
                StockPrice.symbol,
                func.min(StockPrice.time).label("earliest"),
                func.max(StockPrice.time).label("latest"),
                func.count(func.distinct(StockPrice.time)).label("trading_days"),
            )
            .where(StockPrice.symbol.in_(symbols), StockPrice.interval == "1D")
            .group_by(StockPrice.symbol)
        )

    return {
        str(row.symbol).upper(): {
            "earliest": row.earliest,
            "latest": row.latest,
            "trading_days": int(row.trading_days or 0),
        }
        for row in rows.fetchall()
    }


async def load_period_coverage(model: Any, symbols: list[str]) -> dict[str, PeriodCoverage]:
    async with async_session_maker() as session:
        rows = await session.execute(
            select(model.symbol, model.period, model.fiscal_year, model.fiscal_quarter).where(
                model.symbol.in_(symbols)
            )
        )

    grouped: dict[str, list[tuple[Any, Any, Any]]] = {symbol: [] for symbol in symbols}
    for row in rows.fetchall():
        grouped[str(row.symbol).upper()].append((row.period, row.fiscal_year, row.fiscal_quarter))

    result: dict[str, PeriodCoverage] = {}
    for symbol in symbols:
        entries = grouped.get(symbol, [])
        if not entries:
            result[symbol] = PeriodCoverage(rows=0, latest_period=None)
            continue

        sorted_entries = sorted(
            entries,
            key=lambda entry: (int(entry[1] or 0), int(entry[2] or 0)),
            reverse=True,
        )
        latest = sorted_entries[0]
        result[symbol] = PeriodCoverage(
            rows=len(entries),
            latest_period=normalize_period(latest[0], latest[1], latest[2]),
        )

    return result


async def load_date_coverage(
    model: Any,
    date_column: Any,
    symbols: list[str],
) -> dict[str, DateCoverage]:
    async with async_session_maker() as session:
        rows = await session.execute(
            select(
                model.symbol,
                func.count().label("rows"),
                func.max(date_column).label("latest_date"),
            )
            .where(model.symbol.in_(symbols))
            .group_by(model.symbol)
        )

    result = {symbol: DateCoverage(rows=0, latest_date=None) for symbol in symbols}
    for row in rows.fetchall():
        result[str(row.symbol).upper()] = DateCoverage(
            rows=int(row.rows or 0),
            latest_date=to_iso(row.latest_date),
        )
    return result


async def load_missing_sector_counts() -> dict[str, int]:
    async with async_session_maker() as session:
        stock_missing = await session.scalar(
            select(func.count()).select_from(Stock).where(Stock.sector.is_(None))
        )
        company_missing = await session.scalar(
            select(func.count()).select_from(Company).where(Company.sector.is_(None))
        )

    return {
        "stocks_missing_sector": int(stock_missing or 0),
        "companies_missing_sector": int(company_missing or 0),
    }


async def build_report(symbols: list[str]) -> dict[str, Any]:
    stock_sector_map, company_sector_map = await load_sector_maps(symbols)
    price_map = await load_price_coverage(symbols)
    income_map = await load_period_coverage(IncomeStatement, symbols)
    balance_map = await load_period_coverage(BalanceSheet, symbols)
    cashflow_map = await load_period_coverage(CashFlow, symbols)
    ratio_map = await load_period_coverage(FinancialRatio, symbols)
    dividend_map = await load_date_coverage(Dividend, Dividend.exercise_date, symbols)
    shareholder_map = await load_date_coverage(Shareholder, Shareholder.as_of_date, symbols)
    missing_sector_counts = await load_missing_sector_counts()

    rows: list[SymbolCoverage] = []
    stale_cutoff = date.today() - timedelta(days=2)
    stale_symbols: list[str] = []
    missing_dividend_symbols: list[str] = []
    missing_shareholder_symbols: list[str] = []
    missing_sector_symbols: list[str] = []

    for symbol in symbols:
        price_row = price_map.get(symbol, {})
        income_row = income_map.get(symbol, PeriodCoverage(rows=0, latest_period=None))
        balance_row = balance_map.get(symbol, PeriodCoverage(rows=0, latest_period=None))
        cashflow_row = cashflow_map.get(symbol, PeriodCoverage(rows=0, latest_period=None))
        ratio_row = ratio_map.get(symbol, PeriodCoverage(rows=0, latest_period=None))
        dividend_row = dividend_map.get(symbol, DateCoverage(rows=0, latest_date=None))
        shareholder_row = shareholder_map.get(symbol, DateCoverage(rows=0, latest_date=None))

        price_latest = price_row.get("latest")
        if price_latest is None or price_latest < stale_cutoff:
            stale_symbols.append(symbol)
        if dividend_row.rows == 0:
            missing_dividend_symbols.append(symbol)
        if shareholder_row.rows == 0:
            missing_shareholder_symbols.append(symbol)
        if not stock_sector_map.get(symbol) and not company_sector_map.get(symbol):
            missing_sector_symbols.append(symbol)

        rows.append(
            SymbolCoverage(
                symbol=symbol,
                stock_sector=stock_sector_map.get(symbol),
                company_sector=company_sector_map.get(symbol),
                price_earliest=to_iso(price_row.get("earliest")),
                price_latest=to_iso(price_latest),
                price_days=int(price_row.get("trading_days") or 0),
                income_rows=income_row.rows,
                income_latest_period=income_row.latest_period,
                balance_rows=balance_row.rows,
                balance_latest_period=balance_row.latest_period,
                cashflow_rows=cashflow_row.rows,
                cashflow_latest_period=cashflow_row.latest_period,
                ratio_rows=ratio_row.rows,
                ratio_latest_period=ratio_row.latest_period,
                dividend_rows=dividend_row.rows,
                dividend_latest_date=dividend_row.latest_date,
                shareholder_rows=shareholder_row.rows,
                shareholder_latest_date=shareholder_row.latest_date,
            )
        )

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "symbols": symbols,
        "summary": {
            "symbol_count": len(symbols),
            "stale_price_symbols": stale_symbols,
            "missing_dividend_symbols": missing_dividend_symbols,
            "missing_shareholder_symbols": missing_shareholder_symbols,
            "missing_sector_symbols": missing_sector_symbols,
            **missing_sector_counts,
        },
        "rows": [asdict(row) for row in rows],
    }


def print_report(report: dict[str, Any]) -> None:
    print("# Track 2 Coverage Audit")
    print(f"- generated_at: {report['generated_at']}")
    print(f"- symbols: {', '.join(report['symbols'])}")
    print("")

    summary = report["summary"]
    print("## Summary")
    print(f"- symbol_count: {summary['symbol_count']}")
    print(f"- stale_price_symbols: {', '.join(summary['stale_price_symbols']) or 'none'}")
    print(f"- missing_dividend_symbols: {', '.join(summary['missing_dividend_symbols']) or 'none'}")
    print(
        f"- missing_shareholder_symbols: "
        f"{', '.join(summary['missing_shareholder_symbols']) or 'none'}"
    )
    print(f"- missing_sector_symbols: {', '.join(summary['missing_sector_symbols']) or 'none'}")
    print(f"- stocks_missing_sector: {summary['stocks_missing_sector']}")
    print(f"- companies_missing_sector: {summary['companies_missing_sector']}")
    print("")

    print("## Symbol Matrix")
    for row in report["rows"]:
        print(
            (
                "- {symbol}: price={price_latest} ({price_days}d), "
                "income={income_rows}/{income_latest_period}, "
                "balance={balance_rows}/{balance_latest_period}, "
                "cashflow={cashflow_rows}/{cashflow_latest_period}, "
                "ratios={ratio_rows}/{ratio_latest_period}, "
                "dividends={dividend_rows}/{dividend_latest_date}, "
                "shareholders={shareholder_rows}/{shareholder_latest_date}, "
                "stock_sector={stock_sector}, company_sector={company_sector}"
            ).format(
                **row,
            )
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Track 2 completeness audit")
    parser.add_argument(
        "--symbols",
        type=str,
        default=DEFAULT_SYMBOLS,
        help="Comma-separated symbol list to audit.",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default="",
        help="Optional path for JSON output.",
    )
    return parser


async def _main() -> int:
    args = build_parser().parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    symbols = parse_symbols(args.symbols)
    report = await build_report(symbols)
    print_report(report)

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nSaved JSON report to `{output_path}`")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
