"""
VnStock Company Events Fetcher

Fetches corporate events (dividends, stock splits, AGMs, etc.) 
for Vietnam-listed companies via vnstock library.
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


class CompanyEventsQueryParams(BaseModel):
    """Query parameters for company events."""
    
    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Stock ticker symbol (e.g., VNM)",
    )
    limit: int = Field(
        default=30,
        ge=1,
        le=100,
        description="Maximum number of events to return",
    )
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class CompanyEventData(BaseModel):
    """
    Standardized company event data.
    
    Each item represents a corporate event like dividend, AGM, stock split, etc.
    """
    
    symbol: str = Field(..., description="Stock ticker symbol")
    event_type: Optional[str] = Field(None, description="Type of event")
    event_name: Optional[str] = Field(None, description="Event name/title")
    event_date: Optional[str] = Field(None, description="Event date")
    ex_date: Optional[str] = Field(None, description="Ex-dividend/Ex-rights date")
    record_date: Optional[str] = Field(None, description="Record date")
    payment_date: Optional[str] = Field(None, description="Payment date")
    description: Optional[str] = Field(None, description="Event description")
    value: Optional[str] = Field(None, description="Event value (dividend amount, ratio, etc.)")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "event_type": "DIVIDEND",
                "event_name": "Cash Dividend Q3/2024",
                "event_date": "2024-10-15",
                "value": "1,500 VND/share",
            }
        }
    }


class VnstockCompanyEventsFetcher(BaseFetcher[CompanyEventsQueryParams, CompanyEventData]):
    """
    Fetcher for company events via vnstock library.
    
    Returns corporate events like dividends, AGMs, stock splits, etc.
    """
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: CompanyEventsQueryParams) -> dict[str, Any]:
        """Transform query params to vnstock-compatible format."""
        return {
            "symbol": params.symbol.upper(),
            "limit": params.limit,
        }
    
    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        """Fetch company events from vnstock."""
        loop = asyncio.get_event_loop()
        
        def _fetch_sync() -> List[dict]:
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                
                # Get company events
                events_df = stock.company.events()
                
                if events_df is None or events_df.empty:
                    logger.info(f"No events data for {query['symbol']}")
                    return []
                
                # Limit results
                events_df = events_df.head(query.get("limit", 30))
                
                return events_df.to_dict("records")
                
            except Exception as e:
                logger.error(f"vnstock events fetch error: {e}")
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
        params: CompanyEventsQueryParams,
        data: List[dict[str, Any]],
    ) -> List[CompanyEventData]:
        """Transform raw events data to standardized format."""
        results: List[CompanyEventData] = []
        
        for row in data:
            try:
                # Handle various column name variations from vnstock
                event_date = row.get("eventDate") or row.get("date") or row.get("ngayGDKHQ")
                if event_date and not isinstance(event_date, str):
                    event_date = str(event_date)
                
                ex_date = row.get("exDate") or row.get("exRightDate") or row.get("ngayDKCC")
                if ex_date and not isinstance(ex_date, str):
                    ex_date = str(ex_date)
                
                event_item = CompanyEventData(
                    symbol=params.symbol.upper(),
                    event_type=row.get("eventType") or row.get("type") or row.get("loaiSuKien"),
                    event_name=row.get("eventName") or row.get("title") or row.get("noiDung"),
                    event_date=event_date,
                    ex_date=ex_date,
                    record_date=str(row.get("recordDate") or row.get("ngayDKCC") or ""),
                    payment_date=str(row.get("paymentDate") or row.get("ngayThanhToan") or ""),
                    description=row.get("description") or row.get("content") or row.get("ghiChu"),
                    value=str(row.get("value") or row.get("ratio") or row.get("tyLe") or ""),
                )
                results.append(event_item)
                
            except Exception as e:
                logger.warning(f"Skipping invalid event row: {e}")
                continue
        
        return results
