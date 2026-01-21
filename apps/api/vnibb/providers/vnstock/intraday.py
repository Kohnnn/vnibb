"""
VnStock Intraday Trades Fetcher

Fetches intraday price/volume data for Vietnam-listed stocks.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class IntradayQueryParams(BaseModel):
    """Query parameters for intraday data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    limit: int = Field(default=100, ge=1, le=500)
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class IntradayTradeData(BaseModel):
    """Standardized intraday trade data."""
    
    symbol: str
    time: Optional[str] = None
    price: Optional[float] = None
    volume: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    match_type: Optional[str] = None  # Buy/Sell
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "time": "14:30:15",
                "price": 75800,
                "volume": 1000,
                "match_type": "BU",
            }
        }
    }


class VnstockIntradayFetcher(BaseFetcher[IntradayQueryParams, IntradayTradeData]):
    """Fetcher for intraday trades via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: IntradayQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper(), "limit": params.limit}
    
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
                df = stock.quote.intraday()
                
                if df is None or df.empty:
                    return []
                
                return df.tail(query.get("limit", 100)).to_dict("records")
            except Exception as e:
                logger.error(f"vnstock intraday fetch error: {e}")
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
        params: IntradayQueryParams,
        data: List[dict[str, Any]],
    ) -> List[IntradayTradeData]:
        results = []
        for row in data:
            try:
                results.append(IntradayTradeData(
                    symbol=params.symbol.upper(),
                    time=str(row.get("time") or row.get("thoiGian") or ""),
                    price=row.get("price") or row.get("close") or row.get("gia"),
                    volume=row.get("volume") or row.get("khoiLuong"),
                    change=row.get("change") or row.get("thayDoi"),
                    change_pct=row.get("pctChange") or row.get("phanTram"),
                    match_type=row.get("matchType") or row.get("action") or row.get("loaiGiaoDich"),
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid intraday row: {e}")
        return results
