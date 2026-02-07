"""
Market News API Endpoints

Provides access to market news from multiple Vietnamese sources.
Uses vnstock_news premium package.
"""

import logging
from typing import Optional, List, Dict, Any
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.services.news_crawler import news_crawler
from vnibb.providers.vnstock.company_news import (
    VnstockCompanyNewsFetcher,
    CompanyNewsQueryParams,
)
from vnibb.providers.vnstock.equity_screener import (
    VnstockScreenerFetcher,
    StockScreenerParams,
    ScreenerData,
)
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.services.cache_manager import CacheManager
from vnibb.core.cache import cached

router = APIRouter()
logger = logging.getLogger(__name__)


class NewsArticle(BaseModel):
    """News article with AI sentiment."""

    id: Optional[int] = None
    title: str
    summary: Optional[str] = None
    content: Optional[str] = None
    source: str
    url: Optional[str] = None
    author: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    published_date: Optional[str] = None
    related_symbols: List[str] = []
    sectors: List[str] = []
    sentiment: Optional[str] = None
    sentiment_score: Optional[float] = None
    ai_summary: Optional[str] = None
    read_count: int = 0
    bookmarked: bool = False


class NewsFeed(BaseModel):
    """News feed response."""

    articles: List[NewsArticle]
    total: int
    source: Optional[str] = None


async def get_news_feed(
    source: Optional[str] = None,
    sentiment: Optional[str] = None,
    symbol: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> NewsFeed:
    """Fetch latest news and normalize into NewsFeed."""
    articles = await news_crawler.get_latest_news(
        source=source,
        sentiment=sentiment,
        symbol=symbol,
        limit=limit,
        offset=offset,
    )

    normalized: List[NewsArticle] = []
    for item in articles:
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
                published_date=item.get("published_date"),
                related_symbols=related_symbols,
                sectors=sectors,
                sentiment=item.get("sentiment"),
                sentiment_score=item.get("sentiment_score"),
                ai_summary=item.get("ai_summary"),
                read_count=item.get("read_count", 0),
                bookmarked=item.get("bookmarked", False),
            )
        )

    if not normalized and symbol:
        try:
            company_news = await VnstockCompanyNewsFetcher.fetch(
                CompanyNewsQueryParams(symbol=symbol.upper(), limit=limit)
            )
            for idx, item in enumerate(company_news):
                normalized.append(
                    NewsArticle(
                        id=idx,
                        title=item.title,
                        summary=item.summary,
                        source=item.source or "vnstock",
                        url=item.url,
                        category=item.category,
                        published_date=item.published_at,
                        related_symbols=[symbol.upper()],
                    )
                )
        except Exception as fallback_error:
            logger.debug(f"Company news fallback failed for {symbol}: {fallback_error}")

    if not normalized and not symbol:
        fallback_symbols = ["VNM", "FPT", "VCB", "HPG", "VIC"]
        for fallback_symbol in fallback_symbols:
            if len(normalized) >= limit:
                break
            try:
                company_news = await VnstockCompanyNewsFetcher.fetch(
                    CompanyNewsQueryParams(symbol=fallback_symbol, limit=max(1, limit // 2))
                )
                for item in company_news:
                    normalized.append(
                        NewsArticle(
                            id=None,
                            title=item.title,
                            summary=item.summary,
                            source=item.source or "vnstock",
                            url=item.url,
                            category=item.category,
                            published_date=item.published_at,
                            related_symbols=[fallback_symbol],
                        )
                    )
                    if len(normalized) >= limit:
                        break
            except Exception:
                continue

    return NewsFeed(articles=normalized, total=len(normalized), source=source)


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

    topics: List[str] = []
    stocks_mentioned: List[str] = []
    sentiment: str = "neutral"


class CrawlStatus(BaseModel):
    """News crawl status."""

    status: str
    message: str
    count: Optional[int] = None


# ============================================================================
# HEATMAP MODELS
# ============================================================================


class HeatmapStock(BaseModel):
    """Individual stock data for heatmap visualization."""

    symbol: str
    name: str
    sector: str
    industry: Optional[str] = None
    market_cap: float
    price: float
    change: float  # Absolute price change
    change_pct: float  # Percentage change
    volume: Optional[float] = None


class SectorGroup(BaseModel):
    """Aggregated sector data for heatmap."""

    sector: str
    stocks: List[HeatmapStock]
    total_market_cap: float
    avg_change_pct: float
    stock_count: int


class HeatmapResponse(BaseModel):
    """API response for heatmap data."""

    count: int
    group_by: str
    color_metric: str
    size_metric: str
    sectors: List[SectorGroup]
    cached: bool = False


# ============================================================================
# NEWS ENDPOINTS
# ============================================================================

from vnibb.services.news_service import get_news_flow, NewsResponse, NewsSentiment


@router.get(
    "/feed",
    response_model=NewsFeed,
    summary="Get News Feed",
    description="Get latest market news with optional filters.",
)
async def get_news_feed_api(
    background_tasks: BackgroundTasks,
    source: Optional[str] = Query(default=None, description="Filter by source"),
    sentiment: Optional[str] = Query(default=None, description="Filter by sentiment"),
    symbol: Optional[str] = Query(default=None, description="Filter by symbol"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> NewsFeed:
    feed = await get_news_feed(
        source=source,
        sentiment=sentiment,
        symbol=symbol,
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
    symbols: Optional[str] = Query(None, description="Comma-separated symbols"),
    sector: Optional[str] = Query(None),
    sentiment: Optional[str] = Query(
        None, pattern=r"^(bullish|neutral|bearish|positive|negative)$"
    ),
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
    source: Optional[str] = Query(default=None, description="Filter by source"),
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
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/news/sources",
    summary="Get Available Sources",
    description="Get list of supported news sources.",
)
async def get_sources() -> Dict[str, Any]:
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
    sources: Optional[List[str]] = Query(default=None, description="Sources to crawl"),
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
        raise HTTPException(status_code=500, detail=str(e))


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
    if async_mode:
        background_tasks.add_task(
            news_crawler.analyze_unprocessed_articles,
            batch_size=batch_size,
            max_articles=max_articles,
        )
        return CrawlStatus(
            status="started",
            message="Sentiment analysis started in background",
        )

    try:
        count = await news_crawler.analyze_unprocessed_articles(
            batch_size=batch_size,
            max_articles=max_articles,
        )
        return CrawlStatus(
            status="success",
            message=f"Analyzed {count} articles",
            count=count,
        )
    except Exception as e:
        logger.error(f"Sentiment analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
        screener_data: List[ScreenerData] = []
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
        groups: Dict[str, List[HeatmapStock]] = defaultdict(list)

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
        sectors: List[SectorGroup] = []
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
            raise HTTPException(status_code=504, detail=f"Timeout: {e.message}")
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
