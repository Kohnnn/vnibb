"""
VnStock Company News Fetcher

Fetches company news/announcements for Vietnam-listed companies via vnstock library.
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


class CompanyNewsQueryParams(BaseModel):
    """Query parameters for company news."""
    
    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Stock ticker symbol (e.g., VNM)",
    )
    limit: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Maximum number of news items to return",
    )
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class CompanyNewsData(BaseModel):
    """
    Standardized company news data.
    
    Each item represents a news article or company announcement.
    """
    
    symbol: str = Field(..., description="Stock ticker symbol")
    title: str = Field(..., description="News headline/title")
    source: Optional[str] = Field(None, description="News source")
    published_at: Optional[str] = Field(None, description="Publication date/time")
    url: Optional[str] = Field(None, description="Link to full article")
    summary: Optional[str] = Field(None, description="Article summary/snippet")
    category: Optional[str] = Field(None, description="News category")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "title": "Vinamilk công bố kết quả kinh doanh Q3/2024",
                "source": "VCI",
                "published_at": "2024-10-15T09:00:00",
                "url": "https://example.com/news/123",
            }
        }
    }


class VnstockCompanyNewsFetcher(BaseFetcher[CompanyNewsQueryParams, CompanyNewsData]):
    """
    Fetcher for company news via vnstock library.
    
    Returns recent news articles and announcements for a company.
    """
    
    provider_name = "vnstock"
    requires_credentials = False
    
    @staticmethod
    def transform_query(params: CompanyNewsQueryParams) -> dict[str, Any]:
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
        """Fetch company news from vnstock."""
        loop = asyncio.get_event_loop()
        
        def _fetch_sync() -> List[dict]:
            try:
                from vnstock import Vnstock
                stock = Vnstock().stock(symbol=query["symbol"], source=settings.vnstock_source)
                
                # Get company news
                news_df = stock.company.news()
                
                if news_df is None or news_df.empty:
                    logger.info(f"No news data for {query['symbol']}")
                    return []
                
                # Limit results
                news_df = news_df.head(query.get("limit", 20))
                
                return news_df.to_dict("records")
                
            except Exception as e:
                logger.error(f"vnstock news fetch error: {e}")
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
        params: CompanyNewsQueryParams,
        data: List[dict[str, Any]],
    ) -> List[CompanyNewsData]:
        """Transform raw news data to standardized format."""
        results: List[CompanyNewsData] = []
        
        for row in data:
            try:
                # Handle various column name variations from vnstock
                published = row.get("publishDate") or row.get("date") or row.get("time")
                if published and not isinstance(published, str):
                    published = str(published)
                
                news_item = CompanyNewsData(
                    symbol=params.symbol.upper(),
                    title=row.get("title") or row.get("Title") or "Untitled",
                    source=row.get("source") or row.get("Source") or "KBS",
                    published_at=published,
                    url=row.get("url") or row.get("link") or row.get("URL"),
                    summary=row.get("summary") or row.get("content") or row.get("description"),
                    category=row.get("category") or row.get("type"),
                )
                results.append(news_item)
                
            except Exception as e:
                logger.warning(f"Skipping invalid news row: {e}")
                continue
        
        return results
