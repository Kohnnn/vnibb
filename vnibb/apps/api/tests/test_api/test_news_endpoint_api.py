from __future__ import annotations

from datetime import UTC, datetime

import pytest

from vnibb.api.v1 import news
from vnibb.services.world_news_service import (
    WorldNewsArticle,
    WorldNewsFeedResponse,
    WorldNewsMapBucket,
    WorldNewsMapResponse,
    WorldNewsSourceInfo,
    WorldNewsSourcesResponse,
)


@pytest.mark.asyncio
async def test_news_feed_endpoint_returns_related_mode_payload(client, monkeypatch):
    async def fake_ranked_rows(**kwargs):
        assert kwargs["symbol"] == "VCI"
        assert kwargs["mode"] == "related"
        return (
            [
                {
                    "id": 1,
                    "title": "VCI leads brokerage rally",
                    "summary": "VCI and SSI outperform the market.",
                    "source": "cafef",
                    "published_date": datetime(2026, 3, 22, 9, 0),
                    "url": "https://example.com/vci-rally",
                    "related_symbols": ["VCI", "SSI"],
                    "matched_symbols": ["VCI", "SSI"],
                    "relevance_score": 0.97,
                    "match_reason": "exact_symbol_title",
                    "is_market_wide_fallback": False,
                }
            ],
            False,
        )

    monkeypatch.setattr(news, "get_ranked_news_rows", fake_ranked_rows)

    response = await client.get(
        "/api/v1/news/feed", params={"symbol": "VCI", "mode": "related", "limit": 10}
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "related"
    assert payload["fallback_used"] is False
    assert payload["articles"][0]["matched_symbols"] == ["VCI", "SSI"]
    assert payload["articles"][0]["relevance_score"] == 0.97


@pytest.mark.asyncio
async def test_news_feed_endpoint_marks_market_wide_fallback(client, monkeypatch):
    async def fake_ranked_rows(**_kwargs):
        return (
            [
                {
                    "id": 2,
                    "title": "Market closes higher",
                    "summary": "Broad-based buying returns.",
                    "source": "vnexpress",
                    "published_date": datetime(2026, 3, 22, 10, 0),
                    "url": "https://example.com/market-higher",
                    "related_symbols": [],
                    "matched_symbols": [],
                    "relevance_score": 0.0,
                    "match_reason": None,
                    "is_market_wide_fallback": True,
                }
            ],
            True,
        )

    monkeypatch.setattr(news, "get_ranked_news_rows", fake_ranked_rows)

    response = await client.get(
        "/api/v1/news/feed", params={"symbol": "VNM", "mode": "related", "limit": 10}
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["fallback_used"] is True
    assert payload["articles"][0]["is_market_wide_fallback"] is True


@pytest.mark.asyncio
async def test_world_news_endpoint_returns_live_source_links(client, monkeypatch):
    async def fake_world_news_feed(**kwargs):
        assert kwargs["region"] == "vietnam"
        assert kwargs["category"] == "markets"
        return WorldNewsFeedResponse(
            articles=[
                WorldNewsArticle(
                    id="cafef-1",
                    title="VN-Index extends gains",
                    source_id="cafef_markets",
                    source="CafeF Markets",
                    source_domain="cafef.vn",
                    source_url="https://cafef.vn/thi-truong-chung-khoan.chn",
                    feed_url="https://cafef.vn/thi-truong-chung-khoan.rss",
                    url="https://cafef.vn/story",
                    published_at=datetime(2026, 5, 1, 9, 0, tzinfo=UTC),
                    region="vietnam",
                    category="markets",
                    language="vi",
                    tags=["markets", "vietnam"],
                    relevance_score=0.91,
                )
            ],
            total=1,
            fetched_at=datetime(2026, 5, 1, 9, 1, tzinfo=UTC),
            source_count=1,
            feed_count=1,
            failed_feed_count=0,
            region="vietnam",
            category="markets",
            language=None,
            source=None,
            freshness_hours=72,
        )

    monkeypatch.setattr(news, "get_world_news_feed", fake_world_news_feed)

    response = await client.get(
        "/api/v1/news/world",
        params={"region": "vietnam", "category": "markets", "limit": 20},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["articles"][0]["source_url"] == "https://cafef.vn/thi-truong-chung-khoan.chn"
    assert payload["articles"][0]["feed_url"] == "https://cafef.vn/thi-truong-chung-khoan.rss"
    assert payload["articles"][0]["url"] == "https://cafef.vn/story"


@pytest.mark.asyncio
async def test_world_news_map_endpoint_returns_source_geography(client, monkeypatch):
    async def fake_world_news_map(**kwargs):
        assert kwargs["region"] == "vietnam"
        assert kwargs["category"] == "markets"
        return WorldNewsMapResponse(
            buckets=[
                WorldNewsMapBucket(
                    id="vn",
                    label="Vietnam",
                    region="Vietnam",
                    country_code="VN",
                    country_name="Vietnam",
                    latitude=16.0544,
                    longitude=108.2022,
                    article_count=1,
                    source_count=1,
                    top_category="markets",
                    top_sources=["CafeF Markets"],
                    latest_headline="VN-Index extends gains",
                    latest_published_at=datetime(2026, 5, 1, 9, 0, tzinfo=UTC),
                    latest_articles=[
                        WorldNewsArticle(
                            id="cafef-1",
                            title="VN-Index extends gains",
                            source_id="cafef_markets",
                            source="CafeF Markets",
                            source_domain="cafef.vn",
                            source_url="https://cafef.vn/thi-truong-chung-khoan.chn",
                            feed_url="https://cafef.vn/thi-truong-chung-khoan.rss",
                            url="https://cafef.vn/story",
                            published_at=datetime(2026, 5, 1, 9, 0, tzinfo=UTC),
                            region="vietnam",
                            category="markets",
                            language="vi",
                            tags=["markets", "vietnam"],
                            relevance_score=0.91,
                        )
                    ],
                )
            ],
            total_articles=1,
            source_count=1,
            feed_count=1,
            failed_feed_count=0,
            fetched_at=datetime(2026, 5, 1, 9, 1, tzinfo=UTC),
            region="vietnam",
            category="markets",
            language=None,
            freshness_hours=72,
        )

    monkeypatch.setattr(news, "get_world_news_map", fake_world_news_map)

    response = await client.get(
        "/api/v1/news/world/map",
        params={"region": "vietnam", "category": "markets", "limit": 20},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["buckets"][0]["country_code"] == "VN"
    assert payload["buckets"][0]["latest_articles"][0]["url"] == "https://cafef.vn/story"


@pytest.mark.asyncio
async def test_world_news_sources_endpoint_returns_registry(client, monkeypatch):
    def fake_sources(**kwargs):
        assert kwargs["region"] == "vietnam"
        return WorldNewsSourcesResponse(
            sources=[
                WorldNewsSourceInfo(
                    id="cafef_markets",
                    name="CafeF Markets",
                    domain="cafef.vn",
                    region="vietnam",
                    category="markets",
                    language="vi",
                    tier=1,
                    homepage_url="https://cafef.vn/thi-truong-chung-khoan.chn",
                    feed_urls=["https://cafef.vn/thi-truong-chung-khoan.rss"],
                    country_code="VN",
                    country_name="Vietnam",
                    latitude=21.0285,
                    longitude=105.8542,
                    map_region="Vietnam",
                )
            ],
            total=1,
        )

    monkeypatch.setattr(news, "list_world_news_sources", fake_sources)

    response = await client.get("/api/v1/news/world/sources", params={"region": "vietnam"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["sources"][0]["id"] == "cafef_markets"
    assert payload["sources"][0]["feed_urls"] == ["https://cafef.vn/thi-truong-chung-khoan.rss"]
