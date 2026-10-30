from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import BackgroundTasks

import pytest

from vnibb.api.v1 import news
from vnibb.core.market_cap import resolve_market_cap
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


def _certified_cap(value: float) -> dict:
    return {
        "market_cap": value,
        "market_cap_source": "issuer:capitalization",
        "market_cap_unit": "VND",
        "market_cap_currency": "VND",
        "market_cap_as_of": "2026-10-26",
        "outstanding_shares": 100,
        "shares_unit": "shares",
        "shares_as_of": "2026-10-26",
        "shares_source": "issuer:shares",
        "share_basis": "outstanding",
    }


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
        market_cap_provenance=resolve_market_cap(_certified_cap(market_cap), source="test"),
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
        return CacheResult(
            data=[SimpleNamespace(
                symbol="VCB", company_name="VCB Corp", exchange="HOSE",
                industry="Ngân hàng - Dịch vụ tài chính", price=100.0,
                volume=10_000.0, market_cap=1_000_000.0, pe=10.0, pb=1.0,
                extended_metrics={"change_1d": 4.5, **_certified_cap(1_000_000.0)},
            )],
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
@pytest.mark.parametrize("size_metric,expected_size", [("volume", 10_000.0), ("value_traded", 250_000.0)])
async def test_news_heatmap_cached_uncertified_cap_keeps_independent_size(
    client, monkeypatch, size_metric, expected_size
):
    class Cache:
        async def get_screener_data(self, **_kwargs):
            return CacheResult(data=[SimpleNamespace(
                symbol="VCB", company_name="VCB", exchange="HOSE", industry="Banking",
                price=100.0, volume=10_000.0, market_cap=9_000_000.0, pe=None, pb=None,
                extended_metrics={"change_1d": 4.5, "value_traded": 250_000.0},
            )], is_stale=False, cached_at=None, hit=True)

    monkeypatch.setattr(news, "CacheManager", Cache)
    response = await client.get("/api/v1/news/heatmap", params={"size_metric": size_metric})
    assert response.status_code == 200
    sector = response.json()["sectors"][0]
    stock = sector["stocks"][0]
    assert stock["market_cap"] is None
    assert stock["market_cap_provenance"]["status"] == "unavailable"
    assert any(item["value"] == 9_000_000.0 for item in stock["market_cap_provenance"]["observations"])
    assert stock["size_value"] == expected_size
    assert sector["total_market_cap"] is None
    assert sector["cap_count"] == 0
    assert sector["total_size_value"] == expected_size


@pytest.mark.asyncio
async def test_news_heatmap_provider_uncertified_cap_is_not_ranked_or_relabelled(client, monkeypatch):
    raw = _heatmap_row("HNXRAW", exchange="HNX", market_cap=9_000_000.0)
    raw.market_cap_provenance = None
    admitted = _heatmap_row("HNXOK", exchange="HNX", market_cap=100.0)

    async def fake_fetch(_params):
        return [raw, admitted]

    monkeypatch.setattr(news.VnstockScreenerFetcher, "fetch", fake_fetch)
    response = await client.get("/api/v1/news/heatmap", params={
        "group_by": "hnx30", "exchange": "ALL", "size_metric": "volume", "use_cache": False,
    })
    assert response.status_code == 200
    sector = response.json()["sectors"][0]
    assert [stock["symbol"] for stock in sector["stocks"]] == ["HNXOK"]
    assert sector["stocks"][0]["market_cap"] == 100.0
    assert sector["stocks"][0]["market_cap_provenance"]["status"] == "available"
    assert sector["stocks"][0]["size_value"] == 10_000.0
    assert sector["total_market_cap"] == 100.0
    assert sector["total_size_value"] == 10_000.0
    assert sector["cap_count"] == 1

    response = await client.get("/api/v1/news/heatmap", params={
        "exchange": "ALL", "size_metric": "market_cap", "use_cache": False,
    })
    assert response.status_code == 200
    assert [stock["symbol"] for sector in response.json()["sectors"] for stock in sector["stocks"]] == ["HNXOK"]


@pytest.mark.asyncio
async def test_news_heatmap_volume_weights_mixed_provider_caps(client, monkeypatch):
    certified = _heatmap_row("AAA", market_cap=100.0, change_1d=2.0)
    unknown = _heatmap_row("BBB", market_cap=900.0, change_1d=8.0)
    unknown.market_cap_provenance = None
    unknown.volume = 30_000.0

    async def fake_fetch(_params):
        return [certified, unknown]

    monkeypatch.setattr(news.VnstockScreenerFetcher, "fetch", fake_fetch)
    response = await client.get("/api/v1/news/heatmap", params={
        "size_metric": "volume", "use_cache": False,
    })
    assert response.status_code == 200
    sector = response.json()["sectors"][0]
    stocks = {stock["symbol"]: stock for stock in sector["stocks"]}
    assert stocks["AAA"]["market_cap"] == 100.0
    assert stocks["BBB"]["market_cap"] is None
    assert stocks["BBB"]["market_cap_provenance"]["status"] == "unavailable"
    assert stocks["BBB"]["size_value"] == 30_000.0
    assert sector["total_market_cap"] == 100.0
    assert sector["cap_count"] == 1
    assert sector["total_size_value"] == 40_000.0
    assert sector["avg_change_pct"] == 6.5


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["value_traded", "valueTraded", "trading_value"])
async def test_news_heatmap_provider_explicit_value_size_with_unknown_cap(client, monkeypatch, field):
    from vnibb.providers.vnstock.equity_screener import StockScreenerParams

    rows = news.VnstockScreenerFetcher.transform_data(StockScreenerParams(), [{
        "ticker": "VCB", "exchange": "HOSE", "price": 100.0,
        "volume": 10_000.0, "change_1d": 3.0, "market_cap": 900.0,
        field: 12_345.0,
    }])

    async def fake_fetch(_params):
        return rows

    monkeypatch.setattr(news.VnstockScreenerFetcher, "fetch", fake_fetch)
    response = await client.get("/api/v1/news/heatmap", params={
        "size_metric": "value_traded", "use_cache": False,
    })
    assert response.status_code == 200
    sector = response.json()["sectors"][0]
    stock = sector["stocks"][0]
    assert stock["market_cap"] is None
    assert stock["market_cap_provenance"]["status"] == "unavailable"
    assert stock["size_value"] == 12_345.0
    assert sector["total_market_cap"] is None
    assert sector["total_size_value"] == 12_345.0
    assert sector["cap_count"] == 0


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
async def test_trending_endpoint_reports_unavailable_under_news_prefix(client):

    response = await client.get("/api/v1/news/trending")

    assert response.status_code == 200
    assert response.json()["topics"] == []
    assert response.json()["available"] is False
    assert response.json()["reason"] == "trending_analysis_unavailable"


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


@pytest.mark.asyncio
async def test_empty_feed_schedules_rss_without_paid_news_availability(monkeypatch):
    feed = news.NewsFeed(articles=[], total=0)
    monkeypatch.setattr(news, "get_news_feed", AsyncMock(return_value=feed))
    monkeypatch.setattr(news.news_crawler, "_news_available", False)
    tasks = BackgroundTasks()

    result = await news.get_news_feed_api(
        tasks, source=None, sentiment=None, symbol=None, mode="all", limit=20, offset=0,
    )

    assert result is feed
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].func == news.news_crawler.crawl_market_news
    assert tasks.tasks[0].kwargs == {
        "sources": None, "limit": 20, "analyze_sentiment": True,
    }


@pytest.mark.asyncio
async def test_news_sources_reports_free_rss_available():
    payload = await news.get_sources()

    assert payload["available"] is True
    assert payload["sources"] == news.news_crawler.SOURCES
