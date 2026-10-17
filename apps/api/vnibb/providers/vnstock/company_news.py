"""
VnStock Company News Fetcher

Fetches company news/announcements for Vietnam-listed companies via vnstock library.
"""

import asyncio
import logging
from datetime import datetime, timedelta, UTC
from numbers import Integral
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.providers.vnstock.reference_fields import identity, parse_datetime, supplied

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
    news_id: Optional[int] = None

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
    propagate_provider_errors = True

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
                from vnibb.providers.vnstock.runtime import create_reference_company

                company = create_reference_company(query["symbol"], settings.vnstock_source)

                # Get company news
                news_df = company.news()

                if news_df is None or news_df.empty:
                    logger.info(f"No news data for {query['symbol']}")
                    return []

                # Limit results
                news_df = news_df.head(query.get("limit", 20))

                return news_df.to_dict("records")

            except Exception as e:
                logger.debug("vnstock news fetch error for %s: %s", query["symbol"], e)
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
            raise ProviderTimeoutError(provider="vnstock", timeout_seconds=settings.vnstock_timeout)

    @staticmethod
    def transform_data(
        params: CompanyNewsQueryParams,
        data: List[dict[str, Any]],
    ) -> List[CompanyNewsData]:
        """Transform raw news data to standardized format."""
        results: List[CompanyNewsData] = []

        for row in data:
            try:
                # Preserve timestamp aliases from retained provider payloads.
                published = supplied(
                    row, "public_date", "publishDate", "publish_date", "publishedDate",
                    "published_date", "publishedAt", "published_at", "publish_time",
                    "publicDate", "date", "time", "createdAt", "created_at",
                    "dateModified", "releaseDate",
                )
                if isinstance(published, Integral) and not isinstance(published, bool) and supplied(row, "public_date") is not None:
                    # VCI news public_date is epoch milliseconds (SDK reference notebook).
                    parsed = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=int(published))
                    published = parsed.replace(tzinfo=None).isoformat()
                else:
                    parsed = parse_datetime(published)
                    if parsed is None or isinstance(published, (int, float, bool)):
                        raise ProviderError("Invalid news source publication date", provider="vnstock")
                    published = str(published)

                news_item = CompanyNewsData(
                    symbol=params.symbol.upper(),
                    title=identity(supplied(row, "news_title", "title", "Title"), "news"),
                    source=supplied(row, "news_source", "source", "Source"),
                    published_at=published,
                    url=supplied(row, "news_source_link", "url", "link", "URL"),
                    summary=supplied(row, "news_short_content", "news_full_content", "summary", "content", "description"),
                    category=supplied(row, "news_category_code", "category", "type"),
                    news_id=supplied(row, "news_id"),
                )
                results.append(news_item)

            except Exception as e:
                raise ProviderError("Invalid news row", provider="vnstock", cause=e) from e

        return results
