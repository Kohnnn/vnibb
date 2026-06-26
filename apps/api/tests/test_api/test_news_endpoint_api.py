from __future__ import annotations

from datetime import UTC, datetime

import pytest

from vnibb.api.v1 import news
from vnibb.providers.vnstock.equity_screener import ScreenerData
from vnibb.services.cache_manager import CacheResult
from vnibb.services.world_news_service import (
    WorldNewsArticle,
    WorldNewsFeedResponse,
    WorldNewsMapBucket,
    WorldNewsMapResponse,
    WorldNewsSourceInfo,
    WorldNewsSourcesResponse,
)


class _EmptyHeatmapCache:
    async def get_screener_data(self, **_kwargs):
        return None


def _heatmap_row(
    symbol: str,
    *,
    exchange: str = "HOSE",
    industry: str = "Ngân hàng - Dịch vụ tài chính",
    price: float = 100.0,
    change_1d: float | None = 1.25,
    market_cap: float = 1_000_000.0,
) -> ScreenerData:
    return ScreenerData(
        symbol=symbol,
        organ_name=f"{symbol} Corp",
        exchange=exchange,
        industry_name=industry,
        price=price,
        change_1d=change_1d,
        volume=10_000.0,
        market_cap=market_cap,
    )


@pytest.mark.asyncio
async def test_news_heatmap_endpoint_uses_real_change_pct_from_screener(client, monkeypatch):
    async def fake_fetch(_params):
        return [_heatmap_row("VCB", change_1d=3.2)]

    monkeypatch.setattr(news, "CacheManager", _EmptyHeatmapCache)
    monkeypatch.setattr(news.VnstockScreenerFetcher, "fetch", fake_fetch)

    response = await client.get(
        "/api/v1/news/heatmap",
        params={"group_by": "sector", "exchange": "HOSE", "use_cache": False},
    )

    assert response.status_code == 200
    payload = response.json()
    stock = payload["sectors"][0]["stocks"][0]
    assert stock["symbol"] == "VCB"
    assert stock["change_pct"] == 3.2
    assert stock["change"] == 3.2


@pytest.mark.asyncio
async def test_news_heatmap_endpoint_filters_vn30_constituents(client, monkeypatch):
    async def fake_fetch(_params):
        return [
            _heatmap_row("VCB", market_cap=2_000_000.0),
            _heatmap_row("AAA", market_cap=1_000_000.0),
        ]

    monkeypatch.setattr(news, "CacheManager", _EmptyHeatmapCache)
    monkeypatch.setattr(news.VnstockScreenerFetcher, "fetch", fake_fetch)

    response = await client.get(
        "/api/v1/news/heatmap",
        params={"group_by": "vn30", "exchange": "ALL", "use_cache": False},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["group_by"] == "vn30"
    assert payload["count"] == 1
    assert payload["sectors"][0]["sector"] == "VN30"
    assert [stock["symbol"] for stock in payload["sectors"][0]["stocks"]] == ["VCB"]


@pytest.mark.asyncio
async def test_news_heatmap_endpoint_filters_hnx30_by_top_hnx_market_cap(client, monkeypatch):
    async def fake_fetch(_params):
        hnx_rows = [
            _heatmap_row(f"HNX{i:02d}", exchange="HNX", market_cap=float(100 - i))
            for i in range(31)
        ]
        return [*hnx_rows, _heatmap_row("VCB", exchange="HOSE", market_cap=1_000_000.0)]

    monkeypatch.setattr(news, "CacheManager", _EmptyHeatmapCache)
    monkeypatch.setattr(news.VnstockScreenerFetcher, "fetch", fake_fetch)

    response = await client.get(
        "/api/v1/news/heatmap",
        params={"group_by": "hnx30", "exchange": "ALL", "use_cache": False, "limit": 100},
    )

    assert response.status_code == 200
    payload = response.json()
    symbols = [stock["symbol"] for stock in payload["sectors"][0]["stocks"]]
    assert payload["group_by"] == "hnx30"
    assert payload["count"] == 30
    assert payload["sectors"][0]["sector"] == "HNX30"
    assert "HNX00" in symbols
    assert "HNX29" in symbols
    assert "HNX30" not in symbols
    assert "VCB" not in symbols


@pytest.mark.asyncio
async def test_news_heatmap_endpoint_returns_empty_without_real_change_data(client, monkeypatch):
    async def fake_fetch(_params):
        return [_heatmap_row("VCB", change_1d=None)]

    monkeypatch.setattr(news, "CacheManager", _EmptyHeatmapCache)
    monkeypatch.setattr(news.VnstockScreenerFetcher, "fetch", fake_fetch)

    response = await client.get(
        "/api/v1/news/heatmap",
        params={"group_by": "sector", "exchange": "HOSE", "use_cache": False},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 0
    assert payload["sectors"] == []


class _FakeHeatmapCache:
    def __init__(self):
        pass

    async def get_screener_data(self, **_kwargs):
        class _FakeSnapshot:
            symbol = "VCB"
            company_name = "VCB Corp"
            exchange = "HOSE"
            industry = "Ngân hàng - Dịch vụ tài chính"
            price = 100.0
            volume = 10_000.0
            market_cap = 1_000_000.0
            pe = 10.0
            pb = 1.0
            extended_metrics = {"change_1d": 4.5}

        return CacheResult(
            data=[_FakeSnapshot()],
            is_stale=False,
            cached_at=None,
            hit=True,
        )


@pytest.mark.asyncio
async def test_news_heatmap_endpoint_uses_cached_change_pct_from_extended_metrics(client, monkeypatch):
    monkeypatch.setattr(news, "CacheManager", _FakeHeatmapCache)

    response = await client.get(
        "/api/v1/news/heatmap",
        params={"group_by": "sector", "exchange": "HOSE"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["cached"] is True
    assert payload["count"] == 1
    stock = payload["sectors"][0]["stocks"][0]
    assert stock["symbol"] == "VCB"
    assert stock["change_pct"] == 4.5
    assert stock["change"] == 4.5


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
