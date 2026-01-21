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
            
            from vnibb.providers.vnstock import VnstockScreenerFetcher, StockScreenerParams
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
    
    async def get_stock_metrics(self, symbol: str, source: str = settings.vnstock_source) -> StockMetrics:
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
                from vnibb.providers.vnstock import VnstockScreenerFetcher, StockScreenerParams
                params = StockScreenerParams(symbol=symbol, limit=1, source=source)
                results = await VnstockScreenerFetcher.fetch(params)
                if results:
                    data = results[0]
            
            if not data:
                return StockMetrics(symbol=symbol)
            
            # Map all available fields into metrics dict
            if hasattr(data, 'model_dump'):
                metrics_dict = data.model_dump()
            else:
                # Fallback for ORM objects/other types
                metrics_dict = {
                    key: getattr(data, key) 
                    for key in [
                        "price", "volume", "market_cap", "pe", "pb", "ps", "ev_ebitda",
                        "roe", "roa", "roic", "gross_margin", "net_margin", "operating_margin",
                        "revenue_growth", "earnings_growth", "debt_to_equity", "current_ratio",
                        "quick_ratio", "eps", "bvps", "dividend_yield", "foreign_ownership"
                    ]
                    if hasattr(data, key)
                }

            return StockMetrics(
                symbol=symbol,
                name=getattr(data, "company_name", getattr(data, "organ_name", "")),
                industry=getattr(data, "industry", getattr(data, "industry_name", "")),
                exchange=getattr(data, "exchange", ""),
                metrics=metrics_dict
            )
        except Exception as e:
            logger.exception(f"Failed to fetch metrics for {symbol}: {e}")
            return StockMetrics(symbol=symbol)
    
    async def compare_price_performance(
        self, 
        symbols: List[str], 
        period: str = "1Y",
        source: str = settings.vnstock_source
    ) -> List[PricePerformancePoint]:
        """
        Compare historical price performance normalized to 100 at the start.
        """
        from vnibb.providers.vnstock import VnstockEquityHistoricalFetcher, EquityHistoricalQueryParams
        from datetime import date, timedelta
        
        end_date = date.today()
        if period == "1M": start_date = end_date - timedelta(days=30)
        elif period == "3M": start_date = end_date - timedelta(days=90)
        elif period == "6M": start_date = end_date - timedelta(days=180)
        elif period == "YTD": start_date = date(end_date.year, 1, 1)
        elif period == "ALL": start_date = end_date - timedelta(days=365*5)
        else: start_date = end_date - timedelta(days=365)
        
        # Fetch historical data for all symbols
        all_series = {}
        for symbol in symbols:
            params = EquityHistoricalQueryParams(
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
                interval="1D",
                source=source
            )
            data = await VnstockEquityHistoricalFetcher.fetch(params)
            if data:
                all_series[symbol] = {d.time.strftime("%Y-%m-%d"): d.close for d in data}
        
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

    async def get_peers(self, symbol: str, limit: int = 5, source: str = settings.vnstock_source) -> PeersResponse:
        """
        Find peer companies in the same industry/sector.
        """
        symbol = symbol.upper()
        try:
            all_stocks = await self._get_all_screener_data(source=source)
            if not all_stocks:
                return PeersResponse(symbol=symbol, count=0, peers=[])
            
            target = next((s for s in all_stocks if getattr(s, 'symbol', None) == symbol), None)
            if not target:
                return PeersResponse(symbol=symbol, count=0, peers=[])
            
            target_industry = getattr(target, 'industry', None) or getattr(target, 'industry_name', None)
            target_market_cap = getattr(target, 'market_cap', 0) or 0
            
            if not target_industry:
                profile_result = await self.cache_manager.get_profile_data(symbol, allow_stale=True)
                if profile_result.hit and profile_result.data:
                    target_industry = profile_result.data.industry
            
            if not target_industry:
                return PeersResponse(symbol=symbol, count=0, peers=[])
            
            peers_list = [
                s for s in all_stocks 
                if (getattr(s, 'industry', None) or getattr(s, 'industry_name', None)) == target_industry 
                and getattr(s, 'symbol', None) != symbol
            ]
            
            if target_market_cap > 0:
                peers_list.sort(key=lambda s: abs((getattr(s, 'market_cap', 0) or 0) - target_market_cap))
            
            formatted_peers = [
                PeerCompany(
                    symbol=getattr(stock, 'symbol', ''),
                    name=getattr(stock, 'company_name', getattr(stock, 'organ_name', None)),
                    market_cap=getattr(stock, 'market_cap', None),
                    pe_ratio=getattr(stock, 'pe', None),
                    industry=target_industry,
                )
                for stock in peers_list[:limit]
            ]
            
            return PeersResponse(
                symbol=symbol,
                industry=target_industry,
                count=len(formatted_peers),
                peers=formatted_peers
            )
        except Exception as e:
            logger.exception(f"Error getting peers for {symbol}: {e}")
            return PeersResponse(symbol=symbol, count=0, peers=[])
    
    async def get_sector_averages(self, industry: str, source: str = settings.vnstock_source) -> Dict[str, float]:
        """
        Calculate sector averages for key metrics.
        """
        try:
            all_stocks = await self._get_all_screener_data(source=source)
            if not all_stocks:
                return {}
            
            # Filter stocks in the same industry
            sector_stocks = [
                s for s in all_stocks
                if (getattr(s, 'industry', None) or getattr(s, 'industry_name', None)) == industry
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
                    if val is not None and isinstance(val, (int, float)) and not (val != val):  # exclude NaN
                        values.append(val)
                
                if values:
                    averages[key] = sum(values) / len(values)
            
            return averages
        except Exception as e:
            logger.warning(f"Failed to calculate sector averages for {industry}: {e}")
            return {}

    async def compare(self, symbols: List[str], source: str = settings.vnstock_source, period: str = "1Y") -> ComparisonResponse:
        """
        Compare multiple stocks side by side.
        """
        import asyncio
        
        # Fetch metrics and performance data in parallel
        metrics_tasks = [self.get_stock_metrics(s, source=source) for s in symbols]
        perf_task = self.compare_price_performance(symbols, period=period, source=source)
        
        metrics_results, price_history = await asyncio.gather(
            asyncio.gather(*metrics_tasks),
            perf_task
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
            generated_at=datetime.utcnow()
        )


# Module-level singleton for convenience
comparison_service = ComparisonService()


async def get_multi_performance_data(symbols: List[str], days: int = 30):
    """
    Get normalized price performance (%) for multiple symbols.
    """
    results = await comparison_service.compare_price_performance(symbols, period="1M" if days <= 30 else "1Y")
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
    for symbol in symbols:
        stock_metrics = await comparison_service.get_stock_metrics(symbol)
        
        # Map existing metrics to the new structure
        metrics_map = {
            "pe_ratio": stock_metrics.metrics.get("pe"),
            "pb_ratio": stock_metrics.metrics.get("pb"),
            "ps_ratio": stock_metrics.metrics.get("ps"),
            "ev_ebitda": stock_metrics.metrics.get("ev_ebitda"),
            "market_cap": stock_metrics.metrics.get("market_cap"),
            "roe": stock_metrics.metrics.get("roe"),
            "roa": stock_metrics.metrics.get("roa"),
            "gross_margin": stock_metrics.metrics.get("gross_margin"),
            "net_margin": stock_metrics.metrics.get("net_margin"),
            "operating_margin": stock_metrics.metrics.get("operating_margin"),
            "current_ratio": stock_metrics.metrics.get("current_ratio"),
            "quick_ratio": stock_metrics.metrics.get("quick_ratio"),
            "asset_turnover": stock_metrics.metrics.get("asset_turnover"),
            "inventory_turnover": stock_metrics.metrics.get("inventory_turnover"),
            "debt_equity": stock_metrics.metrics.get("debt_to_equity"),
            "debt_assets": stock_metrics.metrics.get("debt_assets"),
        }
        
        results.append(StockComparison(
            symbol=symbol,
            company_name=stock_metrics.name or symbol,
            metrics=metrics_map
        ))
    
    return results

