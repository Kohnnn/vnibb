"""
VnStock Company Officers Fetcher

Fetches officers/management data for Vietnam-listed companies.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class OfficersQueryParams(BaseModel):
    """Query parameters for officers data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class OfficerData(BaseModel):
    """Standardized officer/management data."""
    
    symbol: str
    name: Optional[str] = None
    position: Optional[str] = None
    shares_owned: Optional[float] = None
    ownership_pct: Optional[float] = None
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "name": "Mai Kiều Liên",
                "position": "Tổng Giám đốc",
                "shares_owned": 1500000,
                "ownership_pct": 0.075,
            }
        }
    }


class VnstockOfficersFetcher(BaseFetcher[OfficersQueryParams, OfficerData]):
    """Fetcher for company officers via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: OfficersQueryParams) -> dict[str, Any]:
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
                df = stock.company.officers()
                
                if df is None or df.empty:
                    return []
                
                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock officers fetch error: {e}")
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
        params: OfficersQueryParams,
        data: List[dict[str, Any]],
    ) -> List[OfficerData]:
        results = []
        for row in data:
            try:
                results.append(OfficerData(
                    symbol=params.symbol.upper(),
                    name=row.get("name") or row.get("officerName") or row.get("hoTen"),
                    position=row.get("position") or row.get("chucVu"),
                    shares_owned=row.get("shares") or row.get("quantity"),
                    ownership_pct=row.get("ratio") or row.get("ownership"),
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid officer row: {e}")
        return results
