from datetime import UTC, datetime, timedelta

import pytest

from vnibb.services import world_news_service
from vnibb.services.world_news_service import (
    FeedFetchResult,
    WorldNewsArticle,
    WorldNewsSourceConfig,
    _parse_feed,
    get_world_news_feed,
)


def test_parse_feed_preserves_live_links_and_classifies_vietnam_markets():
    source = WorldNewsSourceConfig(
        id="test_vietnam_markets",
        name="Test Vietnam Markets",
        domain="example.vn",
        region="vietnam",
        category="markets",
        language="vi",
        tier=1,
        homepage_url="https://example.vn/markets",
        feed_urls=("https://example.vn/rss.xml",),
    )
    xml = """
    <rss version="2.0">
      <channel>
        <item>
          <title>VN-Index rallies as bank stocks lead the market</title>
          <description><![CDATA[Shares and liquidity improved across the Ho Chi Minh exchange.]]></description>
          <link>https://example.vn/vn-index-rally</link>
          <guid>story-1</guid>
          <pubDate>Fri, 01 May 2026 10:00:00 GMT</pubDate>
          <category>Markets</category>
        </item>
      </channel>
    </rss>
    """

    articles = _parse_feed(xml, source=source, feed_url="https://example.vn/rss.xml")

    assert len(articles) == 1
    assert articles[0].title == "VN-Index rallies as bank stocks lead the market"
    assert articles[0].url == "https://example.vn/vn-index-rally"
    assert articles[0].source_url == "https://example.vn/markets"
    assert articles[0].feed_url == "https://example.vn/rss.xml"
    assert articles[0].category == "markets"
    assert "vietnam" in articles[0].tags
    assert articles[0].live is True


@pytest.mark.asyncio
async def test_get_world_news_feed_filters_dedupes_and_reports_failed_feeds(monkeypatch):
    now = datetime.now(UTC)
    sources = (
        WorldNewsSourceConfig(
            id="source_a",
            name="Source A",
            domain="a.example",
            region="vietnam",
            category="markets",
            language="vi",
            tier=1,
            homepage_url="https://a.example",
            feed_urls=("https://a.example/rss.xml",),
        ),
        WorldNewsSourceConfig(
            id="source_b",
            name="Source B",
            domain="b.example",
            region="vietnam",
            category="business",
            language="vi",
            tier=2,
            homepage_url="https://b.example",
            feed_urls=("https://b.example/rss.xml",),
        ),
    )

    async def fake_fetch_feed(_client, source, feed_url):
        if source.id == "source_b":
            return FeedFetchResult(articles=[], failed=True)

        return FeedFetchResult(
            articles=[
                WorldNewsArticle(
                    id="a-1",
                    title="VN-Index extends gains",
                    source_id=source.id,
                    source=source.name,
                    source_domain=source.domain,
                    source_url=source.homepage_url,
                    feed_url=feed_url,
                    url="https://a.example/story",
                    published_at=now,
                    region=source.region,
                    category="markets",
                    language=source.language,
                    tags=["markets", "vietnam"],
                    relevance_score=0.9,
                ),
                WorldNewsArticle(
                    id="a-duplicate",
                    title="VN-Index extends gains duplicate",
                    source_id=source.id,
                    source=source.name,
                    source_domain=source.domain,
                    source_url=source.homepage_url,
                    feed_url=feed_url,
                    url="https://a.example/story",
                    published_at=now - timedelta(minutes=1),
                    region=source.region,
                    category="markets",
                    language=source.language,
                    tags=["markets"],
                    relevance_score=0.8,
                ),
                WorldNewsArticle(
                    id="a-old",
                    title="Old market story",
                    source_id=source.id,
                    source=source.name,
                    source_domain=source.domain,
                    source_url=source.homepage_url,
                    feed_url=feed_url,
                    url="https://a.example/old-story",
                    published_at=now - timedelta(days=10),
                    region=source.region,
                    category="markets",
                    language=source.language,
                    tags=["markets"],
                    relevance_score=0.7,
                ),
            ]
        )

    monkeypatch.setattr(world_news_service, "WORLD_NEWS_SOURCES", sources)
    monkeypatch.setattr(world_news_service, "_fetch_feed", fake_fetch_feed)

    response = await get_world_news_feed(
        region="vietnam",
        category="markets",
        limit=5,
        freshness_hours=72,
    )

    assert response.source_count == 2
    assert response.feed_count == 2
    assert response.failed_feed_count == 1
    assert response.total == 1
    assert response.articles[0].id == "a-1"
    assert response.articles[0].source_url == "https://a.example"
