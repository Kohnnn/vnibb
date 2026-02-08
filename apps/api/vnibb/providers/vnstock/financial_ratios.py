"""
VnStock Financial Ratios Fetcher

Fetches historical financial ratios for Vietnam-listed companies.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class FinancialRatiosQueryParams(BaseModel):
    """Query parameters for financial ratios."""

    symbol: str = Field(..., min_length=1, max_length=10)
    period: str = Field(default="year", pattern=r"^(year|quarter)$")

    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class FinancialRatioData(BaseModel):
    """Standardized financial ratio data."""

    symbol: str
    period: Optional[str] = None  # 2024, Q3/2024
    pe: Optional[float] = None
    pb: Optional[float] = None
    ps: Optional[float] = None
    ev_ebitda: Optional[float] = None
    ev_sales: Optional[float] = None
    roe: Optional[float] = None
    roa: Optional[float] = None
    eps: Optional[float] = None
    bvps: Optional[float] = None
    debt_equity: Optional[float] = None
    debt_assets: Optional[float] = None
    equity_multiplier: Optional[float] = None
    current_ratio: Optional[float] = None
    quick_ratio: Optional[float] = None
    cash_ratio: Optional[float] = None
    asset_turnover: Optional[float] = None
    inventory_turnover: Optional[float] = None
    receivables_turnover: Optional[float] = None
    gross_margin: Optional[float] = None
    net_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    interest_coverage: Optional[float] = None
    debt_service_coverage: Optional[float] = None
    ocf_debt: Optional[float] = None
    fcf_yield: Optional[float] = None
    ocf_sales: Optional[float] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "period": "2024",
                "pe": 15.5,
                "pb": 3.2,
                "roe": 25.8,
            }
        }
    }


class VnstockFinancialRatiosFetcher(BaseFetcher[FinancialRatiosQueryParams, FinancialRatioData]):
    """Fetcher for financial ratios via vnstock."""

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: FinancialRatiosQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "period": params.period}

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_event_loop()

        def _fetch_sync() -> List[dict[str, Any]]:
            try:
                from vnstock import Vnstock

                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                finance = stock.finance
                df = finance.ratio(period=query.get("period", "year"))

                if df is None or df.empty:
                    return []

                if "period" not in df.columns:
                    index_name = df.index.name or "index"
                    df = df.reset_index()
                    if "period" not in df.columns:
                        if index_name in df.columns:
                            df = df.rename(columns={index_name: "period"})
                        elif "index" in df.columns:
                            df = df.rename(columns={"index": "period"})

                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock ratios fetch error: {e}")
                raise ProviderError(
                    message=str(e), provider="vnstock", details={"symbol": query["symbol"]}
                )

        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(provider="vnstock", timeout=settings.vnstock_timeout)

    @staticmethod
    def transform_data(
        params: FinancialRatiosQueryParams,
        data: List[dict[str, Any]],
    ) -> List[FinancialRatioData]:
        if not data:
            return []

        has_row_items = any("item_id" in row for row in data)
        if has_row_items:
            metric_map = {
                "p_e": "pe",
                "p_b": "pb",
                "p_s": "ps",
                "ev_ebitda": "ev_ebitda",
                "ev_sales": "ev_sales",
                "roe": "roe",
                "roa": "roa",
                "trailing_eps": "eps",
                "book_value_per_share_bvps": "bvps",
                "gross_profit_margin": "gross_margin",
                "net_profit_margin": "net_margin",
                "short_term_ratio": "current_ratio",
                "quick_ratio": "quick_ratio",
                "cash_ratio": "cash_ratio",
                "asset_turnover": "asset_turnover",
                "inventory_turnover": "inventory_turnover",
                "receivables_turnover": "receivables_turnover",
                "operating_margin": "operating_margin",
                "interest_coverage": "interest_coverage",
                "debt_service_coverage": "debt_service_coverage",
                "ocf_to_debt": "ocf_debt",
                "ocf_debt": "ocf_debt",
                "fcf_yield": "fcf_yield",
                "ocf_sales": "ocf_sales",
            }

            raw_fields = {
                key for row in data for key in row.keys() if key not in {"item", "item_id"}
            }
            year_fields = sorted(
                {
                    str(key)
                    for key in raw_fields
                    if str(key).isdigit() or ("Q" in str(key).upper() and "/" in str(key))
                },
                reverse=True,
            )

            if not year_fields:
                logger.warning("No valid ratio periods found in vnstock response")
                return []

            by_year: dict[str, dict[str, Any]] = {
                year: {"symbol": params.symbol.upper(), "period": str(year)} for year in year_fields
            }
            liabilities_by_year: dict[str, float] = {}
            equity_by_year: dict[str, float] = {}

            for row in data:
                item_id = row.get("item_id")
                if not item_id:
                    continue
                for year in year_fields:
                    if year not in row:
                        continue
                    value = row.get(year)
                    if value is None:
                        continue
                    if item_id in metric_map:
                        field = metric_map[item_id]
                        by_year[year][field] = value
                        continue
                    if item_id == "liabilities":
                        liabilities_by_year[year] = value
                        continue
                    if item_id == "owners_equity":
                        equity_by_year[year] = value

            for year in year_fields:
                if by_year[year].get("debt_equity") is None:
                    liabilities = liabilities_by_year.get(year)
                    equity = equity_by_year.get(year)
                    if liabilities is not None and equity not in (None, 0):
                        by_year[year]["debt_equity"] = liabilities / equity

            results = []
            for year in year_fields:
                try:
                    results.append(FinancialRatioData(**by_year[year]))
                except Exception as e:
                    logger.warning(f"Skipping invalid ratio row: {e}")
            return results

        results = []
        for row in data:
            try:
                results.append(
                    FinancialRatioData(
                        symbol=params.symbol.upper(),
                        period=str(
                            row.get("yearReport")
                            or row.get("period")
                            or row.get("quarter")
                            or row.get("fiscalYear")
                            or ""
                        ),
                        pe=row.get("priceToEarning") or row.get("pe"),
                        pb=row.get("priceToBook") or row.get("pb"),
                        ps=row.get("priceToSales") or row.get("ps"),
                        ev_ebitda=row.get("evToEbitda")
                        or row.get("evEbitda")
                        or row.get("ev_ebitda"),
                        ev_sales=row.get("evToSales") or row.get("evSales") or row.get("ev_sales"),
                        roe=row.get("roe"),
                        roa=row.get("roa"),
                        eps=row.get("earningPerShare") or row.get("eps"),
                        bvps=row.get("bookValuePerShare") or row.get("bvps"),
                        debt_equity=row.get("debtOnEquity") or row.get("de"),
                        debt_assets=row.get("debtOnAssets") or row.get("debtAssets"),
                        equity_multiplier=row.get("equityMultiplier"),
                        current_ratio=row.get("currentRatio"),
                        quick_ratio=row.get("quickRatio"),
                        cash_ratio=row.get("cashRatio"),
                        asset_turnover=row.get("assetTurnover"),
                        inventory_turnover=row.get("inventoryTurnover"),
                        receivables_turnover=row.get("receivablesTurnover"),
                        gross_margin=row.get("grossProfitMargin") or row.get("grossMargin"),
                        net_margin=row.get("postTaxMargin") or row.get("netMargin"),
                        operating_margin=row.get("operatingMargin") or row.get("opMargin"),
                        interest_coverage=row.get("interestCoverage"),
                        debt_service_coverage=row.get("debtServiceCoverage"),
                        ocf_debt=row.get("ocfToDebt") or row.get("ocfDebt"),
                        fcf_yield=row.get("fcfYield"),
                        ocf_sales=row.get("ocfSales"),
                    )
                )
            except Exception as e:
                logger.warning(f"Skipping invalid ratio row: {e}")
        return results
