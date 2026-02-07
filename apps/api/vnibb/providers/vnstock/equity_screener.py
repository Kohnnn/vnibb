"""
VnStock Equity Screener Fetcher

Fetches 84 financial metrics for Vietnam-listed stocks via vnstock's
Screener functionality. This is one of the most powerful features,
providing comprehensive fundamental data for stock screening.
"""

import asyncio
import logging
import math
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError, ProviderRateLimitError
from vnibb.providers.vnstock import get_vnstock
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Shared thread pool for parallel fetching across requests
_executor = ThreadPoolExecutor(max_workers=20)


def _is_rate_limit_error(error: Exception) -> bool:
    """Check if error is a rate limit error from VNStock."""
    error_msg = str(error).lower()
    return (
        "quá nhiều" in error_msg  # Vietnamese message
        or "rate limit" in error_msg
        or "429" in error_msg
        or "too many requests" in error_msg
    )


class StockScreenerParams(BaseModel):
    """
    Query parameters for stock screener data.

    The screener provides a comprehensive view of 84 financial metrics
    including valuation ratios, growth metrics, profitability, and more.
    """

    symbol: Optional[str] = Field(
        default=None,
        description="Single stock ticker symbol (e.g., VNM). If None, returns all stocks.",
    )
    exchange: str = Field(
        default="ALL",
        description="Stock exchange filter: HOSE, HNX, UPCOM, or ALL",
    )
    industry: Optional[str] = Field(
        default=None,
        description="Industry filter (e.g., 'Thực phẩm & Đồ uống')",
    )
    limit: int = Field(
        default=100,
        ge=1,
        le=2000,
        description="Maximum number of stocks to return",
    )
    source: str = Field(
        default="KBS",
        description="Data source: KBS (default v3.4.0+), VCI, DNSE, or vnstock (internal)",
    )

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: Optional[str]) -> Optional[str]:
        """Ensure symbol is uppercase if provided."""
        return v.upper().strip() if v else None

    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": None,
                "exchange": "HOSE",
                "industry": None,
                "limit": 100,
                "source": "KBS",
            }
        }
    }


class ScreenerData(BaseModel):
    """
    Standardized screener data with 84 financial metrics.

    Covers: valuation, profitability, growth, liquidity, debt metrics.
    Based on vnstock fin.ratio() output with 37+ columns.
    """

    # ==========================================================================
    # IDENTIFICATION
    # ==========================================================================
    symbol: str = Field(..., description="Stock ticker symbol")
    organ_name: Optional[str] = Field(None, alias="organName", description="Company name")
    exchange: Optional[str] = Field(None, description="Stock exchange (HOSE/HNX/UPCOM)")
    industry_name: Optional[str] = Field(
        None, alias="industryName", description="Industry classification"
    )

    # ==========================================================================
    # PRICE & VOLUME
    # ==========================================================================
    price: Optional[float] = Field(None, description="Current price")
    volume: Optional[float] = Field(None, description="Trading volume")
    market_cap: Optional[float] = Field(
        None, alias="marketCap", description="Market capitalization"
    )
    shares_outstanding: Optional[float] = Field(
        None, alias="sharesOutstanding", description="Shares outstanding (millions)"
    )

    # ==========================================================================
    # VALUATION RATIOS
    # ==========================================================================
    pe: Optional[float] = Field(None, alias="priceToEarning", description="Price-to-Earnings ratio")
    pb: Optional[float] = Field(None, alias="priceToBook", description="Price-to-Book ratio")
    ps: Optional[float] = Field(None, alias="priceToSales", description="Price-to-Sales ratio")
    ev_ebitda: Optional[float] = Field(
        None, alias="valueBeforeEbitda", description="EV/EBITDA ratio"
    )
    ebitda_on_stock: Optional[float] = Field(
        None, alias="ebitdaOnStock", description="EBITDA per share"
    )

    # ==========================================================================
    # PROFITABILITY METRICS
    # ==========================================================================
    roe: Optional[float] = Field(None, description="Return on Equity (%)")
    roa: Optional[float] = Field(None, description="Return on Assets (%)")
    roic: Optional[float] = Field(None, description="Return on Invested Capital (%)")
    gross_margin: Optional[float] = Field(
        None, alias="grossProfitMargin", description="Gross Profit Margin (%)"
    )
    net_margin: Optional[float] = Field(
        None, alias="postTaxMargin", description="Net Profit Margin (%)"
    )
    operating_margin: Optional[float] = Field(
        None, alias="operatingProfitMargin", description="Operating Profit Margin (%)"
    )
    ebit_on_revenue: Optional[float] = Field(
        None, alias="ebitOnRevenue", description="EBIT/Revenue (%)"
    )
    pre_tax_on_ebit: Optional[float] = Field(
        None, alias="preTaxOnEbit", description="Pre-Tax Profit/EBIT (%)"
    )
    post_tax_on_pre_tax: Optional[float] = Field(
        None, alias="postTaxOnPreTax", description="Post-Tax/Pre-Tax (%)"
    )

    # ==========================================================================
    # PER SHARE DATA
    # ==========================================================================
    eps: Optional[float] = Field(
        None, alias="earningPerShare", description="Earnings per Share (VND)"
    )
    bvps: Optional[float] = Field(
        None, alias="bookValuePerShare", description="Book Value per Share (VND)"
    )
    eps_change: Optional[float] = Field(None, alias="epsChange", description="EPS YoY Change (%)")
    bvps_change: Optional[float] = Field(
        None, alias="bookValuePerShareChange", description="BVPS YoY Change (%)"
    )
    ebitda_on_stock_change: Optional[float] = Field(
        None, alias="ebitdaOnStockChange", description="EBITDA/Share YoY Change (%)"
    )

    # ==========================================================================
    # GROWTH METRICS
    # ==========================================================================
    revenue_growth: Optional[float] = Field(
        None, alias="revenueGrowth", description="Revenue Growth YoY (%)"
    )
    earnings_growth: Optional[float] = Field(
        None, alias="earningsGrowth", description="Earnings Growth YoY (%)"
    )
    net_profit_growth: Optional[float] = Field(
        None, alias="netProfitGrowth", description="Net Profit Growth YoY (%)"
    )

    # ==========================================================================
    # DIVIDEND
    # ==========================================================================
    dividend_yield: Optional[float] = Field(
        None, alias="dividendYield", description="Dividend Yield (%)"
    )

    # ==========================================================================
    # LIQUIDITY RATIOS
    # ==========================================================================
    current_ratio: Optional[float] = Field(
        None, alias="currentPayment", description="Current Ratio"
    )
    quick_ratio: Optional[float] = Field(None, alias="quickPayment", description="Quick Ratio")
    days_receivable: Optional[float] = Field(
        None, alias="daysReceivable", description="Days Receivable"
    )
    days_payable: Optional[float] = Field(None, alias="daysPayable", description="Days Payable")

    # ==========================================================================
    # CAPITAL STRUCTURE & DEBT METRICS
    # ==========================================================================
    debt_to_equity: Optional[float] = Field(
        None, alias="debtOnEquity", description="Debt-to-Equity ratio"
    )
    debt_to_asset: Optional[float] = Field(
        None, alias="debtOnAsset", description="Debt-to-Asset ratio"
    )
    debt_to_ebitda: Optional[float] = Field(
        None, alias="debtOnEbitda", description="Debt/EBITDA ratio"
    )
    equity_on_total_asset: Optional[float] = Field(
        None, alias="equityOnTotalAsset", description="Equity/Total Assets (%)"
    )
    equity_on_liability: Optional[float] = Field(
        None, alias="equityOnLiability", description="Equity/Liability ratio"
    )
    asset_on_equity: Optional[float] = Field(
        None, alias="assetOnEquity", description="Asset/Equity ratio (leverage)"
    )
    payable_on_equity: Optional[float] = Field(
        None, alias="payableOnEquity", description="Payable/Equity ratio"
    )
    capital_balance: Optional[float] = Field(
        None, alias="capitalBalance", description="Capital balance"
    )
    short_on_long_debt: Optional[float] = Field(
        None, alias="shortOnLongDebt", description="Short-term/Long-term Debt"
    )

    # ==========================================================================
    # CASH METRICS
    # ==========================================================================
    cash_on_equity: Optional[float] = Field(
        None, alias="cashOnEquity", description="Cash/Equity ratio"
    )
    cash_on_capitalize: Optional[float] = Field(
        None, alias="cashOnCapitalize", description="Cash/Capitalization ratio"
    )

    # ==========================================================================
    # EFFICIENCY METRICS
    # ==========================================================================
    revenue_on_asset: Optional[float] = Field(
        None, alias="revenueOnAsset", description="Revenue/Asset ratio (asset turnover)"
    )
    revenue_on_work_capital: Optional[float] = Field(
        None, alias="revenueOnWorkCapital", description="Revenue/Working Capital"
    )
    capex_on_fixed_asset: Optional[float] = Field(
        None, alias="capexOnFixedAsset", description="CapEx/Fixed Asset ratio"
    )

    # ==========================================================================
    # OWNERSHIP
    # ==========================================================================
    foreign_ownership: Optional[float] = Field(
        None, alias="foreignOwnership", description="Foreign Ownership (%)"
    )
    state_ownership: Optional[float] = Field(
        None, alias="stateOwnership", description="State Ownership (%)"
    )

    # ==========================================================================
    # TIMESTAMP
    # ==========================================================================
    year: Optional[int] = Field(None, description="Fiscal year of the data")
    quarter: Optional[int] = Field(None, description="Fiscal quarter (1-4)")
    updated_at: Optional[datetime] = Field(None, description="Data update timestamp")

    @model_validator(mode="before")
    @classmethod
    def sanitize_nan_values(cls, data: Any) -> Any:
        """Convert NaN and infinity values to None for JSON serialization safety.

        Handles:
        - Python float NaN/inf
        - Numpy float64 NaN/inf
        - Pandas NA values
        """
        if isinstance(data, dict):
            for key in list(data.keys()):
                value = data[key]
                # Handle None explicitly first
                if value is None:
                    continue
                # Check for numeric types that might contain NaN/inf
                try:
                    # Use the != trick: NaN is the only value not equal to itself
                    if value != value:  # NaN check
                        data[key] = None
                    elif isinstance(value, float):
                        if math.isnan(value) or math.isinf(value):
                            data[key] = None
                except (TypeError, ValueError):
                    # Not a comparable value, skip
                    pass
        return data

    model_config = {
        "populate_by_name": True,
        "ser_json_timedelta": "iso8601",
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "organ_name": "CTCP Sữa Việt Nam",
                "exchange": "HOSE",
                "pe": 18.5,
                "pb": 4.2,
                "roe": 28.5,
                "roa": 15.2,
                "eps": 4500,
                "bvps": 18025.78,
                "gross_margin": 42.5,
                "net_margin": 18.3,
                "debt_to_equity": 0.35,
                "current_ratio": 2.1,
                "market_cap": 180000000000000.0,
            }
        },
    }

    def model_dump(self, **kwargs):
        """Override to always use field names, not aliases."""
        kwargs.setdefault("by_alias", False)
        return super().model_dump(**kwargs)

    def model_dump_json(self, **kwargs):
        """Override to always use field names, not aliases."""
        kwargs.setdefault("by_alias", False)
        return super().model_dump_json(**kwargs)


from vnibb.core.retry import vnstock_cb, circuit_breaker


class VnstockScreenerFetcher(BaseFetcher[StockScreenerParams, ScreenerData]):
    """
    Fetcher for stock screener data via vnstock library.

    Returns 84 financial metrics for stock screening and analysis.
    Can filter by exchange, industry, or fetch a single stock.
    """

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: StockScreenerParams) -> dict[str, Any]:
        """Transform query params to vnstock-compatible format."""
        return {
            "symbol": params.symbol,
            "exchange": params.exchange if params.exchange != "ALL" else None,
            "industry": params.industry,
            "limit": params.limit,
            "source": params.source,
        }

    @staticmethod
    @circuit_breaker(vnstock_cb)
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        """
        Fetch screener data from vnstock.

        vnstock.stock().company.ratio_summary() returns financial metrics.
        We also fetch price/volume from quote.history() and company name from Listing.
        """
        loop = asyncio.get_running_loop()

        def _fetch_sync() -> List[dict[str, Any]]:
            """Synchronous fetch wrapped for executor."""
            try:
                from vnstock import Listing
                from datetime import datetime, timedelta

                stock = get_vnstock()
                source = query.get("source", "KBS")

                def _extract_ratio_snapshot(stock_obj: Any) -> dict[str, Any]:
                    """Extract latest ratio snapshot from vnstock finance.ratio output."""
                    ratio_df = stock_obj.finance.ratio(period="year")
                    if ratio_df is None or ratio_df.empty:
                        return {}

                    # New vnstock format: row-based (item/item_id + year columns)
                    if "item_id" in ratio_df.columns:
                        records = ratio_df.to_dict("records")
                        year_cols = sorted(
                            [c for c in ratio_df.columns if str(c).isdigit()],
                            reverse=True,
                        )
                        if not year_cols:
                            return {}
                        latest_year = str(year_cols[0])

                        metrics: dict[str, Any] = {
                            "year_report": int(latest_year),
                        }
                        metric_map = {
                            "p_e": "pe",
                            "p_b": "pb",
                            "p_s": "ps",
                            "roe": "roe",
                            "roa": "roa",
                            "trailing_eps": "eps",
                            "book_value_per_share_bvps": "bvps",
                            "gross_profit_margin": "gross_margin",
                            "net_profit_margin": "net_margin",
                            "short_term_ratio": "current_ratio",
                            "quick_ratio": "quick_ratio",
                        }

                        liabilities = None
                        owners_equity = None
                        for row in records:
                            item_id = row.get("item_id")
                            if not item_id:
                                continue
                            value = row.get(latest_year)
                            if value is None:
                                continue
                            if item_id in metric_map:
                                metrics[metric_map[item_id]] = value
                            elif item_id == "liabilities":
                                liabilities = value
                            elif item_id == "owners_equity":
                                owners_equity = value

                        if (
                            metrics.get("de") is None
                            and liabilities is not None
                            and owners_equity not in (None, 0)
                        ):
                            metrics["de"] = liabilities / owners_equity

                        return metrics

                    # Legacy format: one row per period with columns already normalized
                    return ratio_df.head(1).to_dict("records")[0]

                # Get company names mapping from Listing
                listing = Listing(source=source)
                symbols_df = listing.all_symbols()
                name_map = {}
                if symbols_df is not None and not symbols_df.empty:
                    name_map = dict(zip(symbols_df["symbol"], symbols_df["organ_name"]))

                # If single symbol requested, get that specific stock's data
                if query["symbol"]:
                    screener = stock.stock(symbol=query["symbol"], source=source)

                    record = _extract_ratio_snapshot(screener)
                    if record:
                        record["ticker"] = query["symbol"]
                        record["organ_name"] = name_map.get(query["symbol"], "")

                        # Debug: Log key valuation metrics
                        logger.debug(
                            f"Valuation metrics for {query['symbol']}: "
                            f"pe={record.get('pe')}, pb={record.get('pb')}, "
                            f"ps={record.get('ps')}, roe={record.get('roe')}, de={record.get('de')}"
                        )

                        # Get latest price/volume from quote.history()
                        try:
                            end_date = datetime.now()
                            start_date = end_date - timedelta(days=7)
                            hist = screener.quote.history(
                                start=start_date.strftime("%Y-%m-%d"),
                                end=end_date.strftime("%Y-%m-%d"),
                            )
                            if hist is not None and not hist.empty:
                                latest = hist.iloc[-1]
                                record["price"] = latest.get("close")
                                record["volume"] = latest.get("volume")
                        except Exception as e:
                            logger.debug(f"Failed to get quote for {query['symbol']}: {e}")

                        return [record]
                    return []

                # For full stock list, use Listing to get symbols, then fetch ratio_summary for each
                exchange = query.get("exchange")

                # Get all symbols for the exchange
                all_symbols_df = listing.all_symbols(exchange=exchange)
                if all_symbols_df is None or all_symbols_df.empty:
                    logger.warning("No symbols found for exchange: %s", exchange)
                    return []

                symbols = all_symbols_df["symbol"].tolist()
                limit = query.get("limit", 100)
                symbols = symbols[:limit]  # Limit the number of symbols

                logger.info(
                    "Fetching screener ratios for %d symbols from %s (source: %s) in parallel",
                    len(symbols),
                    exchange or "ALL",
                    source,
                )

                def _fetch_single_stock(symbol: str) -> Optional[dict[str, Any]]:
                    """Fetch data for a single stock."""
                    try:
                        stock_obj = stock.stock(symbol=symbol, source=source)
                        record = _extract_ratio_snapshot(stock_obj)
                        if record:
                            record["ticker"] = symbol
                            record["organ_name"] = name_map.get(symbol, "")

                            # Get latest price/volume
                            try:
                                # Use a slightly longer window to ensure we get data
                                end_date = datetime.now()
                                start_date = end_date - timedelta(days=10)
                                hist = stock_obj.quote.history(
                                    start=start_date.strftime("%Y-%m-%d"),
                                    end=end_date.strftime("%Y-%m-%d"),
                                )
                                if hist is not None and not hist.empty:
                                    latest = hist.iloc[-1]
                                    record["price"] = latest.get("close")
                                    record["volume"] = latest.get("volume")
                            except Exception as e:
                                logger.debug(f"Failed to get quote for {symbol}: {e}")

                            return record
                    except Exception as e:
                        error_msg = str(e)
                        if "quá nhiều" in error_msg or "rate" in error_msg.lower():
                            # Raise specific error to stop the whole executor if rate limited
                            logger.warning(f"Rate limit hit while fetching {symbol}")
                            raise e
                        logger.debug("Failed to fetch screener ratio for %s: %s", symbol, e)
                    return None

                results = []
                # Use shared executor to avoid blocking on shutdown
                max_workers = min(len(symbols), 20)

                from concurrent.futures import as_completed, TimeoutError

                future_to_symbol = {_executor.submit(_fetch_single_stock, s): s for s in symbols}
                try:
                    # Add a slightly shorter timeout for the parallel batch than the global one
                    batch_timeout = settings.vnstock_timeout - 5
                    for future in as_completed(future_to_symbol, timeout=batch_timeout):
                        try:
                            res = future.result()
                            if res:
                                results.append(res)
                        except Exception as e:
                            error_msg = str(e)
                            if "quá nhiều" in error_msg or "rate" in error_msg.lower():
                                logger.warning("Rate limit detected in batch")
                                # We can't easily cancel running futures, but we can stop processing
                                break
                except TimeoutError:
                    logger.warning(f"Parallel screener fetch timed out after {batch_timeout}s")

                logger.info("Fetched ratio data for %d/%d stocks", len(results), len(symbols))
                return results

            except Exception as e:
                if _is_rate_limit_error(e):
                    logger.warning(f"VNStock rate limit hit in _fetch_sync: {e}")
                    raise ProviderRateLimitError(provider="vnstock", retry_after=60)

                logger.error(f"vnstock screener fetch error: {e}")
                raise ProviderError(
                    message=str(e),
                    provider="vnstock",
                    details={"query": query},
                )

        try:
            # Use shared executor to avoid "Executor shutdown" errors and blocking on timeout
            return await asyncio.wait_for(
                loop.run_in_executor(_executor, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(
                provider="vnstock",
                timeout=settings.vnstock_timeout,
            )

    @staticmethod
    def transform_data(
        params: StockScreenerParams,
        data: List[dict[str, Any]],
    ) -> List[ScreenerData]:
        """
        Transform raw vnstock screener response to standardized ScreenerData.

        Maps vnstock column names to our standardized schema.
        """
        results: List[ScreenerData] = []

        # Column name mapping from vnstock to our schema
        # VCI ratio_summary uses snake_case format (verified via test_valuation.py)
        # Maps vnstock columns to ScreenerData fields
        field_mapping = {
            # Symbol/Ticker
            "ticker": "symbol",
            "symbol": "symbol",
            # Company info (from Listing)
            "organ_name": "organ_name",
            "organName": "organ_name",
            "exchange": "exchange",
            "industryName": "industry_name",
            "industry_name": "industry_name",
            # Price & Volume (from quote.history)
            "price": "price",
            "close": "price",
            "volume": "volume",
            # Market Cap & Shares
            "marketCap": "market_cap",
            "market_cap": "market_cap",
            "charter_capital": "market_cap",
            "shares_outstanding": "shares_outstanding",
            "issue_share": "shares_outstanding",  # vnstock 3.x actual column
            # =================================================================
            # VALUATION RATIOS (verified from vnstock 3.x ratio_summary)
            # =================================================================
            "pe": "pe",
            "price_to_earning": "pe",
            "pb": "pb",
            "price_to_book": "pb",
            "ps": "ps",
            "price_to_sales": "ps",
            "ev_per_ebitda": "ev_ebitda",  # vnstock 3.x actual column name
            "evEbitda": "ev_ebitda",
            "ev_ebitda": "ev_ebitda",
            "value_before_ebitda": "ev_ebitda",
            "pcf": "price_to_cash_flow",  # vnstock 3.x actual column
            "ebitda_on_stock": "ebitda_on_stock",
            # =================================================================
            # PROFITABILITY METRICS (verified from vnstock 3.x ratio_summary)
            # Note: vnstock returns decimals (0.26), not percentages (26%)
            # =================================================================
            "roe": "roe",
            "roa": "roa",
            "roic": "roic",
            "gross_margin": "gross_margin",  # vnstock 3.x actual column
            "grossMargin": "gross_margin",
            "gross_profit_margin": "gross_margin",
            "net_profit_margin": "net_margin",  # vnstock 3.x actual column name
            "netMargin": "net_margin",
            "net_margin": "net_margin",
            "post_tax_margin": "net_margin",
            "ebit_margin": "operating_margin",  # vnstock 3.x actual column
            "operatingMargin": "operating_margin",
            "operating_margin": "operating_margin",
            "operating_profit_margin": "operating_margin",
            "ebit_on_revenue": "ebit_on_revenue",
            "pre_tax_on_ebit": "pre_tax_on_ebit",
            "post_tax_on_pre_tax": "post_tax_on_pre_tax",
            # =================================================================
            # PER SHARE DATA (verified from vnstock 3.x ratio_summary)
            # =================================================================
            "eps": "eps",
            "eps_ttm": "eps",  # vnstock 3.x has both eps and eps_ttm
            "earning_per_share": "eps",
            "bvps": "bvps",
            "book_value_per_share": "bvps",
            "eps_change": "eps_change",
            "book_value_per_share_change": "bvps_change",
            "ebitda_on_stock_change": "ebitda_on_stock_change",
            # =================================================================
            # GROWTH METRICS (verified from vnstock 3.x ratio_summary)
            # Note: vnstock returns decimals (0.05), not percentages (5%)
            # =================================================================
            "revenue_growth": "revenue_growth",  # vnstock 3.x actual column
            "revenueGrowth": "revenue_growth",
            "net_profit_growth": "earnings_growth",  # vnstock 3.x actual column
            "earningsGrowth": "earnings_growth",
            "netProfitGrowth": "net_profit_growth",
            # =================================================================
            # DIVIDEND (verified from vnstock 3.x ratio_summary)
            # =================================================================
            "dividend": "dividend_yield",  # vnstock 3.x actual column
            "dividendYield": "dividend_yield",
            "dividend_yield": "dividend_yield",
            # =================================================================
            # LIQUIDITY RATIOS (verified from vnstock 3.x ratio_summary)
            # =================================================================
            "current_ratio": "current_ratio",  # vnstock 3.x actual column
            "currentRatio": "current_ratio",
            "current_payment": "current_ratio",
            "quick_ratio": "quick_ratio",  # vnstock 3.x actual column
            "quickRatio": "quick_ratio",
            "quick_payment": "quick_ratio",
            "cash_ratio": "cash_ratio",  # vnstock 3.x actual column
            "dso": "days_receivable",  # vnstock 3.x: Days Sales Outstanding
            "days_receivable": "days_receivable",
            "daysReceivable": "days_receivable",
            "dpo": "days_payable",  # vnstock 3.x: Days Payable Outstanding
            "days_payable": "days_payable",
            "daysPayable": "days_payable",
            "acp": "avg_collection_period",  # vnstock 3.x: Average Collection Period
            "ccc": "cash_conversion_cycle",  # vnstock 3.x: Cash Conversion Cycle
            # =================================================================
            # CAPITAL STRUCTURE & DEBT METRICS (verified from vnstock 3.x)
            # =================================================================
            "de": "debt_to_equity",  # vnstock 3.x actual column name
            "debtToEquity": "debt_to_equity",
            "debt_to_equity": "debt_to_equity",
            "debt_on_equity": "debt_to_equity",
            "le": "leverage",  # vnstock 3.x: Leverage ratio
            "ae": "asset_to_equity",  # vnstock 3.x: Asset to Equity
            "debt_on_asset": "debt_to_asset",
            "debtOnAsset": "debt_to_asset",
            "debt_on_ebitda": "debt_to_ebitda",
            "debtOnEbitda": "debt_to_ebitda",
            "equity_on_total_asset": "equity_on_total_asset",
            "equityOnTotalAsset": "equity_on_total_asset",
            "equity_on_liability": "equity_on_liability",
            "equityOnLiability": "equity_on_liability",
            "asset_on_equity": "asset_on_equity",
            "assetOnEquity": "asset_on_equity",
            "payable_on_equity": "payable_on_equity",
            "payableOnEquity": "payable_on_equity",
            "capital_balance": "capital_balance",
            "capitalBalance": "capital_balance",
            "short_on_long_debt": "short_on_long_debt",
            "interest_coverage": "interest_coverage",  # vnstock 3.x actual column
            # =================================================================
            # CASH METRICS
            # =================================================================
            "cash_on_equity": "cash_on_equity",
            "cashOnEquity": "cash_on_equity",
            "cash_on_capitalize": "cash_on_capitalize",
            "cashOnCapitalize": "cash_on_capitalize",
            # =================================================================
            # EFFICIENCY METRICS (verified from vnstock 3.x ratio_summary)
            # =================================================================
            "at": "asset_turnover",  # vnstock 3.x: Asset Turnover
            "fat": "fixed_asset_turnover",  # vnstock 3.x: Fixed Asset Turnover
            "revenue_on_asset": "revenue_on_asset",
            "revenueOnAsset": "revenue_on_asset",
            "revenue_on_work_capital": "revenue_on_work_capital",
            "revenueOnWorkCapital": "revenue_on_work_capital",
            "capex_on_fixed_asset": "capex_on_fixed_asset",
            "capexOnFixedAsset": "capex_on_fixed_asset",
            # =================================================================
            # OWNERSHIP
            # =================================================================
            "foreignOwnership": "foreign_ownership",
            "foreign_ownership": "foreign_ownership",
            "stateOwnership": "state_ownership",
            "state_ownership": "state_ownership",
            # =================================================================
            # TIME PERIOD (verified from vnstock 3.x ratio_summary)
            # =================================================================
            "year_report": "year",  # vnstock 3.x actual column
            "year": "year",
            "quarter": "quarter",
            "length_report": "quarter",  # vnstock 3.x: 3 = Q3, 4 = Q4, etc.
        }

        for row in data:
            try:
                # Map fields
                mapped = {}
                for src_key, dst_key in field_mapping.items():
                    if src_key in row:
                        mapped[dst_key] = row[src_key]

                # Ensure symbol is present
                if "symbol" not in mapped:
                    mapped["symbol"] = row.get("ticker") or row.get("symbol") or "UNKNOWN"

                mapped["updated_at"] = datetime.utcnow()

                results.append(ScreenerData(**mapped))

            except Exception as e:
                logger.warning(f"Skipping invalid screener row: {e}")
                continue

        return results
