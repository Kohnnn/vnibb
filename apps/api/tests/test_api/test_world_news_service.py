import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from vnibb.services import world_news_service
from vnibb.services.world_news_service import (
    FeedFetchResult,
    WorldNewsArticle,
    WorldNewsFailedFeed,
    WorldNewsSourceConfig,
    _custom_source_from_url,
    _dedupe_articles,
    _parse_feed,
    get_world_news_feed,
    get_world_news_map,
)


def _source(source_id: str, feed_url: str) -> WorldNewsSourceConfig:
    return WorldNewsSourceConfig(
        id=source_id,
        name=source_id,
        domain=f"{source_id}.example",
        region="global",
        category="business",
        language="en",
        tier=1,
        homepage_url=f"https://{source_id}.example",
        feed_urls=(feed_url,),
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


def test_parse_feed_handles_vnexpress_gmt7_and_vietnamese_weekday_dates():
    source = WorldNewsSourceConfig(
        id="vnexpress_test",
        name="VNExpress Test",
        domain="vnexpress.net",
        region="vietnam",
        category="business",
        language="vi",
        tier=1,
        homepage_url="https://vnexpress.net",
        feed_urls=("https://vnexpress.net/rss/kinh-doanh.rss",),
    )
    xml = """
    <rss version="2.0">
      <channel>
        <item>
          <title>Doanh nghiệp chứng khoán báo lãi tăng</title>
          <description>Thị trường chứng khoán ghi nhận thanh khoản cải thiện.</description>
          <link>https://vnexpress.net/chung-khoan</link>
          <guid>vnexpress-1</guid>
          <pubDate>Thứ 5, 28/05/2026 17:00:00 GMT+7</pubDate>
          <category>Kinh doanh</category>
        </item>
      </channel>
    </rss>
    """

    articles = _parse_feed(xml, source=source, feed_url=source.feed_urls[0])

    assert len(articles) == 1
    assert articles[0].published_at == datetime(2026, 5, 28, 10, 0, tzinfo=UTC)


def test_dedupe_articles_filters_similar_headlines_across_sources():
    now = datetime.now(UTC)
    articles = [
        WorldNewsArticle(
            id="a-1",
            title="Fed holds rates as markets wait for Powell signal",
            source_id="source_a",
            source="Source A",
            source_domain="a.example",
            source_url="https://a.example",
            feed_url="https://a.example/rss.xml",
            url="https://a.example/story-a",
            published_at=now,
            region="global",
            category="markets",
            language="en",
            tags=["markets"],
            relevance_score=0.9,
        ),
        WorldNewsArticle(
            id="b-1",
            title="Markets wait for Powell signal after Fed holds rates",
            source_id="source_b",
            source="Source B",
            source_domain="b.example",
            source_url="https://b.example",
            feed_url="https://b.example/rss.xml",
            url="https://b.example/story-b",
            published_at=now - timedelta(minutes=3),
            region="global",
            category="markets",
            language="en",
            tags=["markets"],
            relevance_score=0.8,
        ),
    ]

    deduped = _dedupe_articles(articles)

    assert len(deduped) == 1
    assert deduped[0].id == "a-1"


def test_custom_source_rejects_local_urls_and_uses_request_filters():
    rejected = _custom_source_from_url(
        "http://localhost:8000/rss.xml",
        name="Local",
        region="asia",
        category="technology",
        language="en",
    )
    accepted = _custom_source_from_url(
        "https://example.com/rss.xml",
        name="Example Feed",
        region="asia",
        category="technology",
        language="en",
    )

    assert rejected is None
    assert accepted is not None
    assert accepted.name == "Example Feed"
    assert accepted.region == "asia"
    assert accepted.category == "technology"
    assert accepted.feed_urls == ("https://example.com/rss.xml",)


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
            return FeedFetchResult(
                articles=[],
                failed=True,
                failed_feed=WorldNewsFailedFeed(
                    source_id=source.id,
                    source=source.name,
                    source_domain=source.domain,
                    source_url=source.homepage_url,
                    feed_url=feed_url,
                    failed_at=now,
                    reason="HTTP 503",
                ),
            )

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
    assert response.failed_feeds[0].source == "Source B"
    assert response.failed_feeds[0].reason == "HTTP 503"
    assert response.total == 1
    assert response.articles[0].id == "a-1"
    assert response.articles[0].source_url == "https://a.example"


@pytest.mark.asyncio
async def test_get_world_news_map_groups_articles_by_source_geography(monkeypatch):
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
            return FeedFetchResult(
                articles=[],
                failed=True,
                failed_feed=WorldNewsFailedFeed(
                    source_id=source.id,
                    source=source.name,
                    source_domain=source.domain,
                    source_url=source.homepage_url,
                    feed_url=feed_url,
                    failed_at=now,
                    reason="Request timed out",
                ),
            )

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
                )
            ]
        )

    monkeypatch.setattr(world_news_service, "WORLD_NEWS_SOURCES", sources)
    monkeypatch.setattr(world_news_service, "_fetch_feed", fake_fetch_feed)

    response = await get_world_news_map(region="vietnam", limit=10, freshness_hours=72)

    assert response.total_articles == 1
    assert response.source_count == 2
    assert response.failed_feed_count == 1
    assert response.failed_feeds[0].source == "Source B"
    assert len(response.buckets) == 1
    bucket = response.buckets[0]
    assert bucket.country_code == "VN"
    assert bucket.article_count == 1
    assert bucket.source_count == 2
    assert bucket.failed_feed_count == 1
    assert bucket.failed_feeds[0].reason == "Request timed out"
    assert bucket.top_category == "markets"
    assert bucket.top_sources == ["Source A", "Source B"]
    assert bucket.latest_headline == "VN-Index extends gains"
    assert bucket.latest_articles[0].source_url == "https://a.example"


@pytest.mark.asyncio
async def test_get_world_news_feed_bounds_fetch_concurrency(monkeypatch):
    sources = tuple(_source(f"source_{index}", f"https://{index}.example/rss") for index in range(3))
    active = 0
    peak = 0

    async def fake_fetch_feed(_client, _source_config, _feed_url):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return FeedFetchResult(articles=[])

    monkeypatch.setattr(world_news_service, "WORLD_NEWS_SOURCES", sources)
    monkeypatch.setattr(world_news_service, "_world_news_fetch_semaphore", asyncio.Semaphore(2))
    monkeypatch.setattr(world_news_service, "_fetch_feed", fake_fetch_feed)

    response = await get_world_news_feed()

    assert response.failed_feed_count == 0
    assert peak == 2


@pytest.mark.asyncio
async def test_get_world_news_feed_shares_fetch_limit_across_refreshes(monkeypatch):
    active = 0
    peak = 0
    release = asyncio.Event()
    sources = (_source("source", "https://source.example/rss"),)

    async def fake_fetch_feed(_client, _source_config, _feed_url):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await release.wait()
        active -= 1
        return FeedFetchResult(articles=[])

    monkeypatch.setattr(world_news_service, "WORLD_NEWS_SOURCES", sources)
    monkeypatch.setattr(world_news_service, "_world_news_fetch_semaphore", asyncio.Semaphore(1))
    monkeypatch.setattr(world_news_service, "_fetch_feed", fake_fetch_feed)

    first = asyncio.create_task(get_world_news_feed())
    await asyncio.sleep(0)
    second = asyncio.create_task(get_world_news_feed())
    await asyncio.sleep(0.01)
    assert peak == 1
    release.set()
    await asyncio.gather(first, second)


@pytest.mark.asyncio
async def test_get_world_news_feed_returns_partial_results_at_deadline(monkeypatch):
    sources = (_source("fast", "https://fast.example/rss"), _source("slow", "https://slow.example/rss"))

    async def fake_fetch_feed(_client, source, feed_url):
        if source.id == "slow":
            await asyncio.sleep(1)
            return FeedFetchResult(articles=[])
        return FeedFetchResult(
            articles=[
                WorldNewsArticle(
                    id="fast-article",
                    title="Fast feed result",
                    source_id=source.id,
                    source=source.name,
                    source_domain=source.domain,
                    source_url=source.homepage_url,
                    feed_url=feed_url,
                    url="https://fast.example/article",
                    published_at=datetime.now(UTC),
                    region=source.region,
                    category=source.category,
                    language=source.language,
                )
            ]
        )

    monkeypatch.setattr(world_news_service, "WORLD_NEWS_SOURCES", sources)
    monkeypatch.setattr(world_news_service, "WORLD_NEWS_REFRESH_DEADLINE_SECONDS", 0.01)
    monkeypatch.setattr(world_news_service, "_fetch_feed", fake_fetch_feed)

    response = await get_world_news_feed()

    assert response.total == 1
    assert response.articles[0].id == "fast-article"
    assert response.failed_feed_count == 1
    assert response.failed_feeds[0].source_id == "slow"
    assert response.failed_feeds[0].reason == "Refresh deadline exceeded"


@pytest.mark.asyncio
async def test_get_world_news_feed_deadline_does_not_wait_for_cleanup(monkeypatch):
    source = _source("slow", "https://slow.example/rss")
    entered = asyncio.Event()
    cleanup_started = asyncio.Event()
    release_cleanup = asyncio.Event()

    async def fake_fetch_feed(_client, _source_config, _feed_url):
        entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cleanup_started.set()
            await release_cleanup.wait()
            return FeedFetchResult(articles=[])

    async def fake_wait(tasks, *, timeout):
        await entered.wait()
        return set(), set(tasks)

    monkeypatch.setattr(world_news_service, "WORLD_NEWS_SOURCES", (source,))
    monkeypatch.setattr(world_news_service, "WORLD_NEWS_REFRESH_DEADLINE_SECONDS", 0.01)
    monkeypatch.setattr(world_news_service, "_fetch_feed", fake_fetch_feed)
    monkeypatch.setattr(world_news_service.asyncio, "wait", fake_wait)

    response = await asyncio.wait_for(get_world_news_feed(), timeout=0.5)

    assert response.failed_feeds[0].reason == "Refresh deadline exceeded"
    await asyncio.wait_for(cleanup_started.wait(), timeout=0.5)
    cleanup = next(iter(world_news_service._world_news_cleanup_tasks))
    assert not cleanup.done()
    release_cleanup.set()
    await asyncio.wait_for(cleanup, timeout=0.5)
    assert not world_news_service._world_news_cleanup_tasks


@pytest.mark.asyncio
async def test_get_world_news_feed_cancellation_cleans_up_tasks_and_client(monkeypatch):
    source = _source("blocked", "https://blocked.example/rss")
    entered = asyncio.Event()
    cancelled = asyncio.Event()
    feed_task = None

    class FakeClient:
        def __init__(self, **_kwargs):
            self.closed = asyncio.Event()

        async def aclose(self):
            self.closed.set()

    client = FakeClient()

    async def fake_fetch_feed(_client, _source_config, _feed_url):
        nonlocal feed_task
        feed_task = asyncio.current_task()
        entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(world_news_service, "WORLD_NEWS_SOURCES", (source,))
    monkeypatch.setattr(world_news_service.httpx, "AsyncClient", lambda **_kwargs: client)
    monkeypatch.setattr(world_news_service, "_fetch_feed", fake_fetch_feed)

    refresh = asyncio.create_task(get_world_news_feed())
    await asyncio.wait_for(entered.wait(), timeout=1)
    refresh.cancel()

    with pytest.raises(asyncio.CancelledError):
        await refresh

    assert feed_task is not None
    assert feed_task.cancelled()
    assert cancelled.is_set()
    assert client.closed.is_set()
    assert not world_news_service._world_news_cleanup_tasks


@pytest.mark.asyncio
async def test_fetch_feed_rejects_oversized_response_body(monkeypatch):
    source = _source("large", "https://large.example/rss")

    async def handler(request):
        return httpx.Response(200, content=b"x" * 9)

    monkeypatch.setattr(world_news_service, "WORLD_NEWS_MAX_RESPONSE_BYTES", 8)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await world_news_service._fetch_feed(client, source, source.feed_urls[0])

    assert result.failed is True
    assert result.failed_feed is not None
    assert result.failed_feed.reason == "Response body exceeds limit"
