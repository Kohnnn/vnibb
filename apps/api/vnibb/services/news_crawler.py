"""
News Crawler Service using vnstock_news

Aggregates news from multiple Vietnamese news sources.
Sources: CafeF, VnExpress, VietStock, Tuoi Tre, VnEconomy, etc.

Uses vnstock_news premium package when available.
Enhanced with AI sentiment analysis.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import select, desc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import async_session_maker
from vnibb.models.market_news import MarketNews
from vnibb.services.sentiment_analyzer import sentiment_analyzer

logger = logging.getLogger(__name__)


class NewsCrawlerService:
    """
    Multi-source news aggregation using vnstock_news.
    
    Crawls news from major Vietnamese financial news sources
    and stores them with AI sentiment analysis for the news feed widget.
    """
    
    # Supported news sources
    SOURCES = [
        "cafef.vn",
        "vietstock.vn",
        "vnexpress.net",
        "tuoitre.vn",
        "vneconomy.vn",
        "baodautu.vn",
        "cafebiz.vn",
        "thesaigontimes.vn",
    ]
    
    def __init__(self):
        self._news_available = False
        self._check_vnstock_news()
    
    def _check_vnstock_news(self):
        """Check if vnstock_news is available."""
        try:
            from vnstock_news import EnhancedNewsCrawler
            self._news_available = True
            logger.info("vnstock_news premium package detected")
        except ImportError:
            logger.warning(
                "vnstock_news not installed. Market news crawling disabled."
            )
    
    async def crawl_market_news(
        self,
        sources: Optional[List[str]] = None,
        limit: int = 50,
        analyze_sentiment: bool = True,
    ) -> int:
        """
        Crawl general market news from multiple sources.
        
        Args:
            sources: List of source domains to crawl (default: top 3)
            limit: Number of articles per source
            analyze_sentiment: Whether to run AI sentiment analysis
            
        Returns:
            Total number of articles crawled
        """
        if sources is None:
            sources = self.SOURCES[:3]  # Default to top 3 sources
        
        if self._news_available:
            count = await self._crawl_with_vnstock_news(sources, limit)
            
            # Run sentiment analysis on newly crawled articles
            if analyze_sentiment and count > 0:
                await self.analyze_unprocessed_articles(batch_size=20)
            
            return count
        else:
            logger.info("vnstock_news not available. Skipping market news crawl.")
            return 0
    
    async def _crawl_with_vnstock_news(
        self,
        sources: List[str],
        limit: int,
    ) -> int:
        """Crawl using vnstock_news premium package."""
        
        def _sync_crawl():
            from vnstock_news import EnhancedNewsCrawler, SITES_CONFIG

            all_articles = []
            crawler = EnhancedNewsCrawler()
            source_aliases = {
                "thesaigontimes": "ktsg",
            }

            for source in sources:
                try:
                    # Remove .vn/.net suffix for crawler
                    source_name = source.replace(".vn", "").replace(".net", "")
                    site_key = source_aliases.get(source_name, source_name)
                    config = SITES_CONFIG.get(site_key)
                    if not config:
                        logger.warning(f"No crawler config found for source: {source_name}")
                        continue

                    source_urls = []
                    sitemap_url = config.get("sitemap_url")
                    if sitemap_url:
                        source_urls.append(sitemap_url)

                    rss_urls = config.get("rss", {}).get("urls", [])
                    if rss_urls:
                        source_urls.extend(rss_urls)

                    if not source_urls:
                        logger.warning(f"No URLs found for source: {source_name}")
                        continue

                    df = crawler.fetch_articles(
                        sources=source_urls,
                        max_articles=limit,
                        time_frame="1d",
                        site_name=site_key,
                        sort_order="desc",
                        clean_content=True,
                    )

                    if df is None or df.empty:
                        logger.debug(f"No articles found for {source}")
                        continue

                    articles = df.to_dict("records")
                    for article in articles:
                        article["source"] = source
                    all_articles.extend(articles)
                    logger.debug(f"Crawled {len(articles)} articles from {source}")

                except Exception as e:
                    logger.error(f"Failed to crawl {source}: {e}")
                    continue

            return all_articles
        
        # Run crawling in thread pool
        articles = await asyncio.to_thread(_sync_crawl)
        
        if not articles:
            return 0
        
        # Store articles
        async with async_session_maker() as session:
            count = 0
            for article in articles:
                try:
                    await self._store_article(session, article)
                    count += 1
                except Exception as e:
                    logger.warning(f"Failed to store article: {e}")
                    continue
            
            await session.commit()
        
        logger.info(f"Crawled and stored {count} market news articles")
        return count
    
    async def _store_article(
        self,
        session: AsyncSession,
        article: Dict[str, Any],
    ):
        """Store a single news article."""
        # Parse published date
        pub_date = article.get("pub_date") or article.get("published_date")
        if isinstance(pub_date, str):
            try:
                pub_date = datetime.fromisoformat(pub_date.replace("Z", "+00:00"))
            except ValueError:
                pub_date = None
        
        # Extract related symbols if mentioned
        related_symbols = article.get("symbols", [])
        if isinstance(related_symbols, list):
            related_symbols = ",".join(related_symbols[:10])  # Limit to 10 symbols
        
        stmt = pg_insert(MarketNews).values(
            title=article.get("title", ""),
            summary=article.get("description") or article.get("summary", ""),
            content=article.get("content", ""),
            source=article.get("source", "unknown"),
            url=article.get("link") or article.get("url", ""),
            author=article.get("author"),
            image_url=article.get("image") or article.get("image_url"),
            category=article.get("category"),
            related_symbols=related_symbols if related_symbols else None,
            published_date=pub_date,
            is_processed=False,  # Mark for sentiment analysis
        ).on_conflict_do_nothing(index_elements=["url"])
        
        await session.execute(stmt)
    
    async def analyze_unprocessed_articles(
        self,
        batch_size: int = 20,
        max_articles: int = 100,
    ) -> int:
        """
        Analyze sentiment for unprocessed articles.
        
        Args:
            batch_size: Number of articles to analyze concurrently
            max_articles: Maximum articles to process in one run
            
        Returns:
            Number of articles analyzed
        """
        async with async_session_maker() as session:
            # Get unprocessed articles
            query = select(MarketNews).where(
                MarketNews.is_processed == False
            ).order_by(
                desc(MarketNews.published_date)
            ).limit(max_articles)
            
            result = await session.execute(query)
            articles = result.scalars().all()
            
            if not articles:
                logger.debug("No unprocessed articles found")
                return 0
            
            logger.info(f"Analyzing sentiment for {len(articles)} articles")
            
            # Prepare articles for batch analysis
            article_data = [
                {
                    "title": a.title,
                    "content": a.content,
                    "summary": a.summary,
                }
                for a in articles
            ]
            
            # Analyze in batch
            sentiment_results = await sentiment_analyzer.analyze_batch(
                article_data,
                max_concurrent=batch_size
            )
            
            # Update articles with sentiment data
            count = 0
            for article, sentiment in zip(articles, sentiment_results):
                try:
                    article.sentiment = sentiment.get("sentiment")
                    article.sentiment_score = sentiment.get("confidence")
                    article.ai_summary = sentiment.get("ai_summary")
                    
                    # Update symbols if AI found more
                    ai_symbols = sentiment.get("symbols", [])
                    if ai_symbols:
                        existing = article.related_symbols.split(",") if article.related_symbols else []
                        combined = list(set(existing + ai_symbols))[:10]
                        article.related_symbols = ",".join(combined)
                    
                    # Update sectors
                    ai_sectors = sentiment.get("sectors", [])
                    if ai_sectors:
                        article.sectors = ",".join(ai_sectors[:5])
                    
                    article.is_processed = True
                    count += 1
                    
                except Exception as e:
                    logger.error(f"Failed to update article {article.id}: {e}")
                    continue
            
            await session.commit()
            logger.info(f"Successfully analyzed {count} articles")
            return count
    
    async def seed_from_company_news(
        self,
        symbols: List[str],
        limit_per_symbol: int = 5,
    ) -> int:
        """
        Seed market news table using company news as a fallback.
        """
        if not symbols:
            return 0

        from vnibb.providers.vnstock.company_news import (
            VnstockCompanyNewsFetcher,
            CompanyNewsQueryParams,
        )

        total = 0
        async with async_session_maker() as session:
            for symbol in symbols:
                try:
                    items = await VnstockCompanyNewsFetcher.fetch(
                        CompanyNewsQueryParams(symbol=symbol, limit=limit_per_symbol)
                    )
                except Exception as exc:
                    logger.debug(f"Company news fallback failed for {symbol}: {exc}")
                    continue

                for item in items:
                    try:
                        await self._store_article(
                            session,
                            {
                                "title": item.title,
                                "summary": item.summary,
                                "content": item.summary,
                                "source": item.source or "vnstock",
                                "url": item.url,
                                "category": item.category,
                                "pub_date": item.published_at,
                                "symbols": [symbol],
                            },
                        )
                        total += 1
                    except Exception as exc:
                        logger.debug(f"Failed to store company news article: {exc}")
                        continue

            await session.commit()

        return total

    async def get_latest_news(
        self,
        source: Optional[str] = None,
        sentiment: Optional[str] = None,
        symbol: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Get latest news from database with filters.
        
        Args:
            source: Filter by source
            sentiment: Filter by sentiment (bullish/neutral/bearish)
            symbol: Filter by related symbol
            limit: Number of articles to return
            offset: Pagination offset
        """
        async with async_session_maker() as session:
            query = select(MarketNews).order_by(desc(MarketNews.published_date))
            
            # Apply filters
            filters = []
            if source:
                filters.append(MarketNews.source == source)
            if sentiment:
                filters.append(MarketNews.sentiment == sentiment)
            if symbol:
                filters.append(MarketNews.related_symbols.ilike(f"%{symbol}%"))
            
            if filters:
                query = query.where(and_(*filters))
            
            query = query.limit(limit).offset(offset)
            
            result = await session.execute(query)
            news = result.scalars().all()
            
            return [n.to_dict() for n in news]
    
    async def search_news(
        self,
        symbol: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Search news related to a specific stock."""
        return await self.get_latest_news(symbol=symbol, limit=limit)
    
    async def get_market_sentiment(self) -> Dict[str, Any]:
        """
        Get aggregate market sentiment from recent news.
        
        Returns sentiment analysis across all recent articles.
        """
        async with async_session_maker() as session:
            # Get last 100 processed articles
            query = select(MarketNews).where(
                MarketNews.is_processed == True
            ).order_by(
                desc(MarketNews.published_date)
            ).limit(100)
            
            result = await session.execute(query)
            articles = result.scalars().all()
            
            if not articles:
                return {
                    "overall": "neutral",
                    "bullish_count": 0,
                    "neutral_count": 0,
                    "bearish_count": 0,
                    "total_articles": 0,
                }
            
            # Convert to dicts for sentiment calculation
            article_dicts = [
                {"sentiment": a.sentiment, "sentiment_score": a.sentiment_score}
                for a in articles
            ]
            
            return sentiment_analyzer.calculate_market_sentiment(article_dicts)
    
    async def analyze_trending(self) -> Dict[str, Any]:
        """
        Analyze trending topics from recent news.
        
        Returns sentiment and topic analysis if vnstock_news is available.
        """
        if not self._news_available:
            return {}
        
        try:
            from vnstock_news import TrendingAnalyzer
            
            def _sync_analyze():
                analyzer = TrendingAnalyzer()
                return analyzer.get_trending_topics(days=7)
            
            trending = await asyncio.to_thread(_sync_analyze)
            
            return {
                "topics": trending.get("topics", []),
                "stocks_mentioned": trending.get("stocks", []),
                "sentiment": trending.get("sentiment", "neutral"),
            }
        except Exception as e:
            logger.error(f"Trending analysis failed: {e}")
            return {}


# Singleton instance
news_crawler = NewsCrawlerService()
