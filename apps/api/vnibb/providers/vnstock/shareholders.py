"""
VnStock Major Shareholders Fetcher

Fetches major shareholders/ownership data for Vietnam-listed companies.
"""

import asyncio
import logging
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class ShareholdersQueryParams(BaseModel):
    """Query parameters for shareholders data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class ShareholderData(BaseModel):
    """Standardized shareholder data."""
    
    symbol: str
    shareholder_name: Optional[str] = None
    shares_owned: Optional[float] = None
    ownership_pct: Optional[float] = None
    shareholder_type: Optional[str] = None  # Major, Insider, Foreign, etc.
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "shareholder_name": "SCIC",
                "shares_owned": 725000000,
                "ownership_pct": 36.0,
                "shareholder_type": "State",
            }
        }
    }


class VnstockShareholdersFetcher(BaseFetcher[ShareholdersQueryParams, ShareholderData]):
    """Fetcher for major shareholders via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: ShareholdersQueryParams) -> dict[str, Any]:
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
                df = stock.company.shareholders()
                
                if df is None or df.empty:
                    return []
                
                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock shareholders fetch error: {e}")
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
        params: ShareholdersQueryParams,
        data: List[dict[str, Any]],
    ) -> List[ShareholderData]:
        results = []
        for row in data:
            try:
                results.append(ShareholderData(
                    symbol=params.symbol.upper(),
                    shareholder_name=row.get("name") or row.get("shareholderName") or row.get("tenCoDonh"),
                    shares_owned=row.get("shares") or row.get("quantity") or row.get("soLuong"),
                    ownership_pct=row.get("ratio") or row.get("ownership") or row.get("tyLe"),
                    shareholder_type=row.get("type") or row.get("shareholderType"),
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid shareholder row: {e}")
        return results
