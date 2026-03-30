"""
Comparison Analysis Service

Provides side-by-side stock comparison data for multiple tickers.
Aggregates metrics from screener and profile data.

Uses CacheManager for efficient data retrieval instead of fetching
2000 stocks from the live API every time.
"""

import asyncio
import logging
import re
import unicodedata
from datetime import datetime
from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field
from sqlalchemy import desc, select

from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.core.vn_sectors import VN_SECTORS
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock
from vnibb.models.trading import FinancialRatio
from vnibb.services.cache_manager import CacheManager

logger = logging.getLogger(__name__)


def _record_value(record: Any, *keys: str) -> Any:
    for key in keys:
        if isinstance(record, dict):
            candidate = record.get(key)
        else:
            candidate = getattr(record, key, None)
        if candidate not in (None, ""):
            return candidate
    return None


def _coerce_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric


def _normalize_text(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    normalized = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


PERCENT_METRIC_LIMITS = {
    "roe": 200.0,
    "roa": 200.0,
    "roic": 200.0,
    "gross_margin": 200.0,
    "net_margin": 200.0,
    "operating_margin": 200.0,
    "debt_assets": 200.0,
    "dividend_yield": 100.0,
    "fcf_yield": 100.0,
    "ocf_sales": 200.0,
    "revenue_growth": 999.0,
    "earnings_growth": 999.0,
    "foreign_ownership": 100.0,
}


def _normalize_comparison_metric(metric_key: str, value: Any) -> Optional[float]:
    numeric = _coerce_number(value)
    if numeric is None:
        return None

    if metric_key in PERCENT_METRIC_LIMITS:
        if 0 < abs(numeric) <= 1:
            numeric *= 100

        limit = PERCENT_METRIC_LIMITS[metric_key]
        while abs(numeric) > limit and abs(numeric / 100) <= limit:
            numeric /= 100

        if abs(numeric) > limit:
            return None

    if metric_key == "debt_to_equity" and (numeric <= 0 or abs(numeric) > 1000):
        return None

    return numeric


def _first_metric_value(metric_key: str, *values: Any) -> Optional[float]:
    for value in values:
        normalized = _normalize_comparison_metric(metric_key, value)
        if normalized is not None:
            return normalized
    return None


def _normalize_ratio_period(period: str) -> tuple[str, Optional[int], bool]:
    normalized = str(period or "FY").strip().upper()
    if normalized in {"FY", "YEAR"}:
        return "year", None, False
    if normalized in {"Q1", "Q2", "Q3", "Q4"}:
        return "quarter", int(normalized[-1]), False
    if normalized == "TTM":
        return "quarter", None, True
    return "quarter", None, False


def _matches_requested_quarter(
    period_value: str, fiscal_quarter: Optional[int], requested_quarter: int
) -> bool:
    if fiscal_quarter == requested_quarter:
        return True
    return f"Q{requested_quarter}" in str(period_value or "").upper()


def _metric_from_ratio_row(row: Any, metric_key: str) -> Optional[float]:
    attribute_map = {
        "pe": "pe_ratio",
        "pb": "pb_ratio",
        "ps": "ps_ratio",
        "debt_to_equity": "debt_to_equity",
        "debt_assets": "debt_to_assets",
    }
    attribute = attribute_map.get(metric_key, metric_key)
    raw_payload = getattr(row, "raw_data", None)
    raw_data = raw_payload if isinstance(raw_payload, dict) else {}

    return _first_metric_value(
        metric_key,
        getattr(row, attribute, None),
        raw_data.get(metric_key),
        raw_data.get(attribute),
    )


def _build_statement_snapshot(
    rows: List[Any], statement_type: str, *, ttm: bool
) -> Optional[dict[str, Optional[float]]]:
    if not rows:
        return None

    if statement_type == "balance":
        latest = rows[0]
        return {
            "total_assets": _coerce_number(getattr(latest, "total_assets", None)),
            "total_liabilities": _coerce_number(getattr(latest, "total_liabilities", None)),
            "total_equity": _coerce_number(
                getattr(latest, "total_equity", None) or getattr(latest, "equity", None)
            ),
        }

    metric_keys = [
        "revenue",
        "gross_profit",
        "operating_income",
        "net_income",
        "interest_expense",
        "operating_cash_flow",
        "free_cash_flow",
        "debt_repayment",
    ]

    if not ttm:
        latest = rows[0]
        return {
            metric_key: _coerce_number(getattr(latest, metric_key, None))
            for metric_key in metric_keys
        }

    recent_rows = rows[:4]
    if len(recent_rows) < 4:
        return None

    snapshot: dict[str, Optional[float]] = {}
    for metric_key in metric_keys:
        values = [_coerce_number(getattr(row, metric_key, None)) for row in recent_rows]
        valid_values = [value for value in values if value is not None]
        snapshot[metric_key] = sum(valid_values) if valid_values else None

    return snapshot


async def _load_statement_rows(
    symbol: str,
    model: Any,
    period_type: str,
    requested_quarter: Optional[int],
    *,
    limit: int,
) -> List[Any]:
    async with async_session_maker() as session:
        stmt = select(model).where(model.symbol == symbol, model.period_type == period_type)
        if requested_quarter is not None and hasattr(model, "fiscal_quarter"):
            stmt = stmt.where(model.fiscal_quarter == requested_quarter)

        stmt = stmt.order_by(desc(model.fiscal_year), desc(model.fiscal_quarter))
        result = await session.execute(stmt.limit(limit))
        return result.scalars().all()


async def _build_comparison_backfill(
    symbol: str,
    period: str,
    market_cap: Optional[float],
) -> Dict[str, Optional[float]]:
    period_type, requested_quarter, use_ttm = _normalize_ratio_period(period)
    row_limit = 8 if use_ttm else 2

    income_rows, balance_rows, cash_rows = await asyncio.gather(
        _load_statement_rows(
            symbol, IncomeStatement, period_type, requested_quarter, limit=row_limit
        ),
        _load_statement_rows(
            symbol,
            BalanceSheet,
            period_type,
            requested_quarter,
            limit=1 if use_ttm else row_limit,
        ),
        _load_statement_rows(symbol, CashFlow, period_type, requested_quarter, limit=row_limit),
    )

    current_income = _build_statement_snapshot(income_rows, "income", ttm=use_ttm) or {}
    previous_income = (
        _build_statement_snapshot(income_rows[1:5], "income", ttm=use_ttm)
        if use_ttm and len(income_rows) >= 8
        else _build_statement_snapshot(income_rows[1:2], "income", ttm=False)
    ) or {}
    current_balance = _build_statement_snapshot(balance_rows, "balance", ttm=use_ttm) or {}
    current_cash = _build_statement_snapshot(cash_rows, "cash", ttm=use_ttm) or {}

    revenue = current_income.get("revenue")
    gross_profit = current_income.get("gross_profit")
    operating_income = current_income.get("operating_income")
    net_income = current_income.get("net_income")
    interest_expense = current_income.get("interest_expense")
    total_assets = current_balance.get("total_assets")
    total_liabilities = current_balance.get("total_liabilities")
    total_equity = current_balance.get("total_equity")
    operating_cash_flow = current_cash.get("operating_cash_flow")
    free_cash_flow = current_cash.get("free_cash_flow")
    debt_repayment = current_cash.get("debt_repayment")
    previous_revenue = previous_income.get("revenue")
    previous_net_income = previous_income.get("net_income")

    backfill = {
        "gross_margin": None,
        "operating_margin": None,
        "net_margin": None,
        "asset_turnover": None,
        "debt_assets": None,
        "debt_to_equity": None,
        "interest_coverage": None,
        "debt_service_coverage": None,
        "ocf_sales": None,
        "fcf_yield": None,
        "revenue_growth": None,
        "earnings_growth": None,
    }

    if revenue not in (None, 0) and gross_profit is not None:
        backfill["gross_margin"] = (gross_profit / revenue) * 100
    if revenue not in (None, 0) and operating_income is not None:
        backfill["operating_margin"] = (operating_income / revenue) * 100
    if revenue not in (None, 0) and net_income is not None:
        backfill["net_margin"] = (net_income / revenue) * 100
    if revenue not in (None, 0) and total_assets not in (None, 0):
        backfill["asset_turnover"] = revenue / total_assets
    if total_liabilities not in (None, 0) and total_assets not in (None, 0):
        backfill["debt_assets"] = (total_liabilities / total_assets) * 100
    if total_liabilities not in (None, 0) and total_equity not in (None, 0):
        backfill["debt_to_equity"] = total_liabilities / total_equity
    if operating_income is not None and interest_expense not in (None, 0):
        backfill["interest_coverage"] = operating_income / abs(interest_expense)
    if operating_income is not None:
        debt_service = 0.0
        if interest_expense not in (None, 0):
            debt_service += abs(interest_expense)
        if debt_repayment not in (None, 0):
            debt_service += abs(debt_repayment)
        if debt_service > 0:
            backfill["debt_service_coverage"] = operating_income / debt_service
    if operating_cash_flow is not None and revenue not in (None, 0):
        backfill["ocf_sales"] = (operating_cash_flow / revenue) * 100
    if free_cash_flow is not None and market_cap not in (None, 0):
        backfill["fcf_yield"] = (free_cash_flow / market_cap) * 100
    if (
        revenue not in (None, 0)
        and previous_revenue not in (None, 0)
        and abs(previous_revenue) >= 0.001
    ):
        backfill["revenue_growth"] = ((revenue - previous_revenue) / abs(previous_revenue)) * 100
    if (
        net_income not in (None, 0)
        and previous_net_income not in (None, 0)
        and abs(previous_net_income) >= 0.001
    ):
        backfill["earnings_growth"] = (
            (net_income - previous_net_income) / abs(previous_net_income)
        ) * 100

    return {key: _normalize_comparison_metric(key, value) for key, value in backfill.items()}


class MetricDefinition(BaseModel):
    """Definition for a comparison metric."""

    key: str
    label: str
    format: str  # "currency", "percent", "ratio", "large_number", "number"


class StockMetrics(BaseModel):
    """Metrics for a single stock."""

    symbol: str
    name: Optional[str] = None
    industry: Optional[str] = None
    exchange: Optional[str] = None
    # Flexible metrics dictionary to hold all 84+ fields
    metrics: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class PricePerformancePoint(BaseModel):
    """Normalized price performance point."""

    date: str
    values: Dict[str, float]  # symbol -> normalized_value


class ComparisonResponse(BaseModel):
    """Response for stock comparison."""

    symbols: List[str]
    metrics: List[MetricDefinition]
    data: Dict[str, StockMetrics]
    price_history: List[PricePerformancePoint] = Field(default_factory=list, alias="priceHistory")
    sector_averages: Dict[str, float] = Field(default_factory=dict, alias="sectorAverages")
    generated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"populate_by_name": True}


class PeerCompany(BaseModel):
    """Peer company data."""

    symbol: str
    name: Optional[str] = None
    market_cap: Optional[float] = None
    pe_ratio: Optional[float] = None
    roe: Optional[float] = None
    price: Optional[float] = None
    change_pct: Optional[float] = None
    industry: Optional[str] = None


class PeersResponse(BaseModel):
    """Response for peer companies lookup."""

    symbol: str
    industry: Optional[str] = None
    count: int = 0
    peers: List[PeerCompany] = Field(default_factory=list)


# Standard metrics for comparison (Expanded to common categories)
COMPARISON_METRICS = [
    # Price & Volume
    MetricDefinition(key="price", label="Price", format="currency"),
    MetricDefinition(key="volume", label="Volume", format="large_number"),
    MetricDefinition(key="market_cap", label="Market Cap", format="large_number"),
    # Valuation
    MetricDefinition(key="pe", label="P/E", format="ratio"),
    MetricDefinition(key="pb", label="P/B", format="ratio"),
    MetricDefinition(key="ps", label="P/S", format="ratio"),
    MetricDefinition(key="ev_ebitda", label="EV/EBITDA", format="ratio"),
    MetricDefinition(key="eps", label="EPS", format="currency"),
    MetricDefinition(key="bvps", label="BVPS", format="currency"),
    # Profitability
    MetricDefinition(key="roe", label="ROE", format="percent"),
    MetricDefinition(key="roa", label="ROA", format="percent"),
    MetricDefinition(key="roic", label="ROIC", format="percent"),
    MetricDefinition(key="gross_margin", label="Gross Margin", format="percent"),
    MetricDefinition(key="net_margin", label="Net Margin", format="percent"),
    MetricDefinition(key="operating_margin", label="Op Margin", format="percent"),
    # Growth
    MetricDefinition(key="revenue_growth", label="Rev Growth", format="percent"),
    MetricDefinition(key="earnings_growth", label="Earnings Growth", format="percent"),
    # Debt & Liquidity
    MetricDefinition(key="debt_to_equity", label="D/E", format="ratio"),
    MetricDefinition(key="current_ratio", label="Current Ratio", format="ratio"),
    MetricDefinition(key="quick_ratio", label="Quick Ratio", format="ratio"),
    # Dividends & Ownership
    MetricDefinition(key="dividend_yield", label="Div Yield", format="percent"),
    MetricDefinition(key="foreign_ownership", label="Foreign Own", format="percent"),
]


class ComparisonService:
    """
    Service for comparing multiple stocks side by side.

    Uses CacheManager for efficient data retrieval from database cache
    instead of making expensive API calls for each request.
    """

    def __init__(self):
        self.cache_manager = CacheManager()

    async def _get_all_screener_data(self, source: str = settings.vnstock_source) -> List[Any]:
        """
        Get all screener data from cache or API.
        """
        try:
            cache_result = await self.cache_manager.get_screener_data(
                symbol=None,
                source=source,
                allow_stale=True,
            )

            if cache_result.hit and cache_result.data:
                return cache_result.data

            if source:
                fallback_cache = await self.cache_manager.get_screener_data(
                    symbol=None,
                    source=None,
                    allow_stale=True,
                )
                if fallback_cache.hit and fallback_cache.data:
                    return fallback_cache.data

                from vnibb.providers.vnstock.equity_screener import (
                    VnstockScreenerFetcher,
                    StockScreenerParams,
                )

            params = StockScreenerParams(limit=2000, source=source)
            results = await VnstockScreenerFetcher.fetch(params)

            if results:
                await self.cache_manager.store_screener_data(
                    data=[r.model_dump() for r in results],
                    source=source,
                )

            return results
        except Exception as e:
            logger.exception(f"Failed to fetch screener data: {e}")
            return []

    async def get_stock_metrics(
        self, symbol: str, source: str = settings.vnstock_source
    ) -> StockMetrics:
        """
        Fetch metrics for a single stock from cached screener data.
        """
        symbol = symbol.upper()
        try:
            cache_result = await self.cache_manager.get_screener_data(
                symbol=symbol,
                source=source,
                allow_stale=True,
            )

            data = None
            if cache_result.hit and cache_result.data:
                data = cache_result.data[0]
            else:
                fallback_cache = await self.cache_manager.get_screener_data(
                    symbol=symbol,
                    source=None,
                    allow_stale=True,
                )
                if fallback_cache.hit and fallback_cache.data:
                    data = fallback_cache.data[0]
                else:
                    from vnibb.providers.vnstock.equity_screener import (
                        VnstockScreenerFetcher,
                        StockScreenerParams,
                    )

                    params = StockScreenerParams(symbol=symbol, limit=1, source=source)
                    results = await VnstockScreenerFetcher.fetch(params)
                    if results:
                        data = results[0]

            if not data:
                try:
                    from vnibb.providers.vnstock.financial_ratios import (
                        VnstockFinancialRatiosFetcher,
                        FinancialRatiosQueryParams,
                    )

                    ratios = await VnstockFinancialRatiosFetcher.fetch(
                        FinancialRatiosQueryParams(symbol=symbol, period="year")
                    )
                    if ratios:
                        latest = ratios[0]
                        ratios_dict = latest.model_dump() if hasattr(latest, "model_dump") else {}
                        metrics_dict = {
                            "pe": ratios_dict.get("pe"),
                            "pb": ratios_dict.get("pb"),
                            "ps": ratios_dict.get("ps"),
                            "roe": ratios_dict.get("roe"),
                            "roa": ratios_dict.get("roa"),
                            "eps": ratios_dict.get("eps"),
                            "bvps": ratios_dict.get("bvps"),
                            "gross_margin": ratios_dict.get("gross_margin"),
                            "net_margin": ratios_dict.get("net_margin"),
                            "current_ratio": ratios_dict.get("current_ratio"),
                            "debt_to_equity": ratios_dict.get("debt_equity"),
                        }
                        return StockMetrics(symbol=symbol, metrics=metrics_dict)
                except Exception as ratio_err:
                    logger.warning(f"Ratio fallback failed for {symbol}: {ratio_err}")

                return StockMetrics(symbol=symbol)

            metrics_dict = {
                "price": _record_value(data, "price"),
                "volume": _record_value(data, "volume"),
                "market_cap": _record_value(data, "market_cap", "marketCap"),
                "pe": _record_value(data, "pe", "pe_ratio"),
                "pb": _record_value(data, "pb", "pb_ratio"),
                "ps": _record_value(data, "ps", "ps_ratio"),
                "ev_ebitda": _record_value(data, "ev_ebitda", "evEbitda"),
                "roe": _record_value(data, "roe"),
                "roa": _record_value(data, "roa"),
                "roic": _record_value(data, "roic"),
                "gross_margin": _record_value(data, "gross_margin", "grossMargin"),
                "net_margin": _record_value(data, "net_margin", "netMargin"),
                "operating_margin": _record_value(data, "operating_margin", "operatingMargin"),
                "revenue_growth": _record_value(data, "revenue_growth", "revenueGrowth"),
                "earnings_growth": _record_value(data, "earnings_growth", "earningsGrowth"),
                "debt_to_equity": _record_value(data, "debt_to_equity", "debtToEquity"),
                "debt_assets": _record_value(data, "debt_assets", "debtToAssets", "debt_to_asset"),
                "current_ratio": _record_value(data, "current_ratio", "currentRatio"),
                "quick_ratio": _record_value(data, "quick_ratio", "quickRatio"),
                "asset_turnover": _record_value(data, "asset_turnover", "assetTurnover"),
                "interest_coverage": _record_value(data, "interest_coverage", "interestCoverage"),
                "fcf_yield": _record_value(data, "fcf_yield", "fcfYield"),
                "ocf_sales": _record_value(data, "ocf_sales", "ocfSales"),
                "eps": _record_value(data, "eps"),
                "bvps": _record_value(data, "bvps", "book_value_per_share"),
                "dividend_yield": _record_value(data, "dividend_yield", "dividendYield"),
                "foreign_ownership": _record_value(data, "foreign_ownership", "foreignOwnership"),
            }

            async with async_session_maker() as session:
                stock_row = (
                    await session.execute(select(Stock).where(Stock.symbol == symbol).limit(1))
                ).scalar_one_or_none()
                ratio_row = (
                    await session.execute(
                        select(FinancialRatio)
                        .where(FinancialRatio.symbol == symbol)
                        .order_by(
                            desc(FinancialRatio.fiscal_year),
                            desc(FinancialRatio.fiscal_quarter),
                            desc(FinancialRatio.updated_at),
                        )
                        .limit(1)
                    )
                ).scalar_one_or_none()

            if ratio_row is not None:
                ratio_fallbacks = {
                    "pe": ratio_row.pe_ratio,
                    "pb": ratio_row.pb_ratio,
                    "ps": ratio_row.ps_ratio,
                    "ev_ebitda": ratio_row.ev_ebitda,
                    "roe": ratio_row.roe,
                    "roa": ratio_row.roa,
                    "roic": ratio_row.roic,
                    "gross_margin": ratio_row.gross_margin,
                    "net_margin": ratio_row.net_margin,
                    "operating_margin": ratio_row.operating_margin,
                    "revenue_growth": ratio_row.revenue_growth,
                    "earnings_growth": ratio_row.earnings_growth,
                    "debt_to_equity": ratio_row.debt_to_equity,
                    "debt_assets": ratio_row.debt_to_assets,
                    "current_ratio": ratio_row.current_ratio,
                    "quick_ratio": ratio_row.quick_ratio,
                    "asset_turnover": getattr(ratio_row, "asset_turnover", None),
                    "interest_coverage": getattr(ratio_row, "interest_coverage", None),
                    "fcf_yield": _record_value(ratio_row.raw_data or {}, "fcf_yield", "fcfYield"),
                    "ocf_sales": _record_value(ratio_row.raw_data or {}, "ocf_sales", "ocfSales"),
                    "eps": ratio_row.eps,
                    "bvps": ratio_row.bvps,
                }
                for key, value in ratio_fallbacks.items():
                    if metrics_dict.get(key) is None and value is not None:
                        metrics_dict[key] = value

            normalized_metrics: Dict[str, float] = {}
            for key, value in metrics_dict.items():
                normalized = _normalize_comparison_metric(key, value)
                if normalized is not None:
                    normalized_metrics[key] = normalized
            metrics_dict = normalized_metrics

            name = _record_value(data, "company_name", "organ_name", "organName")
            industry = _record_value(data, "industry", "industry_name", "industryName")
            exchange = _record_value(data, "exchange")

            if stock_row is not None:
                name = name or stock_row.company_name or stock_row.short_name
                industry = industry or stock_row.industry or stock_row.sector
                exchange = exchange or stock_row.exchange

            return StockMetrics(
                symbol=symbol,
                name=name,
                industry=industry,
                exchange=exchange,
                metrics=metrics_dict,
            )
        except Exception as e:
            logger.exception(f"Failed to fetch metrics for {symbol}: {e}")
            return StockMetrics(symbol=symbol)

    async def compare_price_performance(
        self, symbols: List[str], period: str = "1Y", source: str = settings.vnstock_source
    ) -> List[PricePerformancePoint]:
        """
        Compare historical price performance normalized to 100 at the start.
        """
        from vnibb.providers.vnstock.equity_historical import (
            VnstockEquityHistoricalFetcher,
            EquityHistoricalQueryParams,
        )
        from datetime import date, timedelta

        end_date = date.today()
        if period == "1M":
            start_date = end_date - timedelta(days=30)
        elif period == "3M":
            start_date = end_date - timedelta(days=90)
        elif period == "6M":
            start_date = end_date - timedelta(days=180)
        elif period == "3Y":
            start_date = end_date - timedelta(days=365 * 3)
        elif period == "5Y":
            start_date = end_date - timedelta(days=365 * 5)
        elif period == "YTD":
            start_date = date(end_date.year, 1, 1)
        elif period == "ALL":
            start_date = end_date - timedelta(days=365 * 5)
        else:
            start_date = end_date - timedelta(days=365)

        # Fetch historical data for all symbols
        all_series = {}
        for symbol in symbols:
            try:
                params = EquityHistoricalQueryParams(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=end_date,
                    interval="1D",
                    source=source,
                )
                data = await VnstockEquityHistoricalFetcher.fetch(params)
                if data:
                    all_series[symbol] = {d.time.strftime("%Y-%m-%d"): d.close for d in data}
            except Exception as e:
                logger.warning(f"Performance fetch failed for {symbol}: {e}")
                continue

        if not all_series:
            return []

        # Get common dates and normalize
        all_dates = sorted(set(d for series in all_series.values() for d in series.keys()))
        if not all_dates:
            return []

        normalized_history = []
        base_prices = {}

        for dt_str in all_dates:
            point_values = {}
            for symbol, series in all_series.items():
                if dt_str in series:
                    current_price = series[dt_str]
                    if symbol not in base_prices:
                        base_prices[symbol] = current_price

                    if base_prices[symbol] > 0:
                        point_values[symbol] = (current_price / base_prices[symbol]) * 100
                    else:
                        point_values[symbol] = 100.0

            if point_values:
                normalized_history.append(PricePerformancePoint(date=dt_str, values=point_values))

        return normalized_history

    async def get_peers(
        self, symbol: str, limit: int = 5, source: str = settings.vnstock_source
    ) -> PeersResponse:
        """
        Find peer companies in the same industry/sector.
        """
        symbol = symbol.upper()
        try:
            all_stocks = await self._get_all_screener_data(source=source)
            if not all_stocks:
                return PeersResponse(symbol=symbol, count=0, peers=[])

            def _normalize_text(value: Any) -> str:
                raw = str(value or "").strip().lower()
                if not raw:
                    return ""
                normalized = (
                    unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
                )
                normalized = re.sub(r"\s+", " ", normalized)
                return normalized.strip()

            def _value(stock: Any, *keys: str) -> Any:
                for key in keys:
                    if isinstance(stock, dict):
                        candidate = stock.get(key)
                    else:
                        candidate = getattr(stock, key, None)
                    if candidate not in (None, ""):
                        return candidate
                return None

            def _as_payload(stock: Any) -> dict[str, Any]:
                if isinstance(stock, dict):
                    return dict(stock)

                payload: dict[str, Any] = {}
                for key in (
                    "symbol",
                    "ticker",
                    "company_name",
                    "organ_name",
                    "organName",
                    "industry",
                    "industry_name",
                    "industryName",
                    "sector",
                    "sector_name",
                    "sectorName",
                    "exchange",
                    "market_cap",
                    "marketCap",
                    "pe",
                    "pe_ratio",
                    "roe",
                    "price",
                    "close",
                    "change_pct",
                    "changePct",
                    "price_change_1d_pct",
                    "price_change_pct",
                    "priceChangePct",
                ):
                    if hasattr(stock, key):
                        payload[key] = getattr(stock, key)
                return payload

            def _to_float(value: Any) -> Optional[float]:
                if value is None:
                    return None
                try:
                    return float(value)
                except (TypeError, ValueError):
                    return None

            def _text(stock: Any, *keys: str) -> Optional[str]:
                value = _value(stock, *keys)
                if value is None:
                    return None
                cleaned = str(value).strip()
                return cleaned or None

            def _market_cap(stock: Any) -> Optional[float]:
                return _to_float(_value(stock, "market_cap", "marketCap"))

            def _price(stock: Any) -> Optional[float]:
                return _to_float(_value(stock, "price", "close"))

            def _change_pct(stock: Any) -> Optional[float]:
                return _to_float(
                    _value(
                        stock,
                        "change_pct",
                        "changePct",
                        "price_change_1d_pct",
                        "price_change_pct",
                        "priceChangePct",
                    )
                )

            def _symbol(stock: Any) -> Optional[str]:
                value = _text(stock, "symbol", "ticker")
                return value.upper() if value else None

            def _industry(stock: Any) -> Optional[str]:
                return _text(stock, "industry", "industry_name", "industryName")

            def _exchange(stock: Any) -> Optional[str]:
                return _text(stock, "exchange")

            def _sector(stock: Any) -> Optional[str]:
                return _text(stock, "sector", "sector_name", "sectorName")

            def _resolve_sector_id(
                industry: Optional[str], sector_hint: Optional[str]
            ) -> Optional[str]:
                combined = " ".join(
                    part
                    for part in [_normalize_text(industry), _normalize_text(sector_hint)]
                    if part
                )
                if not combined:
                    return None

                for sector_id, cfg in VN_SECTORS.items():
                    if sector_id == "vn30":
                        continue
                    tokens = [sector_id, cfg.name, cfg.name_en, *cfg.keywords]
                    for token in tokens:
                        token_text = _normalize_text(token)
                        if token_text and token_text in combined:
                            return sector_id

                return None

            def to_peer(stock: Any) -> PeerCompany:
                return PeerCompany(
                    symbol=_symbol(stock) or "",
                    name=_text(stock, "company_name", "organ_name", "organName"),
                    market_cap=_market_cap(stock),
                    pe_ratio=_to_float(_value(stock, "pe", "pe_ratio")),
                    roe=_to_float(_value(stock, "roe")),
                    price=_price(stock),
                    change_pct=_change_pct(stock),
                    industry=_industry(stock),
                )

            universe: Dict[str, Any] = {}
            for stock in all_stocks:
                stock_symbol = _symbol(stock)
                if not stock_symbol:
                    continue
                if stock_symbol not in universe:
                    universe[stock_symbol] = _as_payload(stock)

            async with async_session_maker() as session:
                latest_snapshot_date = (
                    await session.execute(
                        select(ScreenerSnapshot.snapshot_date)
                        .order_by(desc(ScreenerSnapshot.snapshot_date))
                        .limit(1)
                    )
                ).scalar_one_or_none()

                if latest_snapshot_date is not None:
                    snapshot_rows = (
                        await session.execute(
                            select(
                                ScreenerSnapshot.symbol,
                                ScreenerSnapshot.company_name,
                                ScreenerSnapshot.industry,
                                ScreenerSnapshot.exchange,
                                ScreenerSnapshot.market_cap,
                                ScreenerSnapshot.pe,
                                ScreenerSnapshot.roe,
                                ScreenerSnapshot.price,
                            ).where(ScreenerSnapshot.snapshot_date == latest_snapshot_date)
                        )
                    ).all()

                    stock_rows = (
                        await session.execute(
                            select(
                                Stock.symbol, Stock.sector, Stock.industry, Stock.exchange
                            ).where(Stock.is_active == 1)
                        )
                    ).all()

                    stock_lookup: dict[str, tuple[Optional[str], Optional[str], Optional[str]]] = {
                        str(symbol).upper(): (sector, industry, exchange)
                        for symbol, sector, industry, exchange in stock_rows
                        if symbol
                    }

                    for (
                        snap_symbol,
                        company_name,
                        industry,
                        exchange,
                        market_cap,
                        pe,
                        roe,
                        price,
                    ) in snapshot_rows:
                        if not snap_symbol:
                            continue
                        symbol_key = str(snap_symbol).upper()
                        payload = universe.get(symbol_key) or {"symbol": symbol_key}

                        if payload.get("company_name") in (None, "") and company_name:
                            payload["company_name"] = company_name
                        if payload.get("industry") in (None, "") and industry:
                            payload["industry"] = industry
                        if payload.get("exchange") in (None, "") and exchange:
                            payload["exchange"] = exchange
                        if payload.get("market_cap") in (None, "") and market_cap is not None:
                            payload["market_cap"] = market_cap
                        if payload.get("pe") in (None, "") and pe is not None:
                            payload["pe"] = pe
                        if payload.get("roe") in (None, "") and roe is not None:
                            payload["roe"] = roe
                        if payload.get("price") in (None, "") and price is not None:
                            payload["price"] = price

                        stock_sector, stock_industry, stock_exchange = stock_lookup.get(
                            symbol_key, (None, None, None)
                        )
                        if payload.get("sector") in (None, "") and stock_sector:
                            payload["sector"] = stock_sector
                        if payload.get("industry") in (None, "") and stock_industry:
                            payload["industry"] = stock_industry
                        if payload.get("exchange") in (None, "") and stock_exchange:
                            payload["exchange"] = stock_exchange

                        universe[symbol_key] = payload

            target = universe.get(symbol)
            target_industry = _industry(target)
            target_sector = _sector(target)
            target_exchange = _exchange(target)
            target_market_cap = _market_cap(target) or 0.0

            if (
                target is None
                or not target_industry
                or not target_exchange
                or not target_sector
                or target_market_cap <= 0
            ):
                async with async_session_maker() as session:
                    latest_snapshot = (
                        await session.execute(
                            select(
                                ScreenerSnapshot.industry,
                                ScreenerSnapshot.exchange,
                                ScreenerSnapshot.market_cap,
                                ScreenerSnapshot.price,
                                ScreenerSnapshot.pe,
                                ScreenerSnapshot.roe,
                            )
                            .where(ScreenerSnapshot.symbol == symbol)
                            .order_by(
                                desc(ScreenerSnapshot.snapshot_date),
                                desc(ScreenerSnapshot.created_at),
                            )
                            .limit(1)
                        )
                    ).first()

                    stock_row = (
                        await session.execute(
                            select(Stock.industry, Stock.sector, Stock.exchange)
                            .where(Stock.symbol == symbol)
                            .limit(1)
                        )
                    ).first()

                if latest_snapshot is not None:
                    if not target_industry and latest_snapshot[0]:
                        target_industry = str(latest_snapshot[0]).strip()
                    if not target_exchange and latest_snapshot[1]:
                        target_exchange = str(latest_snapshot[1]).strip()
                    if target_market_cap <= 0:
                        target_market_cap = _to_float(latest_snapshot[2]) or target_market_cap

                if stock_row is not None:
                    if not target_industry and stock_row[0]:
                        target_industry = str(stock_row[0]).strip()
                    if not target_sector and stock_row[1]:
                        target_sector = str(stock_row[1]).strip()
                    if not target_exchange and stock_row[2]:
                        target_exchange = str(stock_row[2]).strip()

            if not target_industry:
                profile_result = await self.cache_manager.get_profile_data(symbol, allow_stale=True)
                if profile_result.hit and profile_result.data:
                    target_industry = target_industry or profile_result.data.industry
                    target_sector = target_sector or profile_result.data.sector
                    target_exchange = target_exchange or profile_result.data.exchange

            target_industry_norm = _normalize_text(target_industry)
            target_sector_id = _resolve_sector_id(target_industry, target_sector)

            candidate_pool = [
                stock for stock_symbol, stock in universe.items() if stock_symbol != symbol
            ]

            def _is_same_industry(stock: Any) -> bool:
                return bool(
                    target_industry_norm
                    and _normalize_text(_industry(stock)) == target_industry_norm
                )

            def _is_same_sector(stock: Any) -> bool:
                if not target_sector_id:
                    return False
                return _resolve_sector_id(_industry(stock), _sector(stock)) == target_sector_id

            peers_list: List[Any] = [stock for stock in candidate_pool if _is_same_industry(stock)]

            if len(peers_list) < min(3, limit):
                existing_symbols = {_symbol(stock) for stock in peers_list if _symbol(stock)}
                sector_candidates = [stock for stock in candidate_pool if _is_same_sector(stock)]
                for candidate in sector_candidates:
                    candidate_symbol = _symbol(candidate)
                    if not candidate_symbol or candidate_symbol in existing_symbols:
                        continue
                    peers_list.append(candidate)
                    existing_symbols.add(candidate_symbol)

            if len(peers_list) < min(3, limit) and target_exchange:
                existing_symbols = {_symbol(stock) for stock in peers_list if _symbol(stock)}
                exchange_candidates = [
                    stock
                    for stock in candidate_pool
                    if (_exchange(stock) or "").upper() == target_exchange.upper()
                ]
                for candidate in exchange_candidates:
                    candidate_symbol = _symbol(candidate)
                    if not candidate_symbol or candidate_symbol in existing_symbols:
                        continue
                    peers_list.append(candidate)
                    existing_symbols.add(candidate_symbol)

            if not peers_list:
                peers_list = candidate_pool

            def _rank(stock: Any) -> tuple[float, float, float, float, float, str]:
                exchange_penalty = (
                    0.0
                    if not target_exchange or (_exchange(stock) or "") == target_exchange
                    else 1.0
                )
                candidate_market_cap = _market_cap(stock)
                if target_market_cap > 0 and candidate_market_cap not in (None, 0):
                    cap_distance = abs(candidate_market_cap - target_market_cap) / target_market_cap
                else:
                    cap_distance = 10_000.0

                industry_penalty = 0.0 if _is_same_industry(stock) else 1.0
                sector_penalty = 0.0 if _is_same_sector(stock) else 1.0

                # Larger market caps are generally more comparable and liquid.
                market_cap_priority = -(candidate_market_cap or 0.0)
                return (
                    industry_penalty,
                    sector_penalty,
                    exchange_penalty,
                    cap_distance,
                    market_cap_priority,
                    _symbol(stock) or "",
                )

            peers_list.sort(key=_rank)

            unique_ranked: List[Any] = []
            seen_symbols: set[str] = set()
            for stock in peers_list:
                stock_symbol = _symbol(stock)
                if not stock_symbol or stock_symbol in seen_symbols:
                    continue
                unique_ranked.append(stock)
                seen_symbols.add(stock_symbol)

            formatted_peers = [to_peer(stock) for stock in unique_ranked[:limit]]

            return PeersResponse(
                symbol=symbol,
                industry=target_industry,
                count=len(formatted_peers),
                peers=formatted_peers,
            )
        except Exception as e:
            logger.exception(f"Error getting peers for {symbol}: {e}")
            return PeersResponse(symbol=symbol, count=0, peers=[])

    async def get_sector_averages(
        self, industry: str, source: str = settings.vnstock_source
    ) -> Dict[str, float]:
        """
        Calculate sector averages for key metrics.
        """
        try:
            all_stocks = await self._get_all_screener_data(source=source)
            if not all_stocks:
                return {}

            target_label = _normalize_text(industry)

            # Filter stocks in the same industry/sector
            sector_stocks = [
                s
                for s in all_stocks
                if target_label
                and target_label
                in {
                    _normalize_text(_record_value(s, "industry", "industry_name", "industryName")),
                    _normalize_text(_record_value(s, "sector")),
                }
            ]

            if not sector_stocks:
                return {}

            # Calculate averages for key metrics
            averages: Dict[str, float] = {}
            metric_keys = [m.key for m in COMPARISON_METRICS]
            sector_symbols = sorted(
                {
                    str(_record_value(stock, "symbol") or "").upper()
                    for stock in sector_stocks
                    if _record_value(stock, "symbol")
                }
            )

            for key in metric_keys:
                values = []
                for stock in sector_stocks:
                    val = _normalize_comparison_metric(
                        key,
                        _record_value(
                            stock,
                            key,
                            f"{key}_ratio",
                            {
                                "pe": "pe_ratio",
                                "pb": "pb_ratio",
                                "ps": "ps_ratio",
                            }.get(key, ""),
                        ),
                    )
                    if val is not None:
                        values.append(val)

                if values:
                    averages[key] = sum(values) / len(values)

            missing_keys = [key for key in metric_keys if key not in averages]
            if missing_keys and sector_symbols:
                async with async_session_maker() as session:
                    ratio_rows = (
                        (
                            await session.execute(
                                select(FinancialRatio)
                                .where(FinancialRatio.symbol.in_(sector_symbols))
                                .order_by(
                                    FinancialRatio.symbol.asc(),
                                    FinancialRatio.fiscal_year.desc(),
                                    FinancialRatio.fiscal_quarter.desc(),
                                    FinancialRatio.updated_at.desc(),
                                )
                            )
                        )
                        .scalars()
                        .all()
                    )

                latest_ratios: Dict[str, FinancialRatio] = {}
                for row in ratio_rows:
                    latest_ratios.setdefault(row.symbol.upper(), row)

                ratio_key_map = {
                    "pe": "pe_ratio",
                    "pb": "pb_ratio",
                    "ps": "ps_ratio",
                    "ev_ebitda": "ev_ebitda",
                    "eps": "eps",
                    "bvps": "bvps",
                    "roe": "roe",
                    "roa": "roa",
                    "roic": "roic",
                    "gross_margin": "gross_margin",
                    "net_margin": "net_margin",
                    "operating_margin": "operating_margin",
                    "revenue_growth": "revenue_growth",
                    "earnings_growth": "earnings_growth",
                    "debt_to_equity": "debt_to_equity",
                    "current_ratio": "current_ratio",
                    "quick_ratio": "quick_ratio",
                }

                for key in missing_keys:
                    attr = ratio_key_map.get(key)
                    if not attr:
                        continue
                    values = [
                        _normalize_comparison_metric(key, getattr(ratio_row, attr, None))
                        for ratio_row in latest_ratios.values()
                    ]
                    clean_values = [value for value in values if value is not None]
                    if clean_values:
                        averages[key] = sum(clean_values) / len(clean_values)

            return averages
        except Exception as e:
            logger.warning(f"Failed to calculate sector averages for {industry}: {e}")
            return {}

    async def compare(
        self, symbols: List[str], source: str = settings.vnstock_source, period: str = "1Y"
    ) -> ComparisonResponse:
        """
        Compare multiple stocks side by side.
        """
        import asyncio

        # Fetch metrics and performance data in parallel
        metrics_tasks = [self.get_stock_metrics(s, source=source) for s in symbols]
        perf_task = self.compare_price_performance(symbols, period=period, source=source)

        metrics_results, price_history = await asyncio.gather(
            asyncio.gather(*metrics_tasks), perf_task
        )

        data = {m.symbol: m for m in metrics_results}

        # Get sector averages from the first stock's industry
        sector_averages: Dict[str, float] = {}
        if metrics_results:
            first_group = metrics_results[0].industry
            if first_group:
                sector_averages = await self.get_sector_averages(first_group, source=source)

        return ComparisonResponse(
            symbols=symbols,
            metrics=COMPARISON_METRICS,
            data=data,
            price_history=price_history,
            sector_averages=sector_averages,
            generated_at=datetime.utcnow(),
        )


# Module-level singleton for convenience
comparison_service = ComparisonService()


async def get_multi_performance_data(
    symbols: List[str],
    days: int = 30,
    period: Optional[str] = None,
):
    """
    Get normalized price performance (%) for multiple symbols.
    """
    resolved_period = period
    if resolved_period is None:
        if days <= 31:
            resolved_period = "1M"
        elif days <= 93:
            resolved_period = "3M"
        elif days <= 186:
            resolved_period = "6M"
        elif days <= 365:
            resolved_period = "1Y"
        elif days <= 365 * 3:
            resolved_period = "3Y"
        else:
            resolved_period = "5Y"

    results = await comparison_service.compare_price_performance(symbols, period=resolved_period)
    # Convert to a format easy for Recharts: [{date: '...', VNM: 100, FPT: 105}, ...]
    formatted = []
    for pt in results:
        entry = {"date": pt.date}
        entry.update(pt.values)
        formatted.append(entry)
    return formatted


async def get_comparison_data(symbols: List[str], period: str = "FY"):
    """
    Get comparison data for a list of symbols and period.
    Returns data compatible with vnibb.models.comparison.StockComparison.
    """
    from vnibb.models.comparison import StockComparison

    results = []
    ratio_period, requested_quarter, _use_ttm = _normalize_ratio_period(period)

    for symbol in symbols:
        stock_metrics = await comparison_service.get_stock_metrics(symbol)

        ratio_snapshot: dict[str, Any] = {}
        derived_metrics = await _build_comparison_backfill(
            symbol,
            period,
            _coerce_number(stock_metrics.metrics.get("market_cap")),
        )
        backfill_needed = any(
            _normalize_comparison_metric(key, stock_metrics.metrics.get(key)) is None
            for key in (
                "gross_margin",
                "operating_margin",
                "net_margin",
                "asset_turnover",
                "debt_assets",
                "debt_to_equity",
                "interest_coverage",
                "debt_service_coverage",
                "ocf_debt",
                "fcf_yield",
                "ocf_sales",
                "revenue_growth",
                "earnings_growth",
            )
        )

        if backfill_needed:
            try:
                async with async_session_maker() as session:
                    stmt = (
                        select(FinancialRatio)
                        .where(
                            FinancialRatio.symbol == symbol,
                            FinancialRatio.period_type == ratio_period,
                        )
                        .order_by(
                            desc(FinancialRatio.fiscal_year),
                            desc(FinancialRatio.fiscal_quarter),
                            desc(FinancialRatio.updated_at),
                        )
                    )
                    db_rows = (await session.execute(stmt)).scalars().all()

                if requested_quarter is not None:
                    db_rows = [
                        row
                        for row in db_rows
                        if _matches_requested_quarter(
                            row.period, row.fiscal_quarter, requested_quarter
                        )
                    ]

                if db_rows:
                    latest = db_rows[0]
                    ratio_snapshot = {
                        "pe": _metric_from_ratio_row(latest, "pe"),
                        "pb": _metric_from_ratio_row(latest, "pb"),
                        "ps": _metric_from_ratio_row(latest, "ps"),
                        "ev_ebitda": _metric_from_ratio_row(latest, "ev_ebitda"),
                        "roe": _metric_from_ratio_row(latest, "roe"),
                        "roa": _metric_from_ratio_row(latest, "roa"),
                        "roic": _metric_from_ratio_row(latest, "roic"),
                        "gross_margin": _metric_from_ratio_row(latest, "gross_margin"),
                        "net_margin": _metric_from_ratio_row(latest, "net_margin"),
                        "operating_margin": _metric_from_ratio_row(latest, "operating_margin"),
                        "current_ratio": _metric_from_ratio_row(latest, "current_ratio"),
                        "quick_ratio": _metric_from_ratio_row(latest, "quick_ratio"),
                        "asset_turnover": _metric_from_ratio_row(latest, "asset_turnover"),
                        "inventory_turnover": _metric_from_ratio_row(latest, "inventory_turnover"),
                        "debt_to_equity": _metric_from_ratio_row(latest, "debt_to_equity"),
                        "debt_assets": _metric_from_ratio_row(latest, "debt_assets"),
                        "interest_coverage": _metric_from_ratio_row(latest, "interest_coverage"),
                        "debt_service_coverage": _metric_from_ratio_row(
                            latest, "debt_service_coverage"
                        ),
                        "ocf_debt": _metric_from_ratio_row(latest, "ocf_debt"),
                        "fcf_yield": _metric_from_ratio_row(latest, "fcf_yield"),
                        "ocf_sales": _metric_from_ratio_row(latest, "ocf_sales"),
                        "revenue_growth": _metric_from_ratio_row(latest, "revenue_growth"),
                        "earnings_growth": _metric_from_ratio_row(latest, "earnings_growth"),
                    }

                if not ratio_snapshot:
                    from vnibb.providers.vnstock.financial_ratios import (
                        FinancialRatiosQueryParams,
                        VnstockFinancialRatiosFetcher,
                    )

                    ratios = await VnstockFinancialRatiosFetcher.fetch(
                        FinancialRatiosQueryParams(symbol=symbol, period=ratio_period)
                    )
                    if requested_quarter is not None:
                        ratios = [
                            row
                            for row in ratios
                            if _matches_requested_quarter(
                                getattr(row, "period", None),
                                None,
                                requested_quarter,
                            )
                        ]
                    if ratios:
                        latest = ratios[0]
                        ratio_snapshot = (
                            latest.model_dump() if hasattr(latest, "model_dump") else {}
                        )

                for metric_key, metric_value in list(ratio_snapshot.items()):
                    ratio_snapshot[metric_key] = _normalize_comparison_metric(
                        metric_key, metric_value
                    )
            except Exception as ratio_err:
                logger.warning(f"Ratio backfill failed for {symbol}: {ratio_err}")

        # Map existing metrics to the new structure
        metrics_map = {
            "pe_ratio": _first_metric_value(
                "pe", stock_metrics.metrics.get("pe"), ratio_snapshot.get("pe")
            ),
            "pb_ratio": _first_metric_value(
                "pb", stock_metrics.metrics.get("pb"), ratio_snapshot.get("pb")
            ),
            "ps_ratio": _first_metric_value(
                "ps", stock_metrics.metrics.get("ps"), ratio_snapshot.get("ps")
            ),
            "ev_ebitda": _first_metric_value(
                "ev_ebitda",
                stock_metrics.metrics.get("ev_ebitda"),
                ratio_snapshot.get("ev_ebitda"),
            ),
            "market_cap": _first_metric_value(
                "market_cap", stock_metrics.metrics.get("market_cap")
            ),
            "roe": _first_metric_value(
                "roe", stock_metrics.metrics.get("roe"), ratio_snapshot.get("roe")
            ),
            "roa": _first_metric_value(
                "roa", stock_metrics.metrics.get("roa"), ratio_snapshot.get("roa")
            ),
            "gross_margin": _first_metric_value(
                "gross_margin",
                stock_metrics.metrics.get("gross_margin"),
                ratio_snapshot.get("gross_margin"),
                derived_metrics.get("gross_margin"),
            ),
            "net_margin": _first_metric_value(
                "net_margin",
                stock_metrics.metrics.get("net_margin"),
                ratio_snapshot.get("net_margin"),
                derived_metrics.get("net_margin"),
            ),
            "operating_margin": _first_metric_value(
                "operating_margin",
                stock_metrics.metrics.get("operating_margin"),
                ratio_snapshot.get("operating_margin"),
                derived_metrics.get("operating_margin"),
            ),
            "current_ratio": _first_metric_value(
                "current_ratio",
                stock_metrics.metrics.get("current_ratio"),
                ratio_snapshot.get("current_ratio"),
            ),
            "quick_ratio": _first_metric_value(
                "quick_ratio",
                stock_metrics.metrics.get("quick_ratio"),
                ratio_snapshot.get("quick_ratio"),
            ),
            "asset_turnover": _first_metric_value(
                "asset_turnover",
                stock_metrics.metrics.get("asset_turnover"),
                ratio_snapshot.get("asset_turnover"),
                derived_metrics.get("asset_turnover"),
            ),
            "inventory_turnover": _first_metric_value(
                "inventory_turnover",
                stock_metrics.metrics.get("inventory_turnover"),
                ratio_snapshot.get("inventory_turnover"),
            ),
            "debt_equity": _first_metric_value(
                "debt_to_equity",
                stock_metrics.metrics.get("debt_to_equity"),
                stock_metrics.metrics.get("debt_equity"),
                ratio_snapshot.get("debt_equity"),
                ratio_snapshot.get("debt_to_equity"),
                derived_metrics.get("debt_to_equity"),
            ),
            "debt_assets": _first_metric_value(
                "debt_assets",
                stock_metrics.metrics.get("debt_assets"),
                stock_metrics.metrics.get("debt_to_asset"),
                ratio_snapshot.get("debt_assets"),
                derived_metrics.get("debt_assets"),
            ),
            "interest_coverage": _first_metric_value(
                "interest_coverage",
                stock_metrics.metrics.get("interest_coverage"),
                ratio_snapshot.get("interest_coverage"),
                derived_metrics.get("interest_coverage"),
            ),
            "debt_service_coverage": _first_metric_value(
                "debt_service_coverage",
                stock_metrics.metrics.get("debt_service_coverage"),
                ratio_snapshot.get("debt_service_coverage"),
                derived_metrics.get("debt_service_coverage"),
            ),
            "ocf_debt": _first_metric_value(
                "ocf_debt",
                stock_metrics.metrics.get("ocf_debt"),
                stock_metrics.metrics.get("ocf_to_debt"),
                ratio_snapshot.get("ocf_debt"),
            ),
            "fcf_yield": _first_metric_value(
                "fcf_yield",
                stock_metrics.metrics.get("fcf_yield"),
                ratio_snapshot.get("fcf_yield"),
                derived_metrics.get("fcf_yield"),
            ),
            "ocf_sales": _first_metric_value(
                "ocf_sales",
                stock_metrics.metrics.get("ocf_sales"),
                ratio_snapshot.get("ocf_sales"),
                derived_metrics.get("ocf_sales"),
            ),
            "revenue_growth": _first_metric_value(
                "revenue_growth",
                stock_metrics.metrics.get("revenue_growth"),
                ratio_snapshot.get("revenue_growth"),
                derived_metrics.get("revenue_growth"),
            ),
            "earnings_growth": _first_metric_value(
                "earnings_growth",
                stock_metrics.metrics.get("earnings_growth"),
                ratio_snapshot.get("earnings_growth"),
                derived_metrics.get("earnings_growth"),
            ),
        }

        results.append(
            StockComparison(
                symbol=symbol, company_name=stock_metrics.name or symbol, metrics=metrics_map
            )
        )

    return results
