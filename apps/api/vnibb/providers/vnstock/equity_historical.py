"""
VnStock Equity Historical Fetcher

Fetches historical OHLCV (Open, High, Low, Close, Volume) price data
for Vietnam-listed stocks using the vnstock library.
"""

import asyncio
import logging
from datetime import date
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

logger = logging.getLogger(__name__)


class EquityHistoricalQueryParams(BaseModel):
    """
    Query parameters for historical price data.
    
    Matches OpenBB's EquityHistoricalQueryParams structure.
    """
    
    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Stock ticker symbol (e.g., VNM, FPT, VIC)",
    )
    start_date: date = Field(
        ...,
        description="Start date for historical data (YYYY-MM-DD)",
    )
    end_date: date = Field(
        default_factory=date.today,
        description="End date for historical data (defaults to today)",
    )
    interval: str = Field(
        default="1D",
        pattern=r"^(1m|5m|15m|30m|1H|1D|1W|1M)$",
        description="Data interval: 1m, 5m, 15m, 30m, 1H, 1D, 1W, 1M",
    )
    source: str = Field(
        default="KBS",
        pattern=r"^(KBS|VCI|DNSE)$",
        description="Data source: KBS (default), VCI, or DNSE",
    )

    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        """Ensure symbol is uppercase."""
        return v.upper().strip()
    
    @field_validator("end_date")
    @classmethod
    def validate_date_range(cls, v: date, info) -> date:
        """Ensure end_date >= start_date."""
        start = info.data.get("start_date")
        if start and v < start:
            raise ValueError("end_date must be >= start_date")
        return v
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "start_date": "2024-01-01",
                "end_date": "2024-12-31",
                "interval": "1D",
                "source": "VCI",
            }
        }
    }


class EquityHistoricalData(BaseModel):
    """
    Standardized OHLCV data response.
    
    Follows OpenBB's EquityHistoricalData structure.
    """
    
    symbol: str = Field(..., description="Stock ticker symbol")
    time: date = Field(..., description="Trading date")
    open: float = Field(..., description="Opening price")
    high: float = Field(..., description="Highest price")
    low: float = Field(..., description="Lowest price")
    close: float = Field(..., description="Closing price")
    volume: int = Field(..., description="Trading volume")
    
    # Optional extended fields from vnstock
    value: Optional[float] = Field(None, description="Trading value in VND")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "time": "2024-06-15",
                "open": 75000.0,
                "high": 76500.0,
                "low": 74800.0,
                "close": 76200.0,
                "volume": 1234567,
                "value": 93000000000.0,
            }
        }
    }


from vnibb.core.retry import vnstock_cb, circuit_breaker

class VnstockEquityHistoricalFetcher(
    BaseFetcher[EquityHistoricalQueryParams, EquityHistoricalData]
):
    """
    Fetcher for historical equity prices via vnstock library.
    
    Primary data source for OHLCV data. Falls back to scraper
    if vnstock fails or returns empty data.
    """
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: EquityHistoricalQueryParams) -> dict[str, Any]:
        """
        Transform query params to vnstock-compatible format.
        
        vnstock.stock().quote.history() expects:
        - start: str (YYYY-MM-DD)
        - end: str (YYYY-MM-DD)
        - interval: str (1D, 1W, etc.)
        """
        return {
            "symbol": params.symbol.upper(),
            "start": params.start_date.isoformat(),
            "end": params.end_date.isoformat(),
            "interval": params.interval,
            "source": params.source,
        }
    
    @staticmethod
    @circuit_breaker(vnstock_cb)
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:

        """
        Fetch historical data from vnstock.
        
        vnstock is synchronous, so we run it in a thread pool executor
        to avoid blocking the async event loop.
        """
        loop = asyncio.get_event_loop()
        
        def _fetch_sync() -> List[dict[str, Any]]:
            """Synchronous fetch wrapped for executor."""
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(
                    symbol=query["symbol"],
                    source=query["source"],
                )
                df = stock.quote.history(
                    start=query["start"],
                    end=query["end"],
                    interval=query["interval"],
                )
                
                if df is None or df.empty:
                    logger.warning(f"No data returned for {query['symbol']}")
                    return []
                
                # Convert DataFrame to list of dicts
                return df.to_dict("records")
                
            except Exception as e:
                logger.error(f"vnstock fetch error for {query['symbol']}: {e}")
                raise ProviderError(
                    message=str(e),
                    provider="vnstock",
                    details={"symbol": query["symbol"]},
                )
        
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(
                provider="vnstock",
                timeout=settings.vnstock_timeout,
            )
    
    @staticmethod
    def transform_data(
        params: EquityHistoricalQueryParams,
        data: List[dict[str, Any]],
    ) -> List[EquityHistoricalData]:
        """
        Transform raw vnstock response to standardized EquityHistoricalData.
        
        vnstock returns columns: time, open, high, low, close, volume
        Some sources may also include: value, ticker
        """
        results: List[EquityHistoricalData] = []
        
        for row in data:
            try:
                # Handle different column names from different sources
                time_value = row.get("time") or row.get("date") or row.get("trading_date")
                
                # Parse date if it's a string
                if isinstance(time_value, str):
                    time_value = date.fromisoformat(time_value[:10])
                elif hasattr(time_value, "date"):
                    time_value = time_value.date()
                
                results.append(
                    EquityHistoricalData(
                        symbol=params.symbol.upper(),
                        time=time_value,
                        open=float(row.get("open") or row.get("price") or 0),
                        high=float(row.get("high") or 0),
                        low=float(row.get("low") or 0),
                        close=float(row.get("close") or row.get("price") or 0),
                        volume=int(row.get("volume") or 0),

                        value=float(row["value"]) if row.get("value") else None,
                    )
                )
            except (KeyError, ValueError, TypeError) as e:
                logger.warning(f"Skipping invalid row: {row}, error: {e}")
                continue
        
        return results
