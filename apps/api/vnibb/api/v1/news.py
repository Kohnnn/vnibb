"""
Market News API Endpoints

Provides access to market news from multiple Vietnamese sources.
Uses vnstock_news premium package.
"""

import logging
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

from vnibb.core.cache import cached
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.providers.vnstock.equity_screener import (
    ScreenerData,
    StockScreenerParams,
    VnstockScreenerFetcher,
)
from vnibb.services.cache_manager import CacheManager
from vnibb.services.news_crawler import news_crawler
from vnibb.services.news_service import (
    NewsResponse,
    get_news_flow,
    get_ranked_news_rows,
)
from vnibb.services.sentiment_analyzer import sentiment_analyzer
from vnibb.services.world_news_service import (
    WorldNewsFeedResponse,
    WorldNewsMapResponse,
    WorldNewsSourcesResponse,
    get_world_news_feed,
    get_world_news_map,
    list_world_news_sources,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class NewsArticle(BaseModel):
    """News article with AI sentiment."""

    id: int | None = None
    title: str
    summary: str | None = None
    content: str | None = None
    source: str
    url: str | None = None
    author: str | None = None
    image_url: str | None = None
    category: str | None = None
    published_date: str | None = None
    related_symbols: list[str] = []
    sectors: list[str] = []
    sentiment: str | None = None
    sentiment_score: float | None = None
    ai_summary: str | None = None
    read_count: int = 0
    bookmarked: bool = False
    relevance_score: float | None = None
    matched_symbols: list[str] = []
    match_reason: str | None = None
    is_market_wide_fallback: bool = False


class NewsFeed(BaseModel):
    """News feed response."""

    articles: list[NewsArticle]
    total: int
    source: str | None = None
    mode: str = "all"
    fallback_used: bool = False


async def get_news_feed(
    source: str | None = None,
    sentiment: str | None = None,
    symbol: str | None = None,
    limit: int = 20,
    offset: int = 0,
    mode: str = "all",
) -> NewsFeed:
    """Fetch latest news and normalize into NewsFeed."""
    articles, fallback_used = await get_ranked_news_rows(
        source=source,
        sentiment=sentiment,
        symbol=symbol,
        limit=limit,
        offset=offset,
        mode=mode,
    )

    normalized: list[NewsArticle] = []
    for item in articles:
        published_date = item.get("published_date") or item.get("published_at")
        if hasattr(published_date, "isoformat"):
            published_date = published_date.isoformat()

        related_symbols = item.get("related_symbols", [])
        if isinstance(related_symbols, str):
            related_symbols = [s.strip() for s in related_symbols.split(",") if s.strip()]

        sectors = item.get("sectors", [])
        if isinstance(sectors, str):
            sectors = [s.strip() for s in sectors.split(",") if s.strip()]

        normalized.append(
            NewsArticle(
                id=item.get("id"),
                title=item.get("title", ""),
                summary=item.get("summary"),
                content=item.get("content"),
                source=item.get("source", ""),
                url=item.get("url"),
                author=item.get("author"),
                image_url=item.get("image_url"),
                category=item.get("category"),
                published_date=published_date,
                related_symbols=related_symbols,
                sectors=sectors,
                sentiment=item.get("sentiment"),
                sentiment_score=item.get("sentiment_score"),
                ai_summary=item.get("ai_summary"),
                read_count=item.get("read_count", 0),
                bookmarked=item.get("bookmarked", False),
                relevance_score=item.get("relevance_score"),
                matched_symbols=item.get("matched_symbols", []),
                match_reason=item.get("match_reason"),
                is_market_wide_fallback=bool(item.get("is_market_wide_fallback", False)),
            )
        )

    return NewsFeed(
        articles=normalized,
        total=len(normalized),
        source=source,
        mode=mode,
        fallback_used=fallback_used,
    )


class MarketSentiment(BaseModel):
    """Market sentiment summary."""

    overall: str = "neutral"
    bullish_count: int = 0
    neutral_count: int = 0
    bearish_count: int = 0
    total_articles: int = 0
    bullish_percentage: float = 0.0
    bearish_percentage: float = 0.0
    trend_direction: str = "stable"


class TrendingAnalysis(BaseModel):
    """Trending topics analysis."""

    topics: list[str] = []
    stocks_mentioned: list[str] = []
    sentiment: str = "neutral"


class CrawlStatus(BaseModel):
    """News crawl status."""

    status: str
    message: str
    count: int | None = None


# ============================================================================
# HEATMAP MODELS
# ============================================================================


class HeatmapStock(BaseModel):
    """Individual stock data for heatmap visualization."""

    symbol: str
    name: str
    sector: str
    industry: str | None = None
    market_cap: float
    price: float
    change: float  # Absolute price change
    change_pct: float  # Percentage change
    volume: float | None = None


class SectorGroup(BaseModel):
    """Aggregated sector data for heatmap."""

    sector: str
    stocks: list[HeatmapStock]
    total_market_cap: float
    avg_change_pct: float
    stock_count: int


class HeatmapResponse(BaseModel):
    """API response for heatmap data."""

    count: int
    group_by: str
    color_metric: str
    size_metric: str
    sectors: list[SectorGroup]
    cached: bool = False


# ============================================================================
# NEWS ENDPOINTS
# ============================================================================

@router.get(
    "/world",
    response_model=WorldNewsFeedResponse,
    summary="Get World News Monitor Feed",
    description="Get live RSS/Atom headlines from Vietnam and global business, market, and macro sources.",
)
@cached(ttl=300, key_prefix="world_news")
async def get_world_news_api(
    region: str | None = Query(
        default=None,
        pattern=r"^(vietnam|asia|us|europe|global)$",
        description="Optional source region filter",
    ),
    category: str | None = Query(
        default=None,
        pattern=r"^(markets|economy|business|geopolitics|technology)$",
        description="Optional classified category filter",
    ),
    language: str | None = Query(
        default=None,
        pattern=r"^(vi|en)$",
        description="Optional language filter",
    ),
    source: str | None = Query(
        default=None,
        description="Optional source id or domain filter, for example cafef_markets or bbc.co.uk",
    ),
    limit: int = Query(default=40, ge=1, le=100),
    freshness_hours: int = Query(default=72, ge=1, le=168),
) -> WorldNewsFeedResponse:
    return await get_world_news_feed(
        region=region,
        category=category,
        language=language,
        source=source,
        limit=limit,
        freshness_hours=freshness_hours,
    )


@router.get(
    "/world/map",
    response_model=WorldNewsMapResponse,
    summary="Get World News Map",
    description="Get live world news article counts and latest headlines grouped by source geography.",
)
@cached(ttl=300, key_prefix="world_news_map")
async def get_world_news_map_api(
    region: str | None = Query(
        default=None,
        pattern=r"^(vietnam|asia|us|europe|global)$",
        description="Optional source region filter",
    ),
    category: str | None = Query(
        default=None,
        pattern=r"^(markets|economy|business|geopolitics|technology)$",
        description="Optional classified category filter",
    ),
    language: str | None = Query(
        default=None,
        pattern=r"^(vi|en)$",
        description="Optional language filter",
    ),
    limit: int = Query(default=100, ge=1, le=200),
    freshness_hours: int = Query(default=72, ge=1, le=168),
) -> WorldNewsMapResponse:
    return await get_world_news_map(
        region=region,
        category=category,
        language=language,
        limit=limit,
        freshness_hours=freshness_hours,
    )


@router.get(
    "/world/sources",
    response_model=WorldNewsSourcesResponse,
    summary="Get World News Sources",
    description="Get the maintained live RSS/Atom source registry used by the world news monitor.",
)
@cached(ttl=1800, key_prefix="world_news_sources")
async def get_world_news_sources_api(
    region: str | None = Query(
        default=None,
        pattern=r"^(vietnam|asia|us|europe|global)$",
        description="Optional source region filter",
    ),
    category: str | None = Query(
        default=None,
        pattern=r"^(markets|economy|business|geopolitics|technology)$",
        description="Optional source category filter",
    ),
    language: str | None = Query(
        default=None,
        pattern=r"^(vi|en)$",
        description="Optional language filter",
    ),
) -> WorldNewsSourcesResponse:
    return list_world_news_sources(region=region, category=category, language=language)


@router.get(
    "/feed",
    response_model=NewsFeed,
    summary="Get News Feed",
    description="Get latest market news with optional filters.",
)
async def get_news_feed_api(
    background_tasks: BackgroundTasks,
    source: str | None = Query(default=None, description="Filter by source"),
    sentiment: str | None = Query(default=None, description="Filter by sentiment"),
    symbol: str | None = Query(default=None, description="Filter by symbol"),
    mode: str = Query(default="all", pattern=r"^(all|related)$", description="Feed mode"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> NewsFeed:
    feed = await get_news_feed(
        source=source,
        sentiment=sentiment,
        symbol=symbol,
        mode=mode if symbol else "all",
        limit=limit,
        offset=offset,
    )

    if feed.total == 0 and news_crawler._news_available:
        background_tasks.add_task(
            news_crawler.crawl_market_news,
            sources=None,
            limit=min(limit, 30),
            analyze_sentiment=True,
        )

    return feed


@router.get(
    "/flow",
    response_model=NewsResponse,
    summary="Get News Flow",
    description="Get chronological news flow with optional filters for symbols and sentiment.",
)
async def get_news_flow_api(
    symbols: str | None = Query(None, description="Comma-separated symbols"),
    sector: str | None = Query(None),
    sentiment: str | None = Query(
        None, pattern=r"^(bullish|neutral|bearish|positive|negative)$"
    ),
    mode: str = Query(default="related", pattern=r"^(all|related)$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """
    Get news flow with optional filters.
    """
    symbol_list = symbols.split(",") if symbols else None

    return await get_news_flow(
        symbols=symbol_list,
        sector=sector,
        sentiment=sentiment,
        mode=mode,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/news/latest",
    response_model=NewsFeed,
    summary="Get Latest News (Legacy)",
    description="Get latest market news from database. Use /news/feed for more filters.",
    deprecated=True,
)
async def get_latest_news(
    source: str | None = Query(default=None, description="Filter by source"),
    limit: int = Query(default=20, ge=1, le=100),
) -> NewsFeed:
    """Get latest market news (legacy endpoint)."""
    return await get_news_feed(source=source, limit=limit)


@router.get(
    "/news/search/{symbol}",
    response_model=NewsFeed,
    summary="Search News by Symbol",
    description="Search news related to a specific stock symbol.",
)
async def search_news_by_symbol(
    symbol: str,
    limit: int = Query(default=20, ge=1, le=100),
) -> NewsFeed:
    """Search news related to a stock."""
    try:
        articles = await news_crawler.search_news(symbol=symbol.upper(), limit=limit)

        return NewsFeed(
            articles=[NewsArticle(**a) for a in articles],
            total=len(articles),
        )
    except Exception as e:
        logger.error(f"Failed to search news for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/news/sources",
    summary="Get Available Sources",
    description="Get list of supported news sources.",
)
async def get_sources() -> dict[str, Any]:
    """Get available news sources."""
    return {
        "sources": news_crawler.SOURCES,
        "available": news_crawler._news_available,
    }


@router.get(
    "/sentiment",
    response_model=MarketSentiment,
    summary="Get Market Sentiment",
    description="Get aggregate market sentiment from recent news articles.",
)
async def get_market_sentiment_alias() -> MarketSentiment:
    return await get_market_sentiment()


@router.get(
    "/news/sentiment",
    response_model=MarketSentiment,
    summary="Get Market Sentiment",
    description="Get aggregate market sentiment from recent news articles.",
)
@cached(ttl=1800, key_prefix="market_sentiment")  # 30 min cache
async def get_market_sentiment() -> MarketSentiment:
    """Get market sentiment summary."""
    try:
        sentiment = await news_crawler.get_market_sentiment()
        return MarketSentiment(**sentiment)
    except Exception as e:
        logger.error(f"Failed to get market sentiment: {e}")
        return MarketSentiment()


@router.get(
    "/news/trending",
    response_model=TrendingAnalysis,
    summary="Get Trending Topics",
    description="Analyze trending topics from recent news.",
)
async def get_trending() -> TrendingAnalysis:
    """Get trending topics analysis."""
    try:
        trending = await news_crawler.analyze_trending()
        return TrendingAnalysis(**trending)
    except Exception as e:
        logger.error(f"Failed to analyze trending: {e}")
        return TrendingAnalysis()


@router.post(
    "/news/crawl",
    response_model=CrawlStatus,
    summary="Crawl News",
    description="Trigger news crawling from sources with sentiment analysis (runs in background).",
)
async def crawl_news(
    background_tasks: BackgroundTasks,
    sources: list[str] | None = Query(default=None, description="Sources to crawl"),
    limit: int = Query(default=50, ge=1, le=200),
    analyze_sentiment: bool = Query(default=True, description="Run sentiment analysis"),
    async_mode: bool = Query(default=True, description="Run in background"),
) -> CrawlStatus:
    """Trigger news crawling with sentiment analysis."""
    if async_mode:
        background_tasks.add_task(
            news_crawler.crawl_market_news,
            sources=sources,
            limit=limit,
            analyze_sentiment=analyze_sentiment,
        )
        return CrawlStatus(
            status="started",
            message="News crawling started in background",
        )

    try:
        count = await news_crawler.crawl_market_news(
            sources=sources,
            limit=limit,
            analyze_sentiment=analyze_sentiment,
        )
        return CrawlStatus(
            status="success",
            message=f"Crawled {count} articles",
            count=count,
        )
    except Exception as e:
        logger.error(f"News crawl failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/news/analyze",
    response_model=CrawlStatus,
    summary="Analyze Sentiment",
    description="Trigger sentiment analysis for unprocessed articles (runs in background).",
)
async def analyze_sentiment(
    background_tasks: BackgroundTasks,
    batch_size: int = Query(default=20, ge=1, le=50),
    max_articles: int = Query(default=100, ge=1, le=500),
    async_mode: bool = Query(default=True, description="Run in background"),
) -> CrawlStatus:
    """Trigger sentiment analysis for unprocessed articles."""
    mode_message = (
        "AI sentiment analysis is paused; articles will be marked neutral."
        if sentiment_analyzer.is_paused
        else "Sentiment analysis started in background"
    )

    if async_mode:
        background_tasks.add_task(
            news_crawler.analyze_unprocessed_articles,
            batch_size=batch_size,
            max_articles=max_articles,
        )
        return CrawlStatus(
            status="started",
            message=mode_message,
        )

    try:
        count = await news_crawler.analyze_unprocessed_articles(
            batch_size=batch_size,
            max_articles=max_articles,
        )
        return CrawlStatus(
            status="success",
            message=(
                f"Marked {count} articles neutral"
                if sentiment_analyzer.is_paused
                else f"Analyzed {count} articles"
            ),
            count=count,
        )
    except Exception as e:
        logger.error(f"Sentiment analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================================
# HEATMAP ENDPOINT
# ============================================================================


@router.get(
    "/heatmap",
    response_model=HeatmapResponse,
    summary="Get Market Heatmap Data",
    description="Get aggregated market data for treemap visualization. Supports grouping by sector/industry.",
)
async def get_heatmap_data(
    group_by: str = Query(
        default="sector",
        pattern=r"^(sector|industry|vn30|hnx30)$",
        description="Group stocks by: sector, industry, vn30, or hnx30",
    ),
    color_metric: str = Query(
        default="change_pct",
        pattern=r"^(change_pct|weekly_pct|monthly_pct|ytd_pct)$",
        description="Metric for color intensity: change_pct, weekly_pct, monthly_pct, ytd_pct",
    ),
    size_metric: str = Query(
        default="market_cap",
        pattern=r"^(market_cap|volume|value_traded)$",
        description="Metric for rectangle size: market_cap, volume, value_traded",
    ),
    exchange: str = Query(
        default="HOSE",
        pattern=r"^(HOSE|HNX|UPCOM|ALL)$",
        description="Exchange filter: HOSE, HNX, UPCOM, or ALL",
    ),
    limit: int = Query(
        default=500,
        ge=1,
        le=2000,
        description="Maximum stocks to include",
    ),
    use_cache: bool = Query(
        default=True,
        description="Use cached data if available",
    ),
) -> HeatmapResponse:
    """
    Fetch market heatmap data with sector/industry grouping.

    ## Features
    - **Treemap Visualization**: Rectangle size by market cap, color by price change
    - **Grouping**: By sector, industry, or index (VN30, HNX30)
    - **Metrics**: Customizable color and size metrics

    ## Use Cases
    - Market overview dashboard
    - Sector performance analysis
    - Visual stock screening
    """
    cache_manager = CacheManager()

    # Step 1: Fetch screener data (with cache support)
    try:
        params = StockScreenerParams(
            symbol=None,
            exchange=exchange,
            limit=limit,
            source=settings.vnstock_source,
        )

        # Try cache first
        screener_data: list[ScreenerData] = []
        cached = False

        if use_cache:
            try:
                cache_result = await cache_manager.get_screener_data(
                    symbol=None,
                    source=settings.vnstock_source,
                    allow_stale=True,
                )

                if cache_result.is_fresh and cache_result.data:
                    logger.info(
                        f"Using cached screener data for heatmap ({len(cache_result.data)} records)"
                    )
                    # Convert ORM to Pydantic
                    screener_data = [
                        ScreenerData(
                            symbol=s.symbol,
                            organ_name=s.company_name,
                            exchange=s.exchange,
                            industry_name=s.industry,
                            price=s.price,
                            volume=s.volume,
                            market_cap=s.market_cap,
                            pe=s.pe,
                            pb=s.pb,
                        )
                        for s in cache_result.data
                    ]
                    cached = True
            except Exception as e:
                logger.warning(f"Cache lookup failed for heatmap: {e}")

        # Fetch from API if no cache
        if not screener_data:
            screener_data = await VnstockScreenerFetcher.fetch(params)
            logger.info(f"Fetched {len(screener_data)} stocks from API for heatmap")

        # Step 2: Filter by exchange if needed
        if exchange != "ALL":
            screener_data = [s for s in screener_data if s.exchange == exchange]

        # Step 3: Calculate change_pct (for now, use mock data since we don't have historical prices)
        # In production, you'd fetch yesterday's close price and calculate actual change
        # For now, we'll use a simple heuristic based on volume/market_cap
        import random

        random.seed(42)  # Deterministic for demo

        # Step 4: Group stocks by sector/industry
        groups: dict[str, list[HeatmapStock]] = defaultdict(list)

        for stock in screener_data:
            # Skip stocks with missing critical data
            if not stock.market_cap or stock.market_cap <= 0:
                continue
            if not stock.price or stock.price <= 0:
                continue

            # Determine grouping key
            if group_by == "sector":
                # Extract sector from industry_name (e.g., "Ngân hàng" from "Ngân hàng - Dịch vụ tài chính")
                group_key = (
                    stock.industry_name.split("-")[0].strip() if stock.industry_name else "Other"
                )
            elif group_by == "industry":
                group_key = stock.industry_name or "Other"
            elif group_by == "vn30":
                # TODO: Filter only VN30 stocks (need VN30 list)
                group_key = "VN30"
            elif group_by == "hnx30":
                # TODO: Filter only HNX30 stocks
                group_key = "HNX30"
            else:
                group_key = "Other"

            # Mock change_pct calculation (replace with real data in production)
            # Use a normal distribution centered around 0
            change_pct = random.gauss(0, 2.5)  # Mean 0%, StdDev 2.5%
            change = stock.price * (change_pct / 100)

            heatmap_stock = HeatmapStock(
                symbol=stock.symbol,
                name=stock.organ_name or stock.symbol,
                sector=group_key,
                industry=stock.industry_name,
                market_cap=stock.market_cap,
                price=stock.price,
                change=change,
                change_pct=change_pct,
                volume=stock.volume,
            )

            groups[group_key].append(heatmap_stock)

        # Step 5: Create sector aggregations
        sectors: list[SectorGroup] = []
        for sector_name, stocks in groups.items():
            total_market_cap = sum(s.market_cap for s in stocks)
            # Weighted average change by market cap
            if total_market_cap > 0:
                avg_change_pct = sum(s.change_pct * s.market_cap for s in stocks) / total_market_cap
            else:
                avg_change_pct = 0

            sectors.append(
                SectorGroup(
                    sector=sector_name,
                    stocks=stocks,
                    total_market_cap=total_market_cap,
                    avg_change_pct=avg_change_pct,
                    stock_count=len(stocks),
                )
            )

        # Sort sectors by total market cap (largest first)
        sectors.sort(key=lambda s: s.total_market_cap, reverse=True)

        total_stocks = sum(len(s.stocks) for s in sectors)

        return HeatmapResponse(
            count=total_stocks,
            group_by=group_by,
            color_metric=color_metric,
            size_metric=size_metric,
            sectors=sectors,
            cached=cached,
        )

    except (ProviderTimeoutError, ProviderError) as e:
        if isinstance(e, ProviderTimeoutError):
            raise HTTPException(status_code=504, detail=f"Timeout: {e.message}") from e
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
