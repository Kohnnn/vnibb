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
    roe: Optional[float] = None
    roa: Optional[float] = None
    eps: Optional[float] = None
    bvps: Optional[float] = None
    debt_equity: Optional[float] = None
    current_ratio: Optional[float] = None
    gross_margin: Optional[float] = None
    net_margin: Optional[float] = None
    
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
                
                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock ratios fetch error: {e}")
                raise ProviderError(message=str(e), provider="vnstock", details={"symbol": query["symbol"]})
        
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
        results = []
        for row in data:
            try:
                results.append(FinancialRatioData(
                    symbol=params.symbol.upper(),
                    period=str(row.get("yearReport") or row.get("period") or row.get("quarter") or ""),
                    pe=row.get("priceToEarning") or row.get("pe"),
                    pb=row.get("priceToBook") or row.get("pb"),
                    ps=row.get("priceToSales") or row.get("ps"),
                    roe=row.get("roe"),
                    roa=row.get("roa"),
                    eps=row.get("earningPerShare") or row.get("eps"),
                    bvps=row.get("bookValuePerShare") or row.get("bvps"),
                    debt_equity=row.get("debtOnEquity") or row.get("de"),
                    current_ratio=row.get("currentRatio"),
                    gross_margin=row.get("grossProfitMargin") or row.get("grossMargin"),
                    net_margin=row.get("postTaxMargin") or row.get("netMargin"),
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid ratio row: {e}")
        return results
