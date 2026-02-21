"""
Comparison Analysis Service

Provides side-by-side stock comparison data for multiple tickers.
Aggregates metrics from screener and profile data.

Uses CacheManager for efficient data retrieval instead of fetching
2000 stocks from the live API every time.
"""

import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field

from vnibb.services.cache_manager import CacheManager
from vnibb.core.config import settings

logger = logging.getLogger(__name__)


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

            # Map all available fields into metrics dict
            if hasattr(data, "model_dump"):
                metrics_dict = data.model_dump()
            else:
                # Fallback for ORM objects/other types
                metrics_dict = {
                    key: getattr(data, key)
                    for key in [
                        "price",
                        "volume",
                        "market_cap",
                        "pe",
                        "pb",
                        "ps",
                        "ev_ebitda",
                        "roe",
                        "roa",
                        "roic",
                        "gross_margin",
                        "net_margin",
                        "operating_margin",
                        "revenue_growth",
                        "earnings_growth",
                        "debt_to_equity",
                        "current_ratio",
                        "quick_ratio",
                        "eps",
                        "bvps",
                        "dividend_yield",
                        "foreign_ownership",
                    ]
                    if hasattr(data, key)
                }

            return StockMetrics(
                symbol=symbol,
                name=getattr(data, "company_name", getattr(data, "organ_name", "")),
                industry=getattr(data, "industry", getattr(data, "industry_name", "")),
                exchange=getattr(data, "exchange", ""),
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

            def to_peer(stock: Any, industry: Optional[str]) -> PeerCompany:
                return PeerCompany(
                    symbol=getattr(stock, "symbol", ""),
                    name=getattr(stock, "company_name", getattr(stock, "organ_name", None)),
                    market_cap=getattr(stock, "market_cap", None),
                    pe_ratio=getattr(stock, "pe", None),
                    industry=industry,
                )

            def fallback_peers() -> PeersResponse:
                ranked = sorted(
                    [s for s in all_stocks if getattr(s, "symbol", None) != symbol],
                    key=lambda s: getattr(s, "market_cap", 0) or 0,
                    reverse=True,
                )
                peers = [
                    to_peer(stock, getattr(stock, "industry", None)) for stock in ranked[:limit]
                ]
                return PeersResponse(symbol=symbol, count=len(peers), peers=peers)

            target = next((s for s in all_stocks if getattr(s, "symbol", None) == symbol), None)
            if not target:
                return fallback_peers()

            target_industry = getattr(target, "industry", None) or getattr(
                target, "industry_name", None
            )
            target_market_cap = getattr(target, "market_cap", 0) or 0

            if not target_industry:
                profile_result = await self.cache_manager.get_profile_data(symbol, allow_stale=True)
                if profile_result.hit and profile_result.data:
                    target_industry = profile_result.data.industry

            if not target_industry:
                return fallback_peers()

            peers_list = [
                s
                for s in all_stocks
                if (getattr(s, "industry", None) or getattr(s, "industry_name", None))
                == target_industry
                and getattr(s, "symbol", None) != symbol
            ]

            if target_market_cap > 0:
                peers_list.sort(
                    key=lambda s: abs((getattr(s, "market_cap", 0) or 0) - target_market_cap)
                )

            if not peers_list:
                return fallback_peers()

            formatted_peers = [to_peer(stock, target_industry) for stock in peers_list[:limit]]

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

            # Filter stocks in the same industry
            sector_stocks = [
                s
                for s in all_stocks
                if (getattr(s, "industry", None) or getattr(s, "industry_name", None)) == industry
            ]

            if not sector_stocks:
                return {}

            # Calculate averages for key metrics
            averages: Dict[str, float] = {}
            metric_keys = [m.key for m in COMPARISON_METRICS]

            for key in metric_keys:
                values = []
                for stock in sector_stocks:
                    val = getattr(stock, key, None)
                    if (
                        val is not None and isinstance(val, (int, float)) and not (val != val)
                    ):  # exclude NaN
                        values.append(val)

                if values:
                    averages[key] = sum(values) / len(values)

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
            first_industry = metrics_results[0].industry
            if first_industry:
                sector_averages = await self.get_sector_averages(first_industry, source=source)

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
    ratio_period = "year" if period in {"FY", "year"} else "quarter"

    def pick_value(*values: Optional[float]) -> Optional[float]:
        for value in values:
            if value is not None:
                return value
        return None

    for symbol in symbols:
        stock_metrics = await comparison_service.get_stock_metrics(symbol)

        ratio_snapshot: dict[str, Any] = {}
        backfill_needed = any(
            stock_metrics.metrics.get(key) is None
            for key in (
                "interest_coverage",
                "debt_service_coverage",
                "ocf_debt",
                "fcf_yield",
                "ocf_sales",
            )
        )

        if backfill_needed:
            try:
                from vnibb.providers.vnstock.financial_ratios import (
                    VnstockFinancialRatiosFetcher,
                    FinancialRatiosQueryParams,
                )

                ratios = await VnstockFinancialRatiosFetcher.fetch(
                    FinancialRatiosQueryParams(symbol=symbol, period=ratio_period)
                )
                if ratios:
                    latest = ratios[0]
                    ratio_snapshot = latest.model_dump() if hasattr(latest, "model_dump") else {}
            except Exception as ratio_err:
                logger.warning(f"Ratio backfill failed for {symbol}: {ratio_err}")

        # Map existing metrics to the new structure
        metrics_map = {
            "pe_ratio": pick_value(stock_metrics.metrics.get("pe"), ratio_snapshot.get("pe")),
            "pb_ratio": pick_value(stock_metrics.metrics.get("pb"), ratio_snapshot.get("pb")),
            "ps_ratio": pick_value(stock_metrics.metrics.get("ps"), ratio_snapshot.get("ps")),
            "ev_ebitda": pick_value(
                stock_metrics.metrics.get("ev_ebitda"), ratio_snapshot.get("ev_ebitda")
            ),
            "market_cap": stock_metrics.metrics.get("market_cap"),
            "roe": pick_value(stock_metrics.metrics.get("roe"), ratio_snapshot.get("roe")),
            "roa": pick_value(stock_metrics.metrics.get("roa"), ratio_snapshot.get("roa")),
            "gross_margin": pick_value(
                stock_metrics.metrics.get("gross_margin"), ratio_snapshot.get("gross_margin")
            ),
            "net_margin": pick_value(
                stock_metrics.metrics.get("net_margin"), ratio_snapshot.get("net_margin")
            ),
            "operating_margin": pick_value(
                stock_metrics.metrics.get("operating_margin"),
                ratio_snapshot.get("operating_margin"),
            ),
            "current_ratio": pick_value(
                stock_metrics.metrics.get("current_ratio"), ratio_snapshot.get("current_ratio")
            ),
            "quick_ratio": pick_value(
                stock_metrics.metrics.get("quick_ratio"), ratio_snapshot.get("quick_ratio")
            ),
            "asset_turnover": pick_value(
                stock_metrics.metrics.get("asset_turnover"), ratio_snapshot.get("asset_turnover")
            ),
            "inventory_turnover": pick_value(
                stock_metrics.metrics.get("inventory_turnover"),
                ratio_snapshot.get("inventory_turnover"),
            ),
            "debt_equity": pick_value(
                stock_metrics.metrics.get("debt_to_equity"),
                stock_metrics.metrics.get("debt_equity"),
                ratio_snapshot.get("debt_equity"),
            ),
            "debt_assets": pick_value(
                stock_metrics.metrics.get("debt_assets"),
                stock_metrics.metrics.get("debt_to_asset"),
                ratio_snapshot.get("debt_assets"),
            ),
            "interest_coverage": pick_value(
                stock_metrics.metrics.get("interest_coverage"),
                ratio_snapshot.get("interest_coverage"),
            ),
            "debt_service_coverage": pick_value(
                stock_metrics.metrics.get("debt_service_coverage"),
                ratio_snapshot.get("debt_service_coverage"),
            ),
            "ocf_debt": pick_value(
                stock_metrics.metrics.get("ocf_debt"),
                stock_metrics.metrics.get("ocf_to_debt"),
                ratio_snapshot.get("ocf_debt"),
            ),
            "fcf_yield": pick_value(
                stock_metrics.metrics.get("fcf_yield"), ratio_snapshot.get("fcf_yield")
            ),
            "ocf_sales": pick_value(
                stock_metrics.metrics.get("ocf_sales"), ratio_snapshot.get("ocf_sales")
            ),
        }

        results.append(
            StockComparison(
                symbol=symbol, company_name=stock_metrics.name or symbol, metrics=metrics_map
            )
        )

    return results
