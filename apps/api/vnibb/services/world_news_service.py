from __future__ import annotations

import asyncio
import hashlib
import html
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

import httpx
from pydantic import BaseModel, Field

from vnibb.core.config import settings

logger = logging.getLogger(__name__)


VALID_WORLD_NEWS_REGIONS = {"vietnam", "asia", "us", "europe", "global"}
VALID_WORLD_NEWS_CATEGORIES = {"markets", "economy", "business", "geopolitics", "technology"}
VALID_WORLD_NEWS_LANGUAGES = {"vi", "en"}


@dataclass(frozen=True)
class WorldNewsSourceConfig:
    id: str
    name: str
    domain: str
    region: str
    category: str
    language: str
    tier: int
    homepage_url: str
    feed_urls: tuple[str, ...]


class WorldNewsArticle(BaseModel):
    id: str
    title: str
    summary: str | None = None
    source_id: str
    source: str
    source_domain: str
    source_url: str
    feed_url: str
    url: str
    published_at: datetime | None = None
    region: str
    category: str
    language: str
    tags: list[str] = Field(default_factory=list)
    relevance_score: float = 0.0
    live: bool = True


class WorldNewsSourceInfo(BaseModel):
    id: str
    name: str
    domain: str
    region: str
    category: str
    language: str
    tier: int
    homepage_url: str
    feed_urls: list[str]


class WorldNewsFeedResponse(BaseModel):
    articles: list[WorldNewsArticle]
    total: int
    fetched_at: datetime
    source_count: int
    feed_count: int
    failed_feed_count: int = 0
    region: str | None = None
    category: str | None = None
    language: str | None = None
    source: str | None = None
    freshness_hours: int


class WorldNewsSourcesResponse(BaseModel):
    sources: list[WorldNewsSourceInfo]
    total: int


@dataclass(frozen=True)
class FeedFetchResult:
    articles: list[WorldNewsArticle]
    failed: bool = False


WORLD_NEWS_SOURCES: tuple[WorldNewsSourceConfig, ...] = (
    WorldNewsSourceConfig(
        id="cafef_markets",
        name="CafeF Markets",
        domain="cafef.vn",
        region="vietnam",
        category="markets",
        language="vi",
        tier=1,
        homepage_url="https://cafef.vn/thi-truong-chung-khoan.chn",
        feed_urls=("https://cafef.vn/thi-truong-chung-khoan.rss",),
    ),
    WorldNewsSourceConfig(
        id="cafef_macro",
        name="CafeF Macro",
        domain="cafef.vn",
        region="vietnam",
        category="economy",
        language="vi",
        tier=1,
        homepage_url="https://cafef.vn/kinh-te-vi-mo-dau-tu.chn",
        feed_urls=("https://cafef.vn/kinh-te-vi-mo-dau-tu.rss",),
    ),
    WorldNewsSourceConfig(
        id="vietstock_markets",
        name="Vietstock Markets",
        domain="vietstock.vn",
        region="vietnam",
        category="markets",
        language="vi",
        tier=1,
        homepage_url="https://vietstock.vn/chung-khoan.htm",
        feed_urls=("https://vietstock.vn/830/chung-khoan.rss",),
    ),
    WorldNewsSourceConfig(
        id="vietstock_economy",
        name="Vietstock Economy",
        domain="vietstock.vn",
        region="vietnam",
        category="economy",
        language="vi",
        tier=2,
        homepage_url="https://vietstock.vn/kinh-te.htm",
        feed_urls=("https://vietstock.vn/761/kinh-te.rss",),
    ),
    WorldNewsSourceConfig(
        id="vnexpress_business",
        name="VnExpress Business",
        domain="vnexpress.net",
        region="vietnam",
        category="business",
        language="vi",
        tier=1,
        homepage_url="https://vnexpress.net/kinh-doanh",
        feed_urls=("https://vnexpress.net/rss/kinh-doanh.rss",),
    ),
    WorldNewsSourceConfig(
        id="vnexpress_world",
        name="VnExpress World",
        domain="vnexpress.net",
        region="vietnam",
        category="geopolitics",
        language="vi",
        tier=2,
        homepage_url="https://vnexpress.net/the-gioi",
        feed_urls=("https://vnexpress.net/rss/the-gioi.rss",),
    ),
    WorldNewsSourceConfig(
        id="tuoitre_business",
        name="Tuoi Tre Business",
        domain="tuoitre.vn",
        region="vietnam",
        category="business",
        language="vi",
        tier=2,
        homepage_url="https://tuoitre.vn/kinh-doanh.htm",
        feed_urls=("https://tuoitre.vn/rss/kinh-doanh.rss",),
    ),
    WorldNewsSourceConfig(
        id="vneconomy_markets",
        name="VnEconomy Markets",
        domain="vneconomy.vn",
        region="vietnam",
        category="markets",
        language="vi",
        tier=2,
        homepage_url="https://vneconomy.vn/chung-khoan.htm",
        feed_urls=("https://vneconomy.vn/chung-khoan.rss",),
    ),
    WorldNewsSourceConfig(
        id="baodautu_business",
        name="Bao Dau Tu Business",
        domain="baodautu.vn",
        region="vietnam",
        category="business",
        language="vi",
        tier=3,
        homepage_url="https://baodautu.vn/kinh-te-dau-tu",
        feed_urls=("https://baodautu.vn/rss/kinh-te-dau-tu.rss",),
    ),
    WorldNewsSourceConfig(
        id="bbc_business",
        name="BBC Business",
        domain="bbc.co.uk",
        region="global",
        category="business",
        language="en",
        tier=1,
        homepage_url="https://www.bbc.com/news/business",
        feed_urls=("https://feeds.bbci.co.uk/news/business/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="bbc_world",
        name="BBC World",
        domain="bbc.co.uk",
        region="global",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.bbc.com/news/world",
        feed_urls=("https://feeds.bbci.co.uk/news/world/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="ap_business",
        name="AP Business",
        domain="apnews.com",
        region="us",
        category="business",
        language="en",
        tier=1,
        homepage_url="https://apnews.com/hub/business",
        feed_urls=("https://apnews.com/hub/business?output=rss",),
    ),
    WorldNewsSourceConfig(
        id="ap_world",
        name="AP World News",
        domain="apnews.com",
        region="global",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://apnews.com/hub/world-news",
        feed_urls=("https://apnews.com/hub/world-news?output=rss",),
    ),
    WorldNewsSourceConfig(
        id="cnbc_markets",
        name="CNBC Markets",
        domain="cnbc.com",
        region="us",
        category="markets",
        language="en",
        tier=1,
        homepage_url="https://www.cnbc.com/markets/",
        feed_urls=("https://www.cnbc.com/id/100003114/device/rss/rss.html",),
    ),
    WorldNewsSourceConfig(
        id="guardian_business",
        name="The Guardian Business",
        domain="theguardian.com",
        region="europe",
        category="business",
        language="en",
        tier=2,
        homepage_url="https://www.theguardian.com/business",
        feed_urls=("https://www.theguardian.com/business/rss",),
    ),
    WorldNewsSourceConfig(
        id="aljazeera_global",
        name="Al Jazeera Global",
        domain="aljazeera.com",
        region="global",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.aljazeera.com/news/",
        feed_urls=("https://www.aljazeera.com/xml/rss/all.xml",),
    ),
)


CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "markets": (
        "stock",
        "stocks",
        "market",
        "markets",
        "shares",
        "bond",
        "bonds",
        "yield",
        "forex",
        "currency",
        "commodities",
        "oil",
        "gold",
        "index",
        "vn-index",
        "vnindex",
        "chung khoan",
        "chứng khoán",
        "co phieu",
        "cổ phiếu",
        "thi truong",
        "thị trường",
    ),
    "economy": (
        "economy",
        "economic",
        "inflation",
        "gdp",
        "rates",
        "rate cut",
        "central bank",
        "fed",
        "ecb",
        "exports",
        "imports",
        "cpi",
        "growth",
        "kinh te",
        "kinh tế",
        "lai suat",
        "lãi suất",
        "ngan hang nha nuoc",
        "ngân hàng nhà nước",
    ),
    "business": (
        "business",
        "company",
        "companies",
        "earnings",
        "profit",
        "revenue",
        "merger",
        "acquisition",
        "startup",
        "deal",
        "doanh nghiep",
        "doanh nghiệp",
        "loi nhuan",
        "lợi nhuận",
        "mua ban",
        "mua bán",
    ),
    "geopolitics": (
        "war",
        "conflict",
        "election",
        "sanctions",
        "tariff",
        "china",
        "russia",
        "ukraine",
        "gaza",
        "israel",
        "south china sea",
        "bien dong",
        "biển đông",
        "the gioi",
        "thế giới",
        "dia chinh tri",
        "địa chính trị",
    ),
    "technology": (
        "technology",
        "tech",
        "ai",
        "artificial intelligence",
        "semiconductor",
        "chip",
        "software",
        "cloud",
        "cyber",
        "cong nghe",
        "công nghệ",
        "ban dan",
        "bán dẫn",
    ),
}

VIETNAM_KEYWORDS = (
    "vietnam",
    "viet nam",
    "việt nam",
    "vn-index",
    "vnindex",
    "hose",
    "hnx",
    "upcom",
    "dong",
    "vnd",
    "hanoi",
    "ha noi",
    "hà nội",
    "ho chi minh",
    "tp hcm",
    "tphcm",
)


def list_world_news_sources(
    *,
    region: str | None = None,
    category: str | None = None,
    language: str | None = None,
) -> WorldNewsSourcesResponse:
    sources = _select_sources(region=region, category=category, language=language, source_id=None)
    source_infos = [_to_source_info(source) for source in sources]
    return WorldNewsSourcesResponse(sources=source_infos, total=len(source_infos))


async def get_world_news_feed(
    *,
    region: str | None = None,
    category: str | None = None,
    language: str | None = None,
    source: str | None = None,
    limit: int = 40,
    freshness_hours: int = 72,
) -> WorldNewsFeedResponse:
    selected_sources = _select_sources(
        region=region,
        category=None,
        language=language,
        source_id=source,
    )
    feed_count = sum(len(item.feed_urls) for item in selected_sources)
    now = datetime.now(UTC)

    if not selected_sources:
        return WorldNewsFeedResponse(
            articles=[],
            total=0,
            fetched_at=now,
            source_count=0,
            feed_count=0,
            failed_feed_count=0,
            region=region,
            category=category,
            language=language,
            source=source,
            freshness_hours=freshness_hours,
        )

    timeout = min(max(settings.scraper_timeout, 5), 12)
    headers = {"User-Agent": settings.scraper_user_agent}
    async with httpx.AsyncClient(
        headers=headers,
        follow_redirects=True,
        timeout=httpx.Timeout(timeout),
    ) as client:
        results = await asyncio.gather(
            *(
                _fetch_feed(client, source_config, feed_url)
                for source_config in selected_sources
                for feed_url in source_config.feed_urls
            )
        )

    failed_feed_count = sum(1 for result in results if result.failed)
    cutoff = now - timedelta(hours=freshness_hours)
    articles: list[WorldNewsArticle] = []
    for result in results:
        for article in result.articles:
            if article.published_at and _coerce_utc(article.published_at) < cutoff:
                continue
            if category and article.category != category and category not in article.tags:
                continue
            articles.append(article)

    deduped_articles = _dedupe_articles(articles)
    deduped_articles.sort(key=_article_sort_key, reverse=True)
    limited_articles = deduped_articles[:limit]

    return WorldNewsFeedResponse(
        articles=limited_articles,
        total=len(deduped_articles),
        fetched_at=now,
        source_count=len(selected_sources),
        feed_count=feed_count,
        failed_feed_count=failed_feed_count,
        region=region,
        category=category,
        language=language,
        source=source,
        freshness_hours=freshness_hours,
    )


def _select_sources(
    *,
    region: str | None,
    category: str | None,
    language: str | None,
    source_id: str | None,
) -> list[WorldNewsSourceConfig]:
    return [
        source
        for source in WORLD_NEWS_SOURCES
        if (not region or source.region == region)
        and (not category or source.category == category)
        and (not language or source.language == language)
        and (not source_id or source.id == source_id or source.domain == source_id)
    ]


async def _fetch_feed(
    client: httpx.AsyncClient,
    source: WorldNewsSourceConfig,
    feed_url: str,
) -> FeedFetchResult:
    try:
        response = await client.get(feed_url)
        response.raise_for_status()
    except Exception as exc:
        logger.warning(
            "World news feed fetch failed",
            extra={"source": source.id, "feed_url": feed_url, "error": str(exc)},
        )
        return FeedFetchResult(articles=[], failed=True)

    return FeedFetchResult(articles=_parse_feed(response.text, source=source, feed_url=feed_url))


def _parse_feed(
    xml_text: str,
    *,
    source: WorldNewsSourceConfig,
    feed_url: str,
) -> list[WorldNewsArticle]:
    try:
        root = ET.fromstring(xml_text.encode("utf-8"))
    except ET.ParseError as exc:
        logger.warning(
            "World news feed XML parse failed",
            extra={"source": source.id, "feed_url": feed_url, "error": str(exc)},
        )
        return []

    articles: list[WorldNewsArticle] = []
    for item in _iter_feed_items(root):
        article = _parse_feed_item(item, source=source, feed_url=feed_url)
        if article is not None:
            articles.append(article)

    return articles


def _parse_feed_item(
    item: ET.Element,
    *,
    source: WorldNewsSourceConfig,
    feed_url: str,
) -> WorldNewsArticle | None:
    title = _clean_text(_child_text(item, {"title"}))
    if not title:
        return None

    summary = _clean_text(_child_text(item, {"description", "summary", "content", "encoded"}))
    link = _extract_link(item)
    if not link:
        link = source.homepage_url

    published_at = _parse_datetime(
        _child_text(item, {"pubdate", "published", "updated", "dc:date", "date"})
    )
    feed_categories = [_clean_text(child.text) for child in item if _local_name(child.tag) == "category"]
    category, tags = _classify_article(title, summary, feed_categories, source)
    article_id = _build_article_id(source.id, link, title, _child_text(item, {"guid", "id"}))

    return WorldNewsArticle(
        id=article_id,
        title=title,
        summary=summary or None,
        source_id=source.id,
        source=source.name,
        source_domain=source.domain,
        source_url=source.homepage_url,
        feed_url=feed_url,
        url=link,
        published_at=published_at,
        region=source.region,
        category=category,
        language=source.language,
        tags=tags,
        relevance_score=_score_article(source, category, tags),
        live=True,
    )


def _iter_feed_items(root: ET.Element) -> list[ET.Element]:
    items: list[ET.Element] = []
    for element in root.iter():
        tag = _local_name(element.tag)
        if tag in {"item", "entry"}:
            items.append(element)
    return items


def _local_name(tag: Any) -> str:
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1].lower()


def _child_text(item: ET.Element, names: set[str]) -> str | None:
    normalized_names = {name.lower() for name in names}
    for child in item:
        child_name = _local_name(child.tag)
        if child_name in normalized_names or f"dc:{child_name}" in normalized_names:
            return child.text or ""
    return None


def _extract_link(item: ET.Element) -> str | None:
    rss_link = _child_text(item, {"link"})
    if rss_link and rss_link.strip():
        return rss_link.strip()

    for child in item:
        if _local_name(child.tag) != "link":
            continue
        rel = (child.attrib.get("rel") or "alternate").lower()
        href = child.attrib.get("href")
        if href and rel in {"alternate", ""}:
            return href.strip()
    return None


def _clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = html.unescape(value)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_datetime(value: str | None) -> datetime | None:
    if not value or not value.strip():
        return None

    normalized = value.strip().replace("Z", "+00:00")
    try:
        return _coerce_utc(datetime.fromisoformat(normalized))
    except ValueError:
        pass

    try:
        return _coerce_utc(parsedate_to_datetime(normalized))
    except (TypeError, ValueError, IndexError, OverflowError):
        return None


def _coerce_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _classify_article(
    title: str,
    summary: str,
    feed_categories: list[str],
    source: WorldNewsSourceConfig,
) -> tuple[str, list[str]]:
    combined = " ".join([title, summary, " ".join(feed_categories)]).lower()
    scores: dict[str, int] = dict.fromkeys(VALID_WORLD_NEWS_CATEGORIES, 0)
    matched_tags: list[str] = []

    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword in combined:
                scores[category] += 1
        if scores[category] > 0:
            matched_tags.append(category)

    if any(keyword in combined for keyword in VIETNAM_KEYWORDS) or source.region == "vietnam":
        matched_tags.append("vietnam")

    cleaned_feed_categories = [category.lower() for category in feed_categories if category]
    matched_tags.extend(cleaned_feed_categories[:4])
    best_category = max(scores.items(), key=lambda item: item[1])[0]
    if scores[best_category] == 0:
        best_category = source.category

    tags = list(dict.fromkeys(tag for tag in matched_tags if tag))[:8]
    return best_category, tags


def _score_article(source: WorldNewsSourceConfig, category: str, tags: list[str]) -> float:
    score = 0.5 + max(0, 4 - source.tier) * 0.08
    if source.region == "vietnam":
        score += 0.08
    if category == source.category:
        score += 0.06
    score += min(len(tags), 5) * 0.02
    return round(min(score, 0.99), 3)


def _build_article_id(source_id: str, link: str, title: str, guid: str | None) -> str:
    stable_value = (guid or link or title).strip().lower()
    digest = hashlib.sha1(stable_value.encode("utf-8")).hexdigest()[:16]
    return f"{source_id}-{digest}"


def _dedupe_articles(articles: list[WorldNewsArticle]) -> list[WorldNewsArticle]:
    seen: set[str] = set()
    deduped: list[WorldNewsArticle] = []
    for article in articles:
        key = _dedupe_key(article)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(article)
    return deduped


def _dedupe_key(article: WorldNewsArticle) -> str:
    parsed_url = urlparse(article.url)
    if parsed_url.netloc and parsed_url.path:
        return f"{parsed_url.netloc.lower()}{parsed_url.path.rstrip('/').lower()}"
    return re.sub(r"[^a-z0-9]+", "-", article.title.lower()).strip("-")


def _article_sort_key(article: WorldNewsArticle) -> tuple[datetime, float]:
    published_at = article.published_at or datetime(1970, 1, 1, tzinfo=UTC)
    return _coerce_utc(published_at), article.relevance_score


def _to_source_info(source: WorldNewsSourceConfig) -> WorldNewsSourceInfo:
    return WorldNewsSourceInfo(
        id=source.id,
        name=source.name,
        domain=source.domain,
        region=source.region,
        category=source.category,
        language=source.language,
        tier=source.tier,
        homepage_url=source.homepage_url,
        feed_urls=list(source.feed_urls),
    )
