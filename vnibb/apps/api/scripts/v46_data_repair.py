#!/usr/bin/env python3
"""V46 data repair script for EPS, EV/Sales, industry, and market-cap gaps."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import and_, func, or_, select

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.company import Company
from vnibb.models.financials import IncomeStatement
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio

logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="V46 data repair utility")
    parser.add_argument(
        "--target",
        default="all",
        choices=["all", "eps", "ev-sales", "industry", "market-cap"],
        help="Repair scope",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Rows per commit batch",
    )
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Only print metrics without writing updates",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default="scripts/v46_data_repair_report.json",
        help="Output report path",
    )
    return parser.parse_args()


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not number == number:  # NaN guard
        return None
    return number


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value != value:
        return None
    text = str(value).strip()
    return text or None


def _normalize_symbol(value: Any) -> str | None:
    text = _normalize_text(value)
    if not text:
        return None
    return text.upper()


def _non_empty_text(value: str | None) -> bool:
    return bool(value and value.strip())


def _get_listing_sources() -> list[str]:
    configured_source = _normalize_text(getattr(settings, "vnstock_source", None))
    sources: list[str] = []
    for source in (configured_source, "VCI", "KBS"):
        normalized = _normalize_text(source)
        if not normalized:
            continue
        upper = normalized.upper()
        if upper not in sources:
            sources.append(upper)
    return sources


async def _fetch_provider_industry_map() -> dict[str, str]:
    loop = asyncio.get_running_loop()
    sources = _get_listing_sources()

    def _fetch_sync() -> dict[str, str]:
        try:
            from vnstock import Listing
        except Exception as exc:
            logger.warning("Listing import failed: %s", exc)
            return {}

        mapping: dict[str, str] = {}
        for source in sources:
            try:
                listing = Listing(source=source.lower())
                df = listing.symbols_by_industries()
            except Exception as exc:
                logger.debug("symbols_by_industries failed for %s: %s", source, exc)
                continue

            if df is None or getattr(df, "empty", True):
                continue

            columns = list(df.columns)
            symbol_col = (
                "symbol" if "symbol" in columns else "ticker" if "ticker" in columns else None
            )
            if symbol_col is None:
                continue

            industry_col = None
            for candidate in (
                "industry",
                "industry_name",
                "industryName",
                "icb_name3",
                "icb_name2",
                "icb_name4",
            ):
                if candidate in columns:
                    industry_col = candidate
                    break
            if industry_col is None:
                continue

            for _, row in df.iterrows():
                symbol = _normalize_symbol(row.get(symbol_col))
                industry = _normalize_text(row.get(industry_col))
                if not symbol or not industry:
                    continue
                if symbol not in mapping:
                    mapping[symbol] = industry

        return mapping

    return await loop.run_in_executor(None, _fetch_sync)


async def _fetch_provider_outstanding_shares(symbols: list[str]) -> dict[str, float]:
    if not symbols:
        return {}

    loop = asyncio.get_running_loop()
    sources = _get_listing_sources()

    def _fetch_symbol_sync(symbol: str) -> float | None:
        try:
            from vnstock import Vnstock
        except Exception:
            return None

        for source in sources:
            try:
                stock = Vnstock().stock(symbol=symbol, source=source)
            except Exception:
                continue

            for fetch_name in ("overview", "profile"):
                try:
                    fetcher = getattr(stock.company, fetch_name)
                    df = fetcher()
                except Exception:
                    continue

                if df is None or getattr(df, "empty", True):
                    continue

                row = df.iloc[0].to_dict()
                shares = _to_float(
                    row.get("outstanding_shares")
                    or row.get("issue_share")
                    or row.get("financial_ratio_issue_share")
                    or row.get("listed_shares")
                    or row.get("listed_volume")
                )
                if shares not in (None, 0):
                    return shares

        return None

    semaphore = asyncio.Semaphore(8)

    async def _worker(symbol: str) -> tuple[str, float | None]:
        async with semaphore:
            value = await loop.run_in_executor(None, _fetch_symbol_sync, symbol)
            return symbol, value

    tasks = [asyncio.create_task(_worker(symbol)) for symbol in symbols]
    shares_by_symbol: dict[str, float] = {}
    for task in asyncio.as_completed(tasks):
        symbol, shares = await task
        if shares not in (None, 0):
            shares_by_symbol[symbol] = shares

    return shares_by_symbol


def _extract_ratio_market_cap(dataframe: Any) -> float | None:
    if dataframe is None or getattr(dataframe, "empty", True):
        return None

    if "item_id" in dataframe.columns:
        try:
            records = dataframe.to_dict("records")
        except Exception:
            return None

        target_item_ids = {
            "market_cap",
            "marketcap",
            "market_capitalization",
            "charter_capital",
        }

        for record in records:
            item_id = _normalize_text(record.get("item_id"))
            if not item_id or item_id.lower() not in target_item_ids:
                continue

            year_columns = sorted(
                [column for column in record.keys() if str(column).isdigit()],
                reverse=True,
            )
            for year in year_columns:
                value = _to_float(record.get(year))
                if value not in (None, 0):
                    return value
        return None

    row = dataframe.iloc[0].to_dict()
    return _to_float(
        row.get("market_cap")
        or row.get("marketCap")
        or row.get("capitalization")
        or row.get("charter_capital")
    )


async def _fetch_provider_market_caps(symbols: list[str]) -> dict[str, float]:
    if not symbols:
        return {}

    loop = asyncio.get_running_loop()
    sources = _get_listing_sources()

    def _fetch_symbol_sync(symbol: str) -> float | None:
        try:
            from vnstock import Vnstock
        except Exception:
            return None

        for source in sources:
            try:
                stock = Vnstock().stock(symbol=symbol, source=source)
            except Exception:
                continue

            try:
                ratio_df = stock.finance.ratio(period="year")
                ratio_market_cap = _extract_ratio_market_cap(ratio_df)
                if ratio_market_cap not in (None, 0):
                    return ratio_market_cap
            except Exception:
                pass

            for fetch_name in ("overview", "profile"):
                try:
                    fetcher = getattr(stock.company, fetch_name)
                    df = fetcher()
                except Exception:
                    continue

                if df is None or getattr(df, "empty", True):
                    continue

                row = df.iloc[0].to_dict()
                market_cap = _to_float(
                    row.get("market_cap")
                    or row.get("marketCap")
                    or row.get("capitalization")
                    or row.get("charter_capital")
                    or row.get("charterCapital")
                )
                if market_cap not in (None, 0):
                    return market_cap

        return None

    semaphore = asyncio.Semaphore(8)

    async def _worker(symbol: str) -> tuple[str, float | None]:
        async with semaphore:
            value = await loop.run_in_executor(None, _fetch_symbol_sync, symbol)
            return symbol, value

    tasks = [asyncio.create_task(_worker(symbol)) for symbol in symbols]
    market_caps: dict[str, float] = {}
    for task in asyncio.as_completed(tasks):
        symbol, market_cap = await task
        if market_cap not in (None, 0):
            market_caps[symbol] = market_cap

    return market_caps


def _extract_year_quarter(
    period: str | None,
    fiscal_year: int | None,
    fiscal_quarter: int | None,
) -> tuple[int | None, int | None]:
    year = fiscal_year if fiscal_year and fiscal_year >= 1900 else None
    quarter = fiscal_quarter if fiscal_quarter and 1 <= fiscal_quarter <= 4 else None

    period_text = str(period or "").strip().upper()
    if period_text:
        year_match = re.search(r"(20\d{2})", period_text)
        if year_match:
            year = int(year_match.group(1))

        quarter_match = re.search(r"Q([1-4])", period_text)
        if quarter_match:
            quarter = int(quarter_match.group(1))
        else:
            alt_match = re.match(r"([1-4])[/_-](20\d{2})", period_text)
            if alt_match:
                quarter = int(alt_match.group(1))
                year = int(alt_match.group(2))

    return year, quarter


def _pct(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round((count / total) * 100, 2)


async def _collect_metrics() -> dict[str, Any]:
    async with async_session_maker() as session:
        total_symbols = int(
            (
                await session.execute(
                    select(func.count(func.distinct(Stock.symbol))).where(Stock.is_active == 1)
                )
            ).scalar()
            or 0
        )

        latest_snapshot = (
            await session.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
        ).scalar()

        companies_with_industry = int(
            (
                await session.execute(
                    select(func.count(func.distinct(Company.symbol))).where(
                        and_(Company.industry.is_not(None), func.trim(Company.industry) != "")
                    )
                )
            ).scalar()
            or 0
        )

        income_eps_symbols = int(
            (
                await session.execute(
                    select(func.count(func.distinct(IncomeStatement.symbol))).where(
                        IncomeStatement.eps.is_not(None)
                    )
                )
            ).scalar()
            or 0
        )

        ratio_ev_sales_symbols = int(
            (
                await session.execute(
                    select(func.count(func.distinct(FinancialRatio.symbol))).where(
                        FinancialRatio.ev_sales.is_not(None)
                    )
                )
            ).scalar()
            or 0
        )

        screener_with_industry = 0
        screener_with_market_cap = 0
        screener_total_latest = 0
        if latest_snapshot is not None:
            screener_total_latest = int(
                (
                    await session.execute(
                        select(func.count(ScreenerSnapshot.id)).where(
                            ScreenerSnapshot.snapshot_date == latest_snapshot
                        )
                    )
                ).scalar()
                or 0
            )
            screener_with_industry = int(
                (
                    await session.execute(
                        select(func.count(ScreenerSnapshot.id)).where(
                            ScreenerSnapshot.snapshot_date == latest_snapshot,
                            ScreenerSnapshot.industry.is_not(None),
                            func.trim(ScreenerSnapshot.industry) != "",
                        )
                    )
                ).scalar()
                or 0
            )
            screener_with_market_cap = int(
                (
                    await session.execute(
                        select(func.count(ScreenerSnapshot.id)).where(
                            ScreenerSnapshot.snapshot_date == latest_snapshot,
                            ScreenerSnapshot.market_cap.is_not(None),
                        )
                    )
                ).scalar()
                or 0
            )

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "total_symbols": total_symbols,
        "latest_snapshot_date": latest_snapshot.isoformat() if latest_snapshot else None,
        "companies_with_industry": companies_with_industry,
        "companies_industry_coverage_pct": _pct(companies_with_industry, total_symbols),
        "income_eps_symbols": income_eps_symbols,
        "income_eps_coverage_pct": _pct(income_eps_symbols, total_symbols),
        "ratio_ev_sales_symbols": ratio_ev_sales_symbols,
        "ratio_ev_sales_coverage_pct": _pct(ratio_ev_sales_symbols, total_symbols),
        "screener_latest_rows": screener_total_latest,
        "screener_latest_with_industry": screener_with_industry,
        "screener_latest_industry_coverage_pct": _pct(
            screener_with_industry,
            screener_total_latest,
        ),
        "screener_latest_with_market_cap": screener_with_market_cap,
        "screener_latest_market_cap_coverage_pct": _pct(
            screener_with_market_cap,
            screener_total_latest,
        ),
    }


async def _backfill_ev_sales(batch_size: int) -> int:
    async with async_session_maker() as session:
        income_rows = (
            await session.execute(
                select(
                    IncomeStatement.symbol,
                    IncomeStatement.fiscal_year,
                    IncomeStatement.fiscal_quarter,
                    IncomeStatement.revenue,
                    IncomeStatement.ebitda,
                ).where(IncomeStatement.revenue.is_not(None))
            )
        ).all()

        quarterly_metrics: dict[tuple[str, int, int], tuple[float, float | None]] = {}
        annual_metrics: dict[tuple[str, int], tuple[float, float | None]] = {}
        for symbol, year, quarter, revenue, ebitda in income_rows:
            rev = _to_float(revenue)
            if rev is None or rev == 0:
                continue
            ebitda_value = _to_float(ebitda)
            if year and quarter:
                quarterly_metrics[(symbol, year, quarter)] = (rev, ebitda_value)
            if year and (symbol, year) not in annual_metrics:
                annual_metrics[(symbol, year)] = (rev, ebitda_value)

        latest_snapshot_date = (
            await session.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
        ).scalar()
        latest_market_cap_by_symbol: dict[str, float] = {}
        if latest_snapshot_date is not None:
            market_rows = (
                await session.execute(
                    select(ScreenerSnapshot.symbol, ScreenerSnapshot.market_cap).where(
                        ScreenerSnapshot.snapshot_date == latest_snapshot_date,
                        ScreenerSnapshot.market_cap.is_not(None),
                    )
                )
            ).all()
            latest_market_cap_by_symbol = {
                symbol: market_cap
                for symbol, market_cap in market_rows
                if _to_float(market_cap) not in (None, 0)
            }

        ratio_rows = (
            (await session.execute(select(FinancialRatio).where(FinancialRatio.ev_sales.is_(None))))
            .scalars()
            .all()
        )

        updated = 0
        for index, row in enumerate(ratio_rows, start=1):
            year, quarter = _extract_year_quarter(row.period, row.fiscal_year, row.fiscal_quarter)
            if year is None:
                continue

            metrics = None
            if quarter is not None:
                metrics = quarterly_metrics.get((row.symbol, year, quarter))
            if metrics is None:
                metrics = annual_metrics.get((row.symbol, year))

            revenue = metrics[0] if metrics else None
            if revenue in (None, 0):
                continue

            raw = row.raw_data if isinstance(row.raw_data, dict) else {}
            enterprise_value = _to_float(
                raw.get("enterprise_value") or raw.get("enterpriseValue") or raw.get("ev")
            )
            if enterprise_value is None:
                ev_ebitda = _to_float(row.ev_ebitda)
                ebitda = metrics[1] if metrics else None
                if ev_ebitda is not None and ebitda not in (None, 0):
                    enterprise_value = ev_ebitda * ebitda
            if enterprise_value is None:
                enterprise_value = latest_market_cap_by_symbol.get(row.symbol)
            if enterprise_value is None:
                continue

            row.ev_sales = enterprise_value / revenue
            updated += 1

            if index % batch_size == 0:
                await session.commit()

        await session.commit()
        return updated


async def _backfill_income_eps_from_ratios(batch_size: int) -> int:
    async with async_session_maker() as session:
        ratio_rows = (
            await session.execute(
                select(
                    FinancialRatio.symbol,
                    FinancialRatio.period,
                    FinancialRatio.fiscal_year,
                    FinancialRatio.fiscal_quarter,
                    FinancialRatio.eps,
                ).where(FinancialRatio.eps.is_not(None))
            )
        ).all()

        eps_by_year_quarter: dict[tuple[str, int, int], float] = {}
        eps_by_year: dict[tuple[str, int], float] = {}
        for symbol, period, fiscal_year, fiscal_quarter, eps in ratio_rows:
            eps_value = _to_float(eps)
            if eps_value is None:
                continue
            year, quarter = _extract_year_quarter(period, fiscal_year, fiscal_quarter)
            if year is None:
                continue
            if (symbol, year) not in eps_by_year:
                eps_by_year[(symbol, year)] = eps_value
            if quarter is not None and (symbol, year, quarter) not in eps_by_year_quarter:
                eps_by_year_quarter[(symbol, year, quarter)] = eps_value

        income_rows = (
            (await session.execute(select(IncomeStatement).where(IncomeStatement.eps.is_(None))))
            .scalars()
            .all()
        )

        updated = 0
        for index, row in enumerate(income_rows, start=1):
            year, quarter = _extract_year_quarter(row.period, row.fiscal_year, row.fiscal_quarter)
            if year is None:
                continue

            eps_value = None
            if quarter is not None:
                eps_value = eps_by_year_quarter.get((row.symbol, year, quarter))
            if eps_value is None:
                eps_value = eps_by_year.get((row.symbol, year))
            if eps_value is None:
                continue

            row.eps = eps_value
            updated += 1

            if index % batch_size == 0:
                await session.commit()

        await session.commit()
        return updated


async def _backfill_industry(batch_size: int) -> dict[str, int]:
    async with async_session_maker() as session:
        provider_industry = await _fetch_provider_industry_map()

        stock_rows_missing = (
            (
                await session.execute(
                    select(Stock).where(
                        or_(Stock.industry.is_(None), func.trim(Stock.industry) == "")
                    )
                )
            )
            .scalars()
            .all()
        )

        stocks_updated = 0
        for index, row in enumerate(stock_rows_missing, start=1):
            fill_value = provider_industry.get(row.symbol)
            if not _non_empty_text(fill_value):
                continue
            row.industry = fill_value
            stocks_updated += 1
            if index % batch_size == 0:
                await session.commit()

        await session.commit()

        stock_rows = (
            await session.execute(
                select(Stock.symbol, Stock.industry).where(Stock.industry.is_not(None))
            )
        ).all()
        stock_industry = {
            symbol: industry.strip() for symbol, industry in stock_rows if _non_empty_text(industry)
        }

        latest_snapshot = (
            await session.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
        ).scalar()
        latest_screener_industry: dict[str, str] = {}
        if latest_snapshot is not None:
            latest_rows = (
                await session.execute(
                    select(ScreenerSnapshot.symbol, ScreenerSnapshot.industry).where(
                        ScreenerSnapshot.snapshot_date == latest_snapshot,
                        ScreenerSnapshot.industry.is_not(None),
                    )
                )
            ).all()
            latest_screener_industry = {
                symbol: industry.strip()
                for symbol, industry in latest_rows
                if _non_empty_text(industry)
            }

        company_rows = (
            (
                await session.execute(
                    select(Company).where(
                        or_(Company.industry.is_(None), func.trim(Company.industry) == "")
                    )
                )
            )
            .scalars()
            .all()
        )

        companies_updated = 0
        for index, row in enumerate(company_rows, start=1):
            fill_value = (
                stock_industry.get(row.symbol)
                or latest_screener_industry.get(row.symbol)
                or provider_industry.get(row.symbol)
            )
            if not _non_empty_text(fill_value):
                continue
            row.industry = fill_value
            companies_updated += 1
            if index % batch_size == 0:
                await session.commit()

        await session.commit()

        company_ref_rows = (
            await session.execute(
                select(Company.symbol, Company.industry).where(Company.industry.is_not(None))
            )
        ).all()
        company_industry = {
            symbol: industry.strip()
            for symbol, industry in company_ref_rows
            if _non_empty_text(industry)
        }

        screener_rows: list[ScreenerSnapshot] = []
        if latest_snapshot is not None:
            screener_rows = (
                (
                    await session.execute(
                        select(ScreenerSnapshot).where(
                            ScreenerSnapshot.snapshot_date == latest_snapshot,
                            or_(
                                ScreenerSnapshot.industry.is_(None),
                                func.trim(ScreenerSnapshot.industry) == "",
                            ),
                        )
                    )
                )
                .scalars()
                .all()
            )

        screener_updated = 0
        for index, row in enumerate(screener_rows, start=1):
            fill_value = (
                company_industry.get(row.symbol)
                or stock_industry.get(row.symbol)
                or provider_industry.get(row.symbol)
            )
            if not _non_empty_text(fill_value):
                continue
            row.industry = fill_value
            screener_updated += 1
            if index % batch_size == 0:
                await session.commit()

        await session.commit()
        return {
            "provider_industry_symbols": len(provider_industry),
            "stocks_industry_updated": stocks_updated,
            "companies_industry_updated": companies_updated,
            "screener_industry_updated": screener_updated,
        }


async def _backfill_market_cap(batch_size: int) -> int:
    async with async_session_maker() as session:
        latest_snapshot = (
            await session.execute(select(func.max(ScreenerSnapshot.snapshot_date)))
        ).scalar()
        if latest_snapshot is None:
            return 0

        company_rows = (
            await session.execute(
                select(Company.symbol, Company.outstanding_shares, Company.listed_shares).where(
                    or_(Company.outstanding_shares.is_not(None), Company.listed_shares.is_not(None))
                )
            )
        ).all()
        shares_by_symbol: dict[str, float] = {}
        for symbol, outstanding_shares, listed_shares in company_rows:
            shares = _to_float(outstanding_shares)
            if shares in (None, 0):
                shares = _to_float(listed_shares)
            if shares not in (None, 0):
                shares_by_symbol[symbol] = shares

        latest_time_subquery = (
            select(StockPrice.symbol, func.max(StockPrice.time).label("max_time"))
            .group_by(StockPrice.symbol)
            .subquery()
        )

        latest_price_rows = (
            await session.execute(
                select(StockPrice.symbol, StockPrice.close).join(
                    latest_time_subquery,
                    and_(
                        StockPrice.symbol == latest_time_subquery.c.symbol,
                        StockPrice.time == latest_time_subquery.c.max_time,
                    ),
                )
            )
        ).all()
        latest_price_by_symbol = {
            symbol: _to_float(close)
            for symbol, close in latest_price_rows
            if _to_float(close) not in (None, 0)
        }

        screener_rows = (
            (
                await session.execute(
                    select(ScreenerSnapshot).where(
                        ScreenerSnapshot.snapshot_date == latest_snapshot,
                        ScreenerSnapshot.market_cap.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )

        updated = 0
        unresolved_symbols: set[str] = set()
        for index, row in enumerate(screener_rows, start=1):
            shares = shares_by_symbol.get(row.symbol)
            price = latest_price_by_symbol.get(row.symbol) or _to_float(row.price)
            if shares in (None, 0) or price in (None, 0):
                unresolved_symbols.add(row.symbol)
                continue
            row.market_cap = shares * price
            updated += 1
            if index % batch_size == 0:
                await session.commit()

        if unresolved_symbols:
            provider_shares = await _fetch_provider_outstanding_shares(sorted(unresolved_symbols))
            if provider_shares:
                shares_by_symbol.update(provider_shares)

                company_rows_existing = (
                    (
                        await session.execute(
                            select(Company).where(Company.symbol.in_(list(provider_shares.keys())))
                        )
                    )
                    .scalars()
                    .all()
                )
                existing_symbols = {row.symbol for row in company_rows_existing}

                for company in company_rows_existing:
                    if _to_float(company.outstanding_shares) in (None, 0):
                        company.outstanding_shares = provider_shares[company.symbol]

                for symbol, shares in provider_shares.items():
                    if symbol in existing_symbols:
                        continue
                    session.add(
                        Company(
                            symbol=symbol,
                            outstanding_shares=shares,
                            updated_at=datetime.now(UTC).replace(tzinfo=None),
                        )
                    )

                for row in screener_rows:
                    if row.market_cap is not None:
                        continue
                    shares = shares_by_symbol.get(row.symbol)
                    price = latest_price_by_symbol.get(row.symbol) or _to_float(row.price)
                    if shares in (None, 0) or price in (None, 0):
                        continue
                    row.market_cap = shares * price
                    updated += 1

            unresolved_after_shares = sorted(
                {row.symbol for row in screener_rows if row.market_cap is None and row.symbol}
            )
            if unresolved_after_shares:
                provider_market_caps = await _fetch_provider_market_caps(unresolved_after_shares)
                for row in screener_rows:
                    if row.market_cap is not None:
                        continue
                    market_cap = provider_market_caps.get(row.symbol)
                    if market_cap in (None, 0):
                        continue
                    row.market_cap = market_cap
                    updated += 1

        await session.commit()
        return updated


async def main() -> int:
    args = parse_args()

    before = await _collect_metrics()
    operations: dict[str, Any] = {}

    if not args.audit_only:
        run_all = args.target == "all"
        if run_all or args.target == "ev-sales":
            operations["ev_sales_rows_updated"] = await _backfill_ev_sales(args.batch_size)
        if run_all or args.target == "eps":
            operations["income_eps_rows_updated"] = await _backfill_income_eps_from_ratios(
                args.batch_size
            )
        if run_all or args.target == "industry":
            operations.update(await _backfill_industry(args.batch_size))
        if run_all or args.target == "market-cap":
            operations["market_cap_rows_updated"] = await _backfill_market_cap(args.batch_size)

    after = await _collect_metrics()

    report = {
        "target": args.target,
        "audit_only": args.audit_only,
        "before": before,
        "after": after,
        "operations": operations,
        "generated_at": datetime.now(UTC).isoformat(),
    }

    output = Path(args.output_json)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("# V46 Data Repair")
    print(f"- target: {args.target}")
    print(f"- audit_only: {args.audit_only}")
    print(f"- output: {output}")
    print("- before:")
    print(
        "  - companies industry coverage: "
        f"{before['companies_with_industry']}/{before['total_symbols']} "
        f"({before['companies_industry_coverage_pct']}%)"
    )
    print(
        "  - income eps coverage: "
        f"{before['income_eps_symbols']}/{before['total_symbols']} "
        f"({before['income_eps_coverage_pct']}%)"
    )
    print(
        "  - ratio ev/sales coverage: "
        f"{before['ratio_ev_sales_symbols']}/{before['total_symbols']} "
        f"({before['ratio_ev_sales_coverage_pct']}%)"
    )
    if before["screener_latest_rows"]:
        print(
            "  - screener latest industry coverage: "
            f"{before['screener_latest_with_industry']}/{before['screener_latest_rows']} "
            f"({before['screener_latest_industry_coverage_pct']}%)"
        )
        print(
            "  - screener latest market-cap coverage: "
            f"{before['screener_latest_with_market_cap']}/{before['screener_latest_rows']} "
            f"({before['screener_latest_market_cap_coverage_pct']}%)"
        )

    if operations:
        print("- operations:")
        for key, value in operations.items():
            print(f"  - {key}: {value}")

    print("- after:")
    print(
        "  - companies industry coverage: "
        f"{after['companies_with_industry']}/{after['total_symbols']} "
        f"({after['companies_industry_coverage_pct']}%)"
    )
    print(
        "  - income eps coverage: "
        f"{after['income_eps_symbols']}/{after['total_symbols']} "
        f"({after['income_eps_coverage_pct']}%)"
    )
    print(
        "  - ratio ev/sales coverage: "
        f"{after['ratio_ev_sales_symbols']}/{after['total_symbols']} "
        f"({after['ratio_ev_sales_coverage_pct']}%)"
    )
    if after["screener_latest_rows"]:
        print(
            "  - screener latest industry coverage: "
            f"{after['screener_latest_with_industry']}/{after['screener_latest_rows']} "
            f"({after['screener_latest_industry_coverage_pct']}%)"
        )
        print(
            "  - screener latest market-cap coverage: "
            f"{after['screener_latest_with_market_cap']}/{after['screener_latest_rows']} "
            f"({after['screener_latest_market_cap_coverage_pct']}%)"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
