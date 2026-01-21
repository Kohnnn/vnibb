"""
VnStock Subsidiaries Fetcher

Fetches company subsidiaries and affiliates data.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class SubsidiariesQueryParams(BaseModel):
    """Query parameters for subsidiaries data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class SubsidiaryData(BaseModel):
    """Standardized subsidiary data."""
    
    symbol: str
    company_name: Optional[str] = None
    ownership_pct: Optional[float] = None
    charter_capital: Optional[float] = None
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "company_name": "Vinamilk Da Nang",
                "ownership_pct": 100,
            }
        }
    }


class VnstockSubsidiariesFetcher(BaseFetcher[SubsidiariesQueryParams, SubsidiaryData]):
    """Fetcher for subsidiaries via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: SubsidiariesQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper()}
    
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
                df = stock.company.subsidiaries()
                
                if df is None or df.empty:
                    return []
                
                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock subsidiaries fetch error: {e}")
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
        params: SubsidiariesQueryParams,
        data: List[dict[str, Any]],
    ) -> List[SubsidiaryData]:
        results = []
        for row in data:
            try:
                results.append(SubsidiaryData(
                    symbol=params.symbol.upper(),
                    company_name=row.get("companyName") or row.get("name") or row.get("tenCongTy"),
                    ownership_pct=row.get("ownership") or row.get("ratio") or row.get("tyLe"),
                    charter_capital=row.get("charterCapital") or row.get("vonDieuLe"),
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid subsidiary row: {e}")
        return results
