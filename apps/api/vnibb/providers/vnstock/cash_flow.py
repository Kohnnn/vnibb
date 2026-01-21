"""
VnStock Cash Flow Fetcher

Fetches cash flow statement data for Vietnam-listed companies.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class CashFlowQueryParams(BaseModel):
    """Query parameters for cash flow data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    period: str = Field(default="year", pattern=r"^(year|quarter)$")
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class CashFlowData(BaseModel):
    """Standardized cash flow data."""
    
    symbol: str
    period: Optional[str] = None
    operating_cash_flow: Optional[float] = None
    investing_cash_flow: Optional[float] = None
    financing_cash_flow: Optional[float] = None
    net_cash_flow: Optional[float] = None
    free_cash_flow: Optional[float] = None
    capital_expenditure: Optional[float] = None
    dividends_paid: Optional[float] = None
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "period": "2024",
                "operating_cash_flow": 12000000000000,
                "free_cash_flow": 8000000000000,
            }
        }
    }


class VnstockCashFlowFetcher(BaseFetcher[CashFlowQueryParams, CashFlowData]):
    """Fetcher for cash flow statement via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: CashFlowQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "period": params.period}
    
    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_event_loop()
        
        def _fetch_sync() -> List[dict]:
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                df = stock.finance.cash_flow(period=query.get("period", "year"), lang="en")
                
                if df is None or df.empty:
                    return []
                
                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock cash flow fetch error: {e}")
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
        params: CashFlowQueryParams,
        data: List[dict[str, Any]],
    ) -> List[CashFlowData]:
        results = []
        for row in data:
            try:
                op_cf = row.get("fromOperatingActivities") or row.get("operatingCashFlow")
                inv_cf = row.get("fromInvestingActivities") or row.get("investingCashFlow")
                fin_cf = row.get("fromFinancingActivities") or row.get("financingCashFlow")
                capex = row.get("purchaseOfFixedAssets") or row.get("capex")
                
                results.append(CashFlowData(
                    symbol=params.symbol.upper(),
                    period=str(row.get("yearReport") or row.get("period") or ""),
                    operating_cash_flow=op_cf,
                    investing_cash_flow=inv_cf,
                    financing_cash_flow=fin_cf,
                    net_cash_flow=(op_cf or 0) + (inv_cf or 0) + (fin_cf or 0) if op_cf else None,
                    free_cash_flow=(op_cf or 0) - abs(capex or 0) if op_cf else None,
                    capital_expenditure=capex,
                    dividends_paid=row.get("dividendsPaid"),
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid cash flow row: {e}")
        return results
