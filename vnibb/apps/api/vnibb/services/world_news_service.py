from __future__ import annotations

import asyncio
import hashlib
import html
import ipaddress
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse, urlunparse
from xml.etree import ElementTree as ET

import httpx
from pydantic import BaseModel, Field

from vnibb.core.config import settings

logger = logging.getLogger(__name__)


VALID_WORLD_NEWS_REGIONS = {
    "vietnam",
    "asia",
    "us",
    "europe",
    "middleeast",
    "africa",
    "latam",
    "oceania",
    "global",
}
VALID_WORLD_NEWS_CATEGORIES = {"markets", "economy", "business", "geopolitics", "technology"}
VALID_WORLD_NEWS_LANGUAGES = {"vi", "en"}
CUSTOM_RSS_SOURCE_ID_PREFIX = "custom_rss"
MAX_CUSTOM_RSS_URL_LENGTH = 500


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
    country_code: str
    country_name: str
    latitude: float
    longitude: float
    map_region: str


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


class WorldNewsMapBucket(BaseModel):
    id: str
    label: str
    region: str
    country_code: str
    country_name: str
    latitude: float
    longitude: float
    article_count: int
    source_count: int
    failed_feed_count: int = 0
    top_category: str | None = None
    top_sources: list[str] = Field(default_factory=list)
    latest_headline: str | None = None
    latest_published_at: datetime | None = None
    latest_articles: list[WorldNewsArticle] = Field(default_factory=list)


class WorldNewsMapResponse(BaseModel):
    buckets: list[WorldNewsMapBucket]
    total_articles: int
    source_count: int
    feed_count: int
    failed_feed_count: int = 0
    fetched_at: datetime
    region: str | None = None
    category: str | None = None
    language: str | None = None
    freshness_hours: int


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
    WorldNewsSourceConfig(
        id="guardian_world",
        name="The Guardian World",
        domain="theguardian.com",
        region="global",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.theguardian.com/world",
        feed_urls=("https://www.theguardian.com/world/rss",),
    ),
    WorldNewsSourceConfig(
        id="reuters_world",
        name="Reuters World",
        domain="reuters.com",
        region="global",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.reuters.com/world/",
        feed_urls=(
            "https://news.google.com/rss/search?q=site:reuters.com%20world%20when:1d&hl=en-US&gl=US&ceid=US:en",
        ),
    ),
    WorldNewsSourceConfig(
        id="reuters_business",
        name="Reuters Business",
        domain="reuters.com",
        region="global",
        category="business",
        language="en",
        tier=1,
        homepage_url="https://www.reuters.com/business/",
        feed_urls=(
            "https://news.google.com/rss/search?q=site:reuters.com%20business%20markets%20when:1d&hl=en-US&gl=US&ceid=US:en",
        ),
    ),
    WorldNewsSourceConfig(
        id="bloomberg_markets",
        name="Bloomberg Markets",
        domain="bloomberg.com",
        region="us",
        category="markets",
        language="en",
        tier=1,
        homepage_url="https://www.bloomberg.com/markets",
        feed_urls=(
            "https://news.google.com/rss/search?q=site:bloomberg.com%20markets%20when:1d&hl=en-US&gl=US&ceid=US:en",
        ),
    ),
    WorldNewsSourceConfig(
        id="marketwatch_markets",
        name="MarketWatch Markets",
        domain="marketwatch.com",
        region="us",
        category="markets",
        language="en",
        tier=2,
        homepage_url="https://www.marketwatch.com/markets",
        feed_urls=(
            "https://news.google.com/rss/search?q=site:marketwatch.com%20markets%20when:1d&hl=en-US&gl=US&ceid=US:en",
        ),
    ),
    WorldNewsSourceConfig(
        id="yahoo_finance",
        name="Yahoo Finance",
        domain="finance.yahoo.com",
        region="us",
        category="markets",
        language="en",
        tier=2,
        homepage_url="https://finance.yahoo.com/news/",
        feed_urls=("https://finance.yahoo.com/news/rssindex",),
    ),
    WorldNewsSourceConfig(
        id="financial_times",
        name="Financial Times",
        domain="ft.com",
        region="europe",
        category="business",
        language="en",
        tier=1,
        homepage_url="https://www.ft.com/",
        feed_urls=("https://www.ft.com/rss/home",),
    ),
    WorldNewsSourceConfig(
        id="npr_news",
        name="NPR News",
        domain="npr.org",
        region="us",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.npr.org/sections/news/",
        feed_urls=("https://feeds.npr.org/1001/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="pbs_newshour",
        name="PBS NewsHour",
        domain="pbs.org",
        region="us",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.pbs.org/newshour/",
        feed_urls=("https://www.pbs.org/newshour/feeds/rss/headlines",),
    ),
    WorldNewsSourceConfig(
        id="france24_world",
        name="France 24 World",
        domain="france24.com",
        region="europe",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.france24.com/en/",
        feed_urls=("https://www.france24.com/en/rss",),
    ),
    WorldNewsSourceConfig(
        id="euronews_world",
        name="Euronews",
        domain="euronews.com",
        region="europe",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.euronews.com/",
        feed_urls=("https://www.euronews.com/rss?format=xml",),
    ),
    WorldNewsSourceConfig(
        id="dw_news",
        name="DW News",
        domain="dw.com",
        region="europe",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.dw.com/en/top-stories/s-9097",
        feed_urls=("https://rss.dw.com/xml/rss-en-all",),
    ),
    WorldNewsSourceConfig(
        id="le_monde_en",
        name="Le Monde English",
        domain="lemonde.fr",
        region="europe",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.lemonde.fr/en/",
        feed_urls=("https://www.lemonde.fr/en/rss/une.xml",),
    ),
    WorldNewsSourceConfig(
        id="bbc_middle_east",
        name="BBC Middle East",
        domain="bbc.co.uk",
        region="middleeast",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.bbc.com/news/world/middle_east",
        feed_urls=("https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="guardian_middle_east",
        name="The Guardian Middle East",
        domain="theguardian.com",
        region="middleeast",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.theguardian.com/world/middleeast",
        feed_urls=("https://www.theguardian.com/world/middleeast/rss",),
    ),
    WorldNewsSourceConfig(
        id="the_national_middle_east",
        name="The National Middle East",
        domain="thenationalnews.com",
        region="middleeast",
        category="business",
        language="en",
        tier=2,
        homepage_url="https://www.thenationalnews.com/",
        feed_urls=("https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml",),
    ),
    WorldNewsSourceConfig(
        id="al_arabiya_business",
        name="Al Arabiya Business",
        domain="alarabiya.net",
        region="middleeast",
        category="business",
        language="en",
        tier=2,
        homepage_url="https://english.alarabiya.net/business",
        feed_urls=(
            "https://news.google.com/rss/search?q=site:english.alarabiya.net%20business%20when:2d&hl=en-US&gl=US&ceid=US:en",
        ),
    ),
    WorldNewsSourceConfig(
        id="bbc_asia",
        name="BBC Asia",
        domain="bbc.co.uk",
        region="asia",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.bbc.com/news/world/asia",
        feed_urls=("https://feeds.bbci.co.uk/news/world/asia/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="the_diplomat_asia",
        name="The Diplomat",
        domain="thediplomat.com",
        region="asia",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://thediplomat.com/",
        feed_urls=("https://thediplomat.com/feed/",),
    ),
    WorldNewsSourceConfig(
        id="cna_asia",
        name="Channel NewsAsia",
        domain="channelnewsasia.com",
        region="asia",
        category="business",
        language="en",
        tier=2,
        homepage_url="https://www.channelnewsasia.com/",
        feed_urls=("https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml",),
    ),
    WorldNewsSourceConfig(
        id="nikkei_asia",
        name="Nikkei Asia",
        domain="asia.nikkei.com",
        region="asia",
        category="markets",
        language="en",
        tier=1,
        homepage_url="https://asia.nikkei.com/",
        feed_urls=(
            "https://news.google.com/rss/search?q=site:asia.nikkei.com%20when:3d&hl=en-US&gl=US&ceid=US:en",
        ),
    ),
    WorldNewsSourceConfig(
        id="ndtv_india",
        name="NDTV India",
        domain="ndtv.com",
        region="asia",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.ndtv.com/",
        feed_urls=("https://feeds.feedburner.com/ndtvnews-top-stories",),
    ),
    WorldNewsSourceConfig(
        id="the_hindu_india",
        name="The Hindu India",
        domain="thehindu.com",
        region="asia",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.thehindu.com/",
        feed_urls=("https://www.thehindu.com/feeder/default.rss",),
    ),
    WorldNewsSourceConfig(
        id="abc_australia",
        name="ABC News Australia",
        domain="abc.net.au",
        region="oceania",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.abc.net.au/news/",
        feed_urls=("https://www.abc.net.au/news/feed/2942460/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="guardian_australia",
        name="The Guardian Australia",
        domain="theguardian.com",
        region="oceania",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.theguardian.com/australia-news",
        feed_urls=("https://www.theguardian.com/australia-news/rss",),
    ),
    WorldNewsSourceConfig(
        id="bbc_africa",
        name="BBC Africa",
        domain="bbc.co.uk",
        region="africa",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.bbc.com/news/world/africa",
        feed_urls=("https://feeds.bbci.co.uk/news/world/africa/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="news24_africa",
        name="News24 Africa",
        domain="news24.com",
        region="africa",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.news24.com/news24/africa",
        feed_urls=("https://feeds.news24.com/articles/news24/TopStories/rss",),
    ),
    WorldNewsSourceConfig(
        id="africanews",
        name="Africanews",
        domain="africanews.com",
        region="africa",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.africanews.com/",
        feed_urls=("https://www.africanews.com/feed/rss",),
    ),
    WorldNewsSourceConfig(
        id="premium_times_nigeria",
        name="Premium Times Nigeria",
        domain="premiumtimesng.com",
        region="africa",
        category="business",
        language="en",
        tier=2,
        homepage_url="https://www.premiumtimesng.com/",
        feed_urls=("https://www.premiumtimesng.com/feed",),
    ),
    WorldNewsSourceConfig(
        id="bbc_latin_america",
        name="BBC Latin America",
        domain="bbc.co.uk",
        region="latam",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.bbc.com/news/world/latin_america",
        feed_urls=("https://feeds.bbci.co.uk/news/world/latin_america/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="guardian_americas",
        name="The Guardian Americas",
        domain="theguardian.com",
        region="latam",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.theguardian.com/world/americas",
        feed_urls=("https://www.theguardian.com/world/americas/rss",),
    ),
    WorldNewsSourceConfig(
        id="insight_crime",
        name="InSight Crime",
        domain="insightcrime.org",
        region="latam",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://insightcrime.org/",
        feed_urls=("https://insightcrime.org/feed/",),
    ),
    WorldNewsSourceConfig(
        id="infobae_americas",
        name="Infobae Americas",
        domain="infobae.com",
        region="latam",
        category="business",
        language="en",
        tier=2,
        homepage_url="https://www.infobae.com/america/",
        feed_urls=("https://www.infobae.com/arc/outboundfeeds/rss/",),
    ),
    WorldNewsSourceConfig(
        id="techcrunch",
        name="TechCrunch",
        domain="techcrunch.com",
        region="us",
        category="technology",
        language="en",
        tier=1,
        homepage_url="https://techcrunch.com/",
        feed_urls=("https://techcrunch.com/feed/",),
    ),
    WorldNewsSourceConfig(
        id="the_verge",
        name="The Verge",
        domain="theverge.com",
        region="us",
        category="technology",
        language="en",
        tier=2,
        homepage_url="https://www.theverge.com/",
        feed_urls=("https://www.theverge.com/rss/index.xml",),
    ),
    WorldNewsSourceConfig(
        id="mit_tech_review",
        name="MIT Technology Review",
        domain="technologyreview.com",
        region="us",
        category="technology",
        language="en",
        tier=2,
        homepage_url="https://www.technologyreview.com/",
        feed_urls=("https://www.technologyreview.com/feed/",),
    ),
    WorldNewsSourceConfig(
        id="venturebeat_ai",
        name="VentureBeat AI",
        domain="venturebeat.com",
        region="us",
        category="technology",
        language="en",
        tier=2,
        homepage_url="https://venturebeat.com/category/ai/",
        feed_urls=("https://venturebeat.com/category/ai/feed/",),
    ),
    WorldNewsSourceConfig(
        id="foreign_policy",
        name="Foreign Policy",
        domain="foreignpolicy.com",
        region="global",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://foreignpolicy.com/",
        feed_urls=("https://foreignpolicy.com/feed/",),
    ),
    WorldNewsSourceConfig(
        id="foreign_affairs",
        name="Foreign Affairs",
        domain="foreignaffairs.com",
        region="global",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.foreignaffairs.com/",
        feed_urls=("https://www.foreignaffairs.com/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="atlantic_council",
        name="Atlantic Council",
        domain="atlanticcouncil.org",
        region="global",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.atlanticcouncil.org/",
        feed_urls=("https://www.atlanticcouncil.org/feed/",),
    ),
    WorldNewsSourceConfig(
        id="csis",
        name="CSIS",
        domain="csis.org",
        region="us",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://www.csis.org/",
        feed_urls=("https://www.csis.org/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="war_on_the_rocks",
        name="War on the Rocks",
        domain="warontherocks.com",
        region="us",
        category="geopolitics",
        language="en",
        tier=2,
        homepage_url="https://warontherocks.com/",
        feed_urls=("https://warontherocks.com/feed/",),
    ),
    WorldNewsSourceConfig(
        id="crisiswatch",
        name="CrisisWatch",
        domain="crisisgroup.org",
        region="global",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.crisisgroup.org/crisiswatch",
        feed_urls=("https://www.crisisgroup.org/rss",),
    ),
    WorldNewsSourceConfig(
        id="un_news",
        name="UN News",
        domain="news.un.org",
        region="global",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://news.un.org/en/",
        feed_urls=("https://news.un.org/feed/subscribe/en/news/all/rss.xml",),
    ),
    WorldNewsSourceConfig(
        id="iaea_news",
        name="IAEA News",
        domain="iaea.org",
        region="europe",
        category="geopolitics",
        language="en",
        tier=1,
        homepage_url="https://www.iaea.org/newscenter",
        feed_urls=("https://www.iaea.org/feeds/topnews",),
    ),
    WorldNewsSourceConfig(
        id="cisa_alerts",
        name="CISA Alerts",
        domain="cisa.gov",
        region="us",
        category="technology",
        language="en",
        tier=1,
        homepage_url="https://www.cisa.gov/news-events/cybersecurity-advisories",
        feed_urls=("https://www.cisa.gov/cybersecurity-advisories/all.xml",),
    ),
)


WORLD_NEWS_SOURCE_GEO: dict[str, dict[str, str | float]] = {
    "cafef_markets": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 21.0285,
        "longitude": 105.8542,
        "map_region": "Vietnam",
    },
    "cafef_macro": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 21.0285,
        "longitude": 105.8542,
        "map_region": "Vietnam",
    },
    "vietstock_markets": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 10.8231,
        "longitude": 106.6297,
        "map_region": "Vietnam",
    },
    "vietstock_economy": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 10.8231,
        "longitude": 106.6297,
        "map_region": "Vietnam",
    },
    "vnexpress_business": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 21.0285,
        "longitude": 105.8542,
        "map_region": "Vietnam",
    },
    "vnexpress_world": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 21.0285,
        "longitude": 105.8542,
        "map_region": "Vietnam",
    },
    "tuoitre_business": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 10.8231,
        "longitude": 106.6297,
        "map_region": "Vietnam",
    },
    "vneconomy_markets": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 21.0285,
        "longitude": 105.8542,
        "map_region": "Vietnam",
    },
    "baodautu_business": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 21.0285,
        "longitude": 105.8542,
        "map_region": "Vietnam",
    },
    "bbc_business": {
        "country_code": "GB",
        "country_name": "United Kingdom",
        "latitude": 51.5072,
        "longitude": -0.1276,
        "map_region": "Europe",
    },
    "bbc_world": {
        "country_code": "GB",
        "country_name": "United Kingdom",
        "latitude": 51.5072,
        "longitude": -0.1276,
        "map_region": "Europe",
    },
    "ap_business": {
        "country_code": "US",
        "country_name": "United States",
        "latitude": 40.7128,
        "longitude": -74.006,
        "map_region": "North America",
    },
    "ap_world": {
        "country_code": "US",
        "country_name": "United States",
        "latitude": 40.7128,
        "longitude": -74.006,
        "map_region": "North America",
    },
    "cnbc_markets": {
        "country_code": "US",
        "country_name": "United States",
        "latitude": 40.7128,
        "longitude": -74.006,
        "map_region": "North America",
    },
    "guardian_business": {
        "country_code": "GB",
        "country_name": "United Kingdom",
        "latitude": 51.5072,
        "longitude": -0.1276,
        "map_region": "Europe",
    },
    "aljazeera_global": {
        "country_code": "QA",
        "country_name": "Qatar",
        "latitude": 25.2854,
        "longitude": 51.531,
        "map_region": "Middle East",
    },
}

WORLD_NEWS_REGION_GEO: dict[str, dict[str, str | float]] = {
    "vietnam": {
        "country_code": "VN",
        "country_name": "Vietnam",
        "latitude": 16.0544,
        "longitude": 108.2022,
        "map_region": "Vietnam",
    },
    "asia": {
        "country_code": "SG",
        "country_name": "Singapore",
        "latitude": 1.3521,
        "longitude": 103.8198,
        "map_region": "Asia",
    },
    "us": {
        "country_code": "US",
        "country_name": "United States",
        "latitude": 40.7128,
        "longitude": -74.006,
        "map_region": "North America",
    },
    "europe": {
        "country_code": "GB",
        "country_name": "United Kingdom",
        "latitude": 51.5072,
        "longitude": -0.1276,
        "map_region": "Europe",
    },
    "middleeast": {
        "country_code": "AE",
        "country_name": "United Arab Emirates",
        "latitude": 24.4539,
        "longitude": 54.3773,
        "map_region": "Middle East",
    },
    "africa": {
        "country_code": "ZA",
        "country_name": "South Africa",
        "latitude": -26.2041,
        "longitude": 28.0473,
        "map_region": "Africa",
    },
    "latam": {
        "country_code": "BR",
        "country_name": "Brazil",
        "latitude": -15.7939,
        "longitude": -47.8828,
        "map_region": "Latin America",
    },
    "oceania": {
        "country_code": "AU",
        "country_name": "Australia",
        "latitude": -35.2809,
        "longitude": 149.13,
        "map_region": "Oceania",
    },
    "global": {
        "country_code": "GB",
        "country_name": "United Kingdom",
        "latitude": 51.5072,
        "longitude": -0.1276,
        "map_region": "Global",
    },
}

WORLD_NEWS_SOURCE_GEO.update(
    {
        "guardian_world": WORLD_NEWS_REGION_GEO["global"],
        "reuters_world": WORLD_NEWS_REGION_GEO["global"],
        "reuters_business": WORLD_NEWS_REGION_GEO["global"],
        "bloomberg_markets": WORLD_NEWS_REGION_GEO["us"],
        "marketwatch_markets": WORLD_NEWS_REGION_GEO["us"],
        "yahoo_finance": WORLD_NEWS_REGION_GEO["us"],
        "financial_times": WORLD_NEWS_REGION_GEO["europe"],
        "npr_news": WORLD_NEWS_REGION_GEO["us"],
        "pbs_newshour": WORLD_NEWS_REGION_GEO["us"],
        "france24_world": {
            "country_code": "FR",
            "country_name": "France",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "map_region": "Europe",
        },
        "euronews_world": {
            "country_code": "FR",
            "country_name": "France",
            "latitude": 45.764,
            "longitude": 4.8357,
            "map_region": "Europe",
        },
        "dw_news": {
            "country_code": "DE",
            "country_name": "Germany",
            "latitude": 52.52,
            "longitude": 13.405,
            "map_region": "Europe",
        },
        "le_monde_en": {
            "country_code": "FR",
            "country_name": "France",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "map_region": "Europe",
        },
        "bbc_middle_east": WORLD_NEWS_REGION_GEO["middleeast"],
        "guardian_middle_east": WORLD_NEWS_REGION_GEO["middleeast"],
        "the_national_middle_east": WORLD_NEWS_REGION_GEO["middleeast"],
        "al_arabiya_business": {
            "country_code": "SA",
            "country_name": "Saudi Arabia",
            "latitude": 24.7136,
            "longitude": 46.6753,
            "map_region": "Middle East",
        },
        "bbc_asia": WORLD_NEWS_REGION_GEO["asia"],
        "the_diplomat_asia": {
            "country_code": "JP",
            "country_name": "Japan",
            "latitude": 35.6762,
            "longitude": 139.6503,
            "map_region": "Asia",
        },
        "cna_asia": WORLD_NEWS_REGION_GEO["asia"],
        "nikkei_asia": {
            "country_code": "JP",
            "country_name": "Japan",
            "latitude": 35.6762,
            "longitude": 139.6503,
            "map_region": "Asia",
        },
        "ndtv_india": {
            "country_code": "IN",
            "country_name": "India",
            "latitude": 28.6139,
            "longitude": 77.209,
            "map_region": "Asia",
        },
        "the_hindu_india": {
            "country_code": "IN",
            "country_name": "India",
            "latitude": 13.0827,
            "longitude": 80.2707,
            "map_region": "Asia",
        },
        "abc_australia": WORLD_NEWS_REGION_GEO["oceania"],
        "guardian_australia": WORLD_NEWS_REGION_GEO["oceania"],
        "bbc_africa": WORLD_NEWS_REGION_GEO["africa"],
        "news24_africa": WORLD_NEWS_REGION_GEO["africa"],
        "africanews": {
            "country_code": "CG",
            "country_name": "Republic of the Congo",
            "latitude": -4.2634,
            "longitude": 15.2429,
            "map_region": "Africa",
        },
        "premium_times_nigeria": {
            "country_code": "NG",
            "country_name": "Nigeria",
            "latitude": 9.0765,
            "longitude": 7.3986,
            "map_region": "Africa",
        },
        "bbc_latin_america": WORLD_NEWS_REGION_GEO["latam"],
        "guardian_americas": WORLD_NEWS_REGION_GEO["latam"],
        "insight_crime": {
            "country_code": "CO",
            "country_name": "Colombia",
            "latitude": 4.711,
            "longitude": -74.0721,
            "map_region": "Latin America",
        },
        "infobae_americas": {
            "country_code": "AR",
            "country_name": "Argentina",
            "latitude": -34.6037,
            "longitude": -58.3816,
            "map_region": "Latin America",
        },
        "techcrunch": WORLD_NEWS_REGION_GEO["us"],
        "the_verge": WORLD_NEWS_REGION_GEO["us"],
        "mit_tech_review": WORLD_NEWS_REGION_GEO["us"],
        "venturebeat_ai": WORLD_NEWS_REGION_GEO["us"],
        "foreign_policy": WORLD_NEWS_REGION_GEO["us"],
        "foreign_affairs": WORLD_NEWS_REGION_GEO["us"],
        "atlantic_council": WORLD_NEWS_REGION_GEO["us"],
        "csis": WORLD_NEWS_REGION_GEO["us"],
        "war_on_the_rocks": WORLD_NEWS_REGION_GEO["us"],
        "crisiswatch": {
            "country_code": "BE",
            "country_name": "Belgium",
            "latitude": 50.8503,
            "longitude": 4.3517,
            "map_region": "Europe",
        },
        "un_news": {
            "country_code": "US",
            "country_name": "United States",
            "latitude": 40.7489,
            "longitude": -73.968,
            "map_region": "North America",
        },
        "iaea_news": {
            "country_code": "AT",
            "country_name": "Austria",
            "latitude": 48.2082,
            "longitude": 16.3738,
            "map_region": "Europe",
        },
        "cisa_alerts": WORLD_NEWS_REGION_GEO["us"],
    }
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

DEDUP_STOP_WORDS = {
    "about",
    "after",
    "again",
    "amid",
    "from",
    "have",
    "into",
    "more",
    "news",
    "over",
    "said",
    "says",
    "than",
    "that",
    "their",
    "this",
    "with",
    "world",
    "will",
    "trong",
    "nhung",
    "những",
    "duoc",
    "được",
    "theo",
    "dang",
    "đang",
}


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
    custom_feed_url: str | None = None,
    custom_source_name: str | None = None,
    limit: int = 40,
    freshness_hours: int = 72,
) -> WorldNewsFeedResponse:
    selected_sources = list(
        _select_sources(
            region=region,
            category=None,
            language=language,
            source_id=source,
        )
    )
    custom_source = _custom_source_from_url(
        custom_feed_url,
        name=custom_source_name,
        region=region,
        category=category,
        language=language,
    )
    if custom_source is not None and not source:
        selected_sources.append(custom_source)

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


async def get_world_news_map(
    *,
    region: str | None = None,
    category: str | None = None,
    language: str | None = None,
    custom_feed_url: str | None = None,
    custom_source_name: str | None = None,
    limit: int = 100,
    freshness_hours: int = 72,
) -> WorldNewsMapResponse:
    selected_sources = list(
        _select_sources(
            region=region,
            category=None,
            language=language,
            source_id=None,
        )
    )
    custom_source = _custom_source_from_url(
        custom_feed_url,
        name=custom_source_name,
        region=region,
        category=category,
        language=language,
    )
    if custom_source is not None:
        selected_sources.append(custom_source)

    source_by_id = {source.id: source for source in selected_sources}
    feed = await get_world_news_feed(
        region=region,
        category=category,
        language=language,
        custom_feed_url=custom_feed_url,
        custom_source_name=custom_source_name,
        limit=limit,
        freshness_hours=freshness_hours,
    )

    bucket_meta: dict[str, dict[str, str | float]] = {}
    bucket_sources: dict[str, dict[str, int]] = {}
    bucket_categories: dict[str, dict[str, int]] = {}
    bucket_articles: dict[str, list[WorldNewsArticle]] = {}

    for source in selected_sources:
        bucket_id, geo = _source_bucket(source)
        bucket_meta[bucket_id] = geo
        bucket_sources.setdefault(bucket_id, {})[source.name] = 0
        bucket_categories.setdefault(bucket_id, {})
        bucket_articles.setdefault(bucket_id, [])

    for article in feed.articles:
        source = source_by_id.get(article.source_id)
        if source is None:
            continue

        bucket_id, geo = _source_bucket(source)
        bucket_meta[bucket_id] = geo
        source_counts = bucket_sources.setdefault(bucket_id, {})
        source_counts[article.source] = source_counts.get(article.source, 0) + 1
        category_counts = bucket_categories.setdefault(bucket_id, {})
        category_counts[article.category] = category_counts.get(article.category, 0) + 1
        bucket_articles.setdefault(bucket_id, []).append(article)

    buckets: list[WorldNewsMapBucket] = []
    for bucket_id, geo in bucket_meta.items():
        articles = sorted(bucket_articles.get(bucket_id, []), key=_article_sort_key, reverse=True)
        category_counts = bucket_categories.get(bucket_id, {})
        source_counts = bucket_sources.get(bucket_id, {})
        top_category = None
        if category_counts:
            top_category = max(category_counts.items(), key=lambda item: (item[1], item[0]))[0]

        buckets.append(
            WorldNewsMapBucket(
                id=bucket_id,
                label=str(geo["country_name"]),
                region=str(geo["map_region"]),
                country_code=str(geo["country_code"]),
                country_name=str(geo["country_name"]),
                latitude=float(geo["latitude"]),
                longitude=float(geo["longitude"]),
                article_count=len(articles),
                source_count=len(source_counts),
                top_category=top_category,
                top_sources=[
                    source_name
                    for source_name, _count in sorted(
                        source_counts.items(), key=lambda item: (-item[1], item[0])
                    )[:5]
                ],
                latest_headline=articles[0].title if articles else None,
                latest_published_at=articles[0].published_at if articles else None,
                latest_articles=articles[:5],
            )
        )

    buckets.sort(
        key=lambda bucket: (
            bucket.article_count,
            bucket.latest_published_at or datetime(1970, 1, 1, tzinfo=UTC),
            bucket.source_count,
        ),
        reverse=True,
    )

    return WorldNewsMapResponse(
        buckets=buckets,
        total_articles=feed.total,
        source_count=feed.source_count,
        feed_count=feed.feed_count,
        failed_feed_count=feed.failed_feed_count,
        fetched_at=feed.fetched_at,
        region=region,
        category=category,
        language=language,
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


def _custom_source_from_url(
    feed_url: str | None,
    *,
    name: str | None,
    region: str | None,
    category: str | None,
    language: str | None,
) -> WorldNewsSourceConfig | None:
    normalized_feed_url = _normalize_custom_feed_url(feed_url)
    if not normalized_feed_url:
        return None

    parsed = urlparse(normalized_feed_url)
    domain = (parsed.hostname or "custom-rss.local").lower()
    source_region = region if region in VALID_WORLD_NEWS_REGIONS else "global"
    source_category = category if category in VALID_WORLD_NEWS_CATEGORIES else "business"
    source_language = language if language in VALID_WORLD_NEWS_LANGUAGES else "en"
    digest = hashlib.sha1(normalized_feed_url.encode("utf-8")).hexdigest()[:10]
    source_name = _clean_custom_source_name(name, domain)

    return WorldNewsSourceConfig(
        id=f"{CUSTOM_RSS_SOURCE_ID_PREFIX}_{digest}",
        name=source_name,
        domain=domain.removeprefix("www."),
        region=source_region,
        category=source_category,
        language=source_language,
        tier=3,
        homepage_url=urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")),
        feed_urls=(normalized_feed_url,),
    )


def _normalize_custom_feed_url(feed_url: str | None) -> str | None:
    if not feed_url:
        return None

    value = feed_url.strip()
    if not value or len(value) > MAX_CUSTOM_RSS_URL_LENGTH:
        return None

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if parsed.username or parsed.password:
        return None

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname or hostname in {"localhost", "localhost.localdomain"}:
        return None
    if hostname.endswith(".local") or "." not in hostname:
        return None

    try:
        address = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        address = None
    if address and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        return None

    path = parsed.path or "/"
    return urlunparse((parsed.scheme, parsed.netloc.lower(), path, "", parsed.query, ""))


def _clean_custom_source_name(name: str | None, domain: str) -> str:
    cleaned = _clean_text(name or "")[:80]
    return cleaned or f"Custom RSS ({domain.removeprefix('www.')})"


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
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    seen_token_sets: list[set[str]] = []
    deduped: list[WorldNewsArticle] = []
    for article in sorted(articles, key=_article_sort_key, reverse=True):
        url_key = _dedupe_url_key(article)
        title_key = _dedupe_title_key(article.title)
        title_tokens = _headline_tokens(article.title)

        if url_key and url_key in seen_urls:
            continue
        if title_key and title_key in seen_titles:
            continue
        if title_tokens and any(_headline_similarity(title_tokens, seen) >= 0.62 for seen in seen_token_sets):
            continue

        if url_key:
            seen_urls.add(url_key)
        if title_key:
            seen_titles.add(title_key)
        if title_tokens:
            seen_token_sets.append(title_tokens)
        deduped.append(article)
    return deduped


def _dedupe_url_key(article: WorldNewsArticle) -> str:
    parsed_url = urlparse(article.url)
    if parsed_url.netloc and parsed_url.path:
        domain = parsed_url.netloc.lower().removeprefix("www.")
        path = re.sub(r"/+", "/", parsed_url.path).rstrip("/").lower()
        return f"{domain}{path}"
    return ""


def _dedupe_title_key(title: str) -> str:
    normalized = _normalize_headline(title)
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def _headline_tokens(title: str) -> set[str]:
    normalized = _normalize_headline(title)
    return {
        token
        for token in re.findall(r"[a-z0-9]+", normalized)
        if len(token) >= 4 and token not in DEDUP_STOP_WORDS
    }


def _headline_similarity(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    overlap = len(left & right)
    return overlap / min(len(left), len(right))


def _normalize_headline(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title.lower())
    ascii_text = "".join(char for char in normalized if not unicodedata.combining(char))
    ascii_text = re.sub(r"\s[-–—|:]\s[^-–—|:]{2,48}$", "", ascii_text)
    ascii_text = re.sub(r"\b(live updates?|breaking news|exclusive|analysis|update)\b", " ", ascii_text)
    return re.sub(r"\s+", " ", ascii_text).strip()


def _article_sort_key(article: WorldNewsArticle) -> tuple[datetime, float]:
    published_at = article.published_at or datetime(1970, 1, 1, tzinfo=UTC)
    return _coerce_utc(published_at), article.relevance_score


def _source_bucket(source: WorldNewsSourceConfig) -> tuple[str, dict[str, str | float]]:
    geo = _source_geo(source)
    bucket_id = str(geo["country_code"]).lower()
    return bucket_id, geo


def _source_geo(source: WorldNewsSourceConfig) -> dict[str, str | float]:
    return (
        WORLD_NEWS_SOURCE_GEO.get(source.id)
        or WORLD_NEWS_REGION_GEO.get(source.region)
        or WORLD_NEWS_REGION_GEO["global"]
    )


def _to_source_info(source: WorldNewsSourceConfig) -> WorldNewsSourceInfo:
    geo = _source_geo(source)
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
        country_code=str(geo["country_code"]),
        country_name=str(geo["country_name"]),
        latitude=float(geo["latitude"]),
        longitude=float(geo["longitude"]),
        map_region=str(geo["map_region"]),
    )
