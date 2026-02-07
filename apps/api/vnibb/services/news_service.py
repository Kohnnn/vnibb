from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel
from enum import Enum
from vnibb.services.news_crawler import news_crawler
from vnibb.providers.vnstock.company_news import VnstockCompanyNewsFetcher, CompanyNewsQueryParams


class NewsSentiment(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    BULLISH = "bullish"
    BEARISH = "bearish"


class NewsItem(BaseModel):
    id: str
    title: str
    summary: Optional[str] = None
    source: str
    published_at: datetime
    url: str
    symbols: List[str] = []
    sector: Optional[str] = None
    sentiment: str = "neutral"
    sentiment_score: Optional[float] = None
    ai_summary: Optional[str] = None


class NewsResponse(BaseModel):
    items: List[NewsItem]
    total: int
    has_more: bool


async def get_news_flow(
    symbols: Optional[List[str]] = None,
    sector: Optional[str] = None,
    sentiment: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> NewsResponse:
    """
    Fetch aggregated news from database via news_crawler.
    """
    # Use existing news_crawler to get data from database
    symbol = symbols[0] if symbols else None

    # Map sentiment BULLISH -> bullish, etc if needed, but news_crawler uses lowercase
    results = await news_crawler.get_latest_news(
        symbol=symbol, sentiment=sentiment, limit=limit, offset=offset
    )

    if not results:
        fallback_symbols = [symbol.upper()] if symbol else ["VNM", "FPT", "VCB", "HPG", "VIC"]
        hydrated: List[Dict[str, Any]] = []
        used_urls: set[str] = set()

        for fallback_symbol in fallback_symbols:
            if len(hydrated) >= limit:
                break
            try:
                per_symbol_limit = limit if symbol else max(2, limit // len(fallback_symbols))
                company_news = await VnstockCompanyNewsFetcher.fetch(
                    CompanyNewsQueryParams(symbol=fallback_symbol, limit=per_symbol_limit)
                )
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
            except Exception:
                continue

        results = hydrated

    items = []
    for r in results:
        # related_symbols is stored as string in DB, crawler.to_dict() might have parsed it
        syms = r.get("related_symbols", [])
        if isinstance(syms, str):
            syms = [s.strip() for s in syms.split(",") if s.strip()]

        items.append(
            NewsItem(
                id=str(r.get("id", "")),
                title=r.get("title", ""),
                summary=r.get("summary", ""),
                source=r.get("source", "unknown"),
                published_at=r.get("published_date") or datetime.now(),
                url=r.get("url", ""),
                symbols=syms,
                sentiment=r.get("sentiment", "neutral"),
                sentiment_score=r.get("sentiment_score"),
                ai_summary=r.get("ai_summary"),
            )
        )

    return NewsResponse(
        items=items,
        total=len(items),  # This is not accurate for pagination but fine for now
        has_more=len(items) >= limit,
    )
