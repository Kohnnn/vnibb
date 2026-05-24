"""
News Crawler Service using vnstock_news

Aggregates news from multiple Vietnamese news sources.
Sources: CafeF, VnExpress, VietStock, Tuoi Tre, VnEconomy, etc.

Uses vnstock_news premium package when available; falls back to a free
RSS crawler when the premium package is missing so the news bucket
never sits stale just because the premium auto-bootstrap failed.
Enhanced with AI sentiment analysis.
"""

import asyncio
import importlib
import logging
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import and_, desc, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import async_session_maker
from vnibb.models.market_news import MarketNews
from vnibb.services.sentiment_analyzer import sentiment_analyzer

logger = logging.getLogger(__name__)


# Free-tier RSS feed map. Used when `vnstock_news` (premium) is unavailable
# so the news pipeline keeps producing fresh rows. Each entry is
# `(source_label, feed_url)`. Keep these to highly stable, well-maintained
# Vietnamese financial RSS endpoints.
FREE_RSS_FEEDS: dict[str, list[str]] = {
    "cafef.vn": [
        "https://cafef.vn/thi-truong-chung-khoan.rss",
        "https://cafef.vn/doanh-nghiep.rss",
        "https://cafef.vn/tai-chinh-ngan-hang.rss",
    ],
    "vietstock.vn": [
        "https://vietstock.vn/830/chung-khoan/co-phieu.rss",
        "https://vietstock.vn/733/kinh-te/vi-mo-dau-tu.rss",
    ],
    "vneconomy.vn": [
        "https://vneconomy.vn/chung-khoan.rss",
        "https://vneconomy.vn/tai-chinh.rss",
    ],
    "baodautu.vn": [
        "https://baodautu.vn/rss/chung-khoan.rss",
    ],
}


def _coerce_published_date(value: Any) -> datetime | None:
    """Best-effort parse a publication timestamp.

    Accepts datetime, ISO 8601 strings (with or without timezone), epoch
    seconds/milliseconds, RFC 822 strings (RSS pubDate), and a few common
    Vietnamese date layouts. Returns ``None`` only if the value is empty or
    cannot be parsed at all so the caller can record the row without a
    timestamp rather than silently dropping the article.
    """

    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        try:
            # Heuristic: > 10^12 is milliseconds, otherwise seconds.
            seconds = float(value)
            if seconds > 1_000_000_000_000:
                seconds = seconds / 1000.0
            return datetime.fromtimestamp(seconds, tz=UTC)
        except (OverflowError, OSError, ValueError):
            return None

    text = str(value).strip()
    if not text:
        return None

    # QA-v4 D.5: Some VnExpress feeds emit `pubDate` with a non-RFC-822
    # timezone (e.g. "Sat, 23 May 2026 14:30:00 GMT+7") and a localized
    # weekday prefix. Pre-process both before falling through to the
    # standard parsers.
    import re as _re

    # Convert "GMT+7" / "GMT-3" to "+0700" / "-0300".
    text = _re.sub(
        r"GMT\s*([+-])(\d{1,2})(?::?(\d{2}))?",
        lambda m: f"{m.group(1)}{int(m.group(2)):02d}{m.group(3) or '00'}",
        text,
    )
    # Strip a leading Vietnamese / abbreviated weekday like "Chủ nhật,"
    # or "T2," that confuses parsedate_to_datetime.
    text = _re.sub(r"^(?:Chủ nhật|Chu nhat|Th[ứu] [2-7]|T[2-7]),\s*", "", text, flags=_re.IGNORECASE)

    # Try ISO 8601 first (handles "Z" suffix and offsets).
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        pass

    # RFC 822 (e.g. "Wed, 19 May 2026 03:14:00 +0000") commonly emitted by RSS.
    from email.utils import parsedate_to_datetime

    try:
        return parsedate_to_datetime(text)
    except (TypeError, ValueError):
        pass

    # Common Vietnamese / numeric layouts.
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y",
    ):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue

    return None


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
            importlib.import_module("vnstock_news")
            self._news_available = True
            logger.info("vnstock_news premium package detected")
        except ImportError:
            logger.info("News crawler disabled - vnstock_news not configured")

    async def crawl_market_news(
        self,
        sources: list[str] | None = None,
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
            # Free-tier RSS fallback. We don't want stale news just
            # because the premium package didn't auto-install. The free
            # path covers cafef.vn, vietstock.vn, vneconomy.vn, and
            # baodautu.vn — enough to keep the freshness banner green.
            logger.info("News crawler: vnstock_news unavailable, falling back to RSS")
            count = await self._crawl_with_rss(sources, limit)
            if analyze_sentiment and count > 0:
                await self.analyze_unprocessed_articles(batch_size=20)
            return count

    async def _crawl_with_rss(
        self,
        sources: list[str] | None,
        limit: int,
    ) -> int:
        """Free-tier RSS fallback when vnstock_news is unavailable.

        Walks the curated FREE_RSS_FEEDS map, fetches each feed with a
        short timeout, parses ``item`` elements (RSS 2.0) into article
        dicts, and dispatches to ``_store_article`` so the upsert path
        is identical to the premium flow.
        """
        per_source_limit = max(1, limit // max(len(FREE_RSS_FEEDS), 1))
        target_sources = sources or list(FREE_RSS_FEEDS.keys())

        total = 0
        async with async_session_maker() as session:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(10.0),
                headers={"User-Agent": "Mozilla/5.0 VNIBB/1.0 (RSS aggregator)"},
                follow_redirects=True,
            ) as client:
                for source in target_sources:
                    feeds = FREE_RSS_FEEDS.get(source) or []
                    if not feeds:
                        continue
                    for feed_url in feeds:
                        articles = await self._fetch_rss_feed(client, source, feed_url, per_source_limit)
                        for article in articles:
                            try:
                                await self._store_article(session, article)
                                total += 1
                            except Exception as exc:  # noqa: BLE001
                                logger.debug(f"RSS store failed: {exc}")

            await session.commit()

        logger.info(f"RSS fallback crawled {total} articles across {len(target_sources)} sources")
        return total

    async def _fetch_rss_feed(
        self,
        client: httpx.AsyncClient,
        source: str,
        feed_url: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        try:
            response = await client.get(feed_url)
            response.raise_for_status()
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            logger.debug(f"RSS fetch failed for {feed_url}: {exc}")
            return []

        try:
            root = ET.fromstring(response.content)
        except ET.ParseError as exc:
            logger.debug(f"RSS parse failed for {feed_url}: {exc}")
            return []

        # RSS 2.0: items live under ``channel/item``; Atom uses ``entry``.
        # We accept both.
        items = root.findall(".//item") or root.findall(
            ".//{http://www.w3.org/2005/Atom}entry"
        )
        articles: list[dict[str, Any]] = []
        for item in items[:limit]:
            article = self._parse_rss_item(item, source)
            if article is not None:
                articles.append(article)
        return articles

    @staticmethod
    def _parse_rss_item(item: ET.Element, source: str) -> dict[str, Any] | None:
        def _text(tag: str) -> str | None:
            child = item.find(tag) or item.find(
                f"{{http://www.w3.org/2005/Atom}}{tag}"
            )
            if child is not None and child.text:
                return child.text.strip()
            return None

        title = _text("title")
        if not title:
            return None
        link = _text("link")
        if not link:
            atom_link = item.find("{http://www.w3.org/2005/Atom}link")
            if atom_link is not None:
                link = atom_link.attrib.get("href")
        if not link:
            return None
        return {
            "title": title,
            "summary": _text("description") or _text("summary"),
            "content": _text("content:encoded") or _text("content"),
            "source": source,
            "url": link,
            "category": _text("category"),
            "pub_date": (
                _text("pubDate")
                or _text("published")
                or _text("updated")
                or _text("dc:date")
                or _text("dc:Date")
                or _text("pubdate")
                or _text("date")
                or _text("lastBuildDate")
                or _text("publishedTime")
                or _text("publishedAt")
            ),
        }

    async def _crawl_with_vnstock_news(
        self,
        sources: list[str],
        limit: int,
    ) -> int:
        """Crawl using vnstock_news premium package."""

        def _sync_crawl():
            from vnstock_news import SITES_CONFIG, EnhancedNewsCrawler

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

                    # Log column layout once per crawl so future provider
                    # schema drift (date field renamed) is visible without a
                    # silent regression of "Unknown time" everywhere again.
                    try:
                        logger.debug(
                            "vnstock_news columns for %s: %s",
                            source,
                            list(df.columns),
                        )
                    except Exception:  # noqa: BLE001
                        pass

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

        # Store articles. We open a SAVEPOINT per article so a single bad
        # row (constraint violation, oversized text, encoding issue) does
        # not poison the whole transaction. Without nested savepoints,
        # the asyncpg driver returns
        # "InFailedSQLTransactionError: current transaction is aborted"
        # for every subsequent INSERT after the first failure, dropping
        # the storage rate to 0/N (QA-v2: market_news kept showing
        # "Crawled 62 articles · 0 stored" because of this).
        async with async_session_maker() as session:
            count = 0
            for article in articles:
                try:
                    async with session.begin_nested():
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
        article: dict[str, Any],
    ):
        """Store a single news article."""
        # Parse published date. The upstream `vnstock_news` provider emits the
        # publication timestamp under different keys depending on the source
        # (RSS, sitemap, scraper). Fall back across the full known set so we
        # never silently write `published_date=NULL` (root cause for the
        # "Unknown time" bug — every Market News article showed it because
        # only `pub_date` and `published_date` were tried previously).
        pub_date_raw = (
            article.get("pub_date")
            or article.get("published_date")
            or article.get("published_at")
            or article.get("publishedAt")
            or article.get("publishDate")
            or article.get("publishedDate")
            or article.get("pubDate")
            or article.get("publish_time")
            or article.get("time_published")
            or article.get("time")
            or article.get("date")
        )
        pub_date = _coerce_published_date(pub_date_raw)

        # Extract related symbols if mentioned
        related_symbols = article.get("symbols", [])
        if isinstance(related_symbols, list):
            related_symbols = ",".join(related_symbols[:10])  # Limit to 10 symbols

        stmt = (
            pg_insert(MarketNews)
            .values(
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
            )
            .on_conflict_do_nothing(index_elements=["url"])
        )

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
            query = (
                select(MarketNews)
                .where(MarketNews.is_processed.is_(False))
                .order_by(desc(MarketNews.published_date))
                .limit(max_articles)
            )

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
                article_data, max_concurrent=batch_size
            )

            # Update articles with sentiment data
            count = 0
            for article, sentiment in zip(articles, sentiment_results, strict=False):
                try:
                    article.sentiment = sentiment.get("sentiment")
                    article.sentiment_score = sentiment.get("confidence")
                    article.ai_summary = sentiment.get("ai_summary")

                    # Update symbols if AI found more
                    ai_symbols = sentiment.get("symbols", [])
                    if ai_symbols:
                        existing = (
                            article.related_symbols.split(",") if article.related_symbols else []
                        )
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
        symbols: list[str],
        limit_per_symbol: int = 5,
    ) -> int:
        """
        Seed market news table using company news as a fallback.
        """
        if not symbols:
            return 0

        from vnibb.providers.vnstock.company_news import (
            CompanyNewsQueryParams,
            VnstockCompanyNewsFetcher,
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
        source: str | None = None,
        sentiment: str | None = None,
        symbol: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
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
    ) -> list[dict[str, Any]]:
        """Search news related to a specific stock."""
        return await self.get_latest_news(symbol=symbol, limit=limit)

    async def get_market_sentiment(self) -> dict[str, Any]:
        """
        Get aggregate market sentiment from recent news.

        Returns sentiment analysis across all recent articles.
        """
        async with async_session_maker() as session:
            # Get last 100 processed articles
            query = (
                select(MarketNews)
                .where(MarketNews.is_processed.is_(True))
                .order_by(desc(MarketNews.published_date))
                .limit(100)
            )

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

            article_dicts = [
                {"sentiment": a.sentiment, "sentiment_score": a.sentiment_score} for a in articles
            ]

            pending_indexes: list[int] = []
            pending_articles: list[dict[str, Any]] = []
            for index, article in enumerate(articles):
                if article.sentiment in {
                    "bullish",
                    "bearish",
                    "positive",
                    "negative",
                } and article.sentiment_score not in {None, 0}:
                    continue
                if article.sentiment == "neutral" and article.sentiment_score not in {None, 0}:
                    continue

                pending_indexes.append(index)
                pending_articles.append(
                    {
                        "title": article.title,
                        "content": article.content,
                        "summary": article.summary,
                    }
                )

            if pending_articles:
                sentiments = await sentiment_analyzer.analyze_batch(
                    pending_articles, max_concurrent=6
                )
                for index, sentiment in zip(pending_indexes, sentiments, strict=False):
                    article_dicts[index]["sentiment"] = sentiment.get("sentiment", "neutral")
                    article_dicts[index]["sentiment_score"] = sentiment.get("confidence")

            return sentiment_analyzer.calculate_market_sentiment(article_dicts)

    async def analyze_trending(self) -> dict[str, Any]:
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
