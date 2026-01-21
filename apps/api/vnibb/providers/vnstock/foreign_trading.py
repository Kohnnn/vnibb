"""
VnStock Foreign Trading Fetcher

Fetches foreign investor buying/selling data for Vietnam-listed stocks.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class ForeignTradingQueryParams(BaseModel):
    """Query parameters for foreign trading data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    limit: int = Field(default=30, ge=1, le=100)
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class ForeignTradingData(BaseModel):
    """Standardized foreign trading data."""
    
    symbol: str
    date: Optional[str] = None
    buy_volume: Optional[float] = None
    sell_volume: Optional[float] = None
    buy_value: Optional[float] = None
    sell_value: Optional[float] = None
    net_volume: Optional[float] = None
    net_value: Optional[float] = None
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "date": "2024-01-15",
                "buy_volume": 500000,
                "sell_volume": 300000,
                "net_volume": 200000,
            }
        }
    }


class VnstockForeignTradingFetcher(BaseFetcher[ForeignTradingQueryParams, ForeignTradingData]):
    """Fetcher for foreign trading data via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: ForeignTradingQueryParams) -> dict[str, Any]:
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
                # Try foreign trading data from quote or trading board
                df = stock.quote.history(
                    start="2024-01-01",
                    end="2025-12-31",
                    type="stock",
                    show_log=False
                )
                
                if df is None or df.empty:
                    return []
                
                # Return limited rows
                return df.tail(query.get("limit", 30)).to_dict("records")
            except Exception as e:
                logger.error(f"vnstock foreign trading fetch error: {e}")
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
        params: ForeignTradingQueryParams,
        data: List[dict[str, Any]],
    ) -> List[ForeignTradingData]:
        results = []
        for row in data:
            try:
                # Extract foreign trading columns if present
                buy_vol = row.get("foreignBuyVolume") or row.get("buyForeignQuantity") or 0
                sell_vol = row.get("foreignSellVolume") or row.get("sellForeignQuantity") or 0
                
                results.append(ForeignTradingData(
                    symbol=params.symbol.upper(),
                    date=str(row.get("time") or row.get("date") or ""),
                    buy_volume=buy_vol,
                    sell_volume=sell_vol,
                    buy_value=row.get("foreignBuyValue"),
                    sell_value=row.get("foreignSellValue"),
                    net_volume=buy_vol - sell_vol if buy_vol and sell_vol else None,
                    net_value=row.get("foreignNetValue"),
                ))
            except Exception as e:
                logger.warning(f"Skipping invalid foreign trading row: {e}")
        return results
