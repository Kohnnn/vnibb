"""
VnStock Balance Sheet Fetcher

Fetches balance sheet data for Vietnam-listed companies.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class BalanceSheetQueryParams(BaseModel):
    """Query parameters for balance sheet data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    period: str = Field(default="year", pattern=r"^(year|quarter)$")
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class BalanceSheetData(BaseModel):
    """Standardized balance sheet data."""
    
    symbol: str
    period: Optional[str] = None
    total_assets: Optional[float] = None
    current_assets: Optional[float] = None
    fixed_assets: Optional[float] = None
    total_liabilities: Optional[float] = None
    current_liabilities: Optional[float] = None
    long_term_liabilities: Optional[float] = None
    equity: Optional[float] = None
    cash: Optional[float] = None
    inventory: Optional[float] = None
    receivables: Optional[float] = None
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "period": "2024",
                "total_assets": 50000000000000,
                "equity": 30000000000000,
            }
        }
    }


class VnstockBalanceSheetFetcher(BaseFetcher[BalanceSheetQueryParams, BalanceSheetData]):
    """Fetcher for balance sheet via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: BalanceSheetQueryParams) -> dict[str, Any]:
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
                df = stock.finance.balance_sheet(period=query.get("period", "year"), lang="en")
                
                if df is None or df.empty:
                    return []
                
                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock balance sheet fetch error: {e}")
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
        params: BalanceSheetQueryParams,
        data: List[dict[str, Any]],
    ) -> List[BalanceSheetData]:
        results = []
        for row in data:
            try:
                results.append(BalanceSheetData(
                    symbol=params.symbol.upper(),
                    period=str(row.get("yearReport") or row.get("period") or ""),
                    total_assets=row.get("asset") or row.get("totalAssets"),
                    current_assets=row.get("shortAsset") or row.get("currentAssets"),
                    fixed_assets=row.get("fixedAsset") or row.get("longAsset"),
                    total_liabilities=row.get("debt") or row.get("totalLiabilities"),
                    current_liabilities=row.get("shortDebt") or row.get("currentLiabilities"),
                    long_term_liabilities=row.get("longDebt") or row.get("longTermDebt"),
                    equity=row.get("equity") or row.get("stockholderEquity"),
                    cash=row.get("cash") or row.get("cashAndEquivalents"),
                    inventory=row.get("inventory"),
                    receivables=row.get("shortReceivable"),
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid balance sheet row: {e}")
        return results
