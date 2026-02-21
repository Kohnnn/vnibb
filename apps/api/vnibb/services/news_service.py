import logging
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel

from vnibb.providers.vnstock.company_news import CompanyNewsQueryParams, VnstockCompanyNewsFetcher
from vnibb.services.news_crawler import news_crawler

logger = logging.getLogger(__name__)


class NewsSentiment(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    BULLISH = "bullish"
    BEARISH = "bearish"


class NewsItem(BaseModel):
    id: str
    title: str
    summary: str | None = None
    source: str
    published_at: datetime
    url: str
    symbols: list[str] = []
    sector: str | None = None
    sentiment: str = "neutral"
    sentiment_score: float | None = None
    ai_summary: str | None = None


class NewsResponse(BaseModel):
    items: list[NewsItem]
    total: int
    has_more: bool


def _parse_symbols(raw_symbols: Any) -> list[str]:
    if isinstance(raw_symbols, list):
        return [str(symbol).strip().upper() for symbol in raw_symbols if str(symbol).strip()]

    if isinstance(raw_symbols, str):
        return [symbol.strip().upper() for symbol in raw_symbols.split(",") if symbol.strip()]

    return []


def _parse_published_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value

    if isinstance(value, str) and value.strip():
        normalized = value.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            pass

    return datetime.now()


def _to_news_item(row: dict[str, Any]) -> NewsItem:
    return NewsItem(
        id=str(row.get("id", "")),
        title=row.get("title", ""),
        summary=row.get("summary", ""),
        source=row.get("source", "unknown"),
        published_at=_parse_published_at(row.get("published_date") or row.get("published_at")),
        url=row.get("url", ""),
        symbols=_parse_symbols(row.get("related_symbols")),
        sentiment=row.get("sentiment", "neutral"),
        sentiment_score=row.get("sentiment_score"),
        ai_summary=row.get("ai_summary"),
        sector=row.get("sector"),
    )


async def _hydrate_company_news_fallback(symbol: str | None, limit: int) -> list[dict[str, Any]]:
    fallback_symbols = [symbol.upper()] if symbol else ["VNM", "FPT", "VCB", "HPG", "VIC"]
    hydrated: list[dict[str, Any]] = []
    used_urls: set[str] = set()

    for fallback_symbol in fallback_symbols:
        if len(hydrated) >= limit:
            break

        try:
            per_symbol_limit = limit if symbol else max(2, limit // len(fallback_symbols))
            company_news = await VnstockCompanyNewsFetcher.fetch(
                CompanyNewsQueryParams(symbol=fallback_symbol, limit=per_symbol_limit)
            )
        except Exception as error:
            logger.warning(
                "Company news fallback failed",
                extra={"symbol": fallback_symbol, "error": str(error)},
            )
            continue

        for idx, item in enumerate(company_news):
            if item.url in used_urls:
                continue

            used_urls.add(item.url)
            hydrated.append(
                {
                    "id": f"{fallback_symbol}-{idx}",
                    "title": item.title,
                    "summary": item.summary,
                    "source": item.source or "vnstock",
                    "published_date": item.published_at,
                    "url": item.url,
                    "related_symbols": [fallback_symbol],
                    "sentiment": "neutral",
                    "sentiment_score": None,
                    "ai_summary": None,
                }
            )

            if len(hydrated) >= limit:
                break

    return hydrated


async def get_news_flow(
    symbols: list[str] | None = None,
    sector: str | None = None,
    sentiment: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> NewsResponse:
    """
    Fetch aggregated news from database via news_crawler.
    """
    symbol = symbols[0].strip().upper() if symbols and symbols[0].strip() else None

    try:
        results = await news_crawler.get_latest_news(
            symbol=symbol, sentiment=sentiment, limit=limit, offset=offset
        )
    except Exception as error:
        logger.warning(
            "Primary news flow query failed",
            extra={"symbol": symbol, "sentiment": sentiment, "error": str(error)},
        )
        results = []

    if not results:
        results = await _hydrate_company_news_fallback(symbol=symbol, limit=limit)

    items = [_to_news_item(row) for row in results]

    return NewsResponse(
        items=items,
        total=len(items),
        has_more=len(items) == limit,
    )
