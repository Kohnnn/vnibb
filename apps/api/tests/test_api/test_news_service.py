from datetime import datetime
from types import SimpleNamespace

import pytest

from vnibb.services.news_service import get_news_flow


@pytest.mark.asyncio
async def test_get_news_flow_uses_primary_crawler_rows(monkeypatch):
    async def fake_latest_news(*, symbol, sentiment, limit, offset):
        assert symbol == "VNM"
        assert sentiment == "neutral"
        assert limit == 5
        assert offset == 0
        return [
            {
                "id": "row-1",
                "title": "Vinamilk update",
                "summary": "Earnings call highlights",
                "source": "cafef",
                "published_date": datetime(2026, 2, 14, 8, 30),
                "url": "https://example.com/vnm",
                "related_symbols": "VNM, fpt",
                "sentiment": "neutral",
            }
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )

    response = await get_news_flow(symbols=["vnm"], sentiment="neutral", limit=5, offset=0)

    assert response.total == 1
    assert response.has_more is False
    assert response.items[0].id == "row-1"
    assert response.items[0].symbols == ["VNM", "FPT"]


@pytest.mark.asyncio
async def test_get_news_flow_returns_empty_when_primary_and_fallback_fail(monkeypatch):
    async def fake_latest_news(*, symbol, sentiment, limit, offset):
        raise RuntimeError("crawler unavailable")

    async def fake_company_news(_query):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch",
        fake_company_news,
    )

    response = await get_news_flow(symbols=["VNM"], limit=3)

    assert response.total == 0
    assert response.items == []
    assert response.has_more is False


@pytest.mark.asyncio
async def test_get_news_flow_hydrates_from_company_news_when_primary_empty(monkeypatch):
    async def fake_latest_news(*, symbol, sentiment, limit, offset):
        return []

    async def fake_company_news(_query):
        return [
            SimpleNamespace(
                title="FPT signs major AI partnership",
                summary="Enterprise expansion",
                source=None,
                published_at=datetime(2026, 2, 14, 10, 0),
                url="https://example.com/fpt-news",
            )
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )
    monkeypatch.setattr(
        "vnibb.services.news_service.VnstockCompanyNewsFetcher.fetch",
        fake_company_news,
    )

    response = await get_news_flow(symbols=["fpt"], limit=2)

    assert response.total == 1
    assert response.items[0].title == "FPT signs major AI partnership"
    assert response.items[0].source == "vnstock"
    assert response.items[0].symbols == ["FPT"]
    assert response.has_more is False


@pytest.mark.asyncio
async def test_get_news_flow_marks_has_more_when_total_matches_limit(monkeypatch):
    async def fake_latest_news(*, symbol, sentiment, limit, offset):
        return [
            {
                "id": f"id-{index}",
                "title": f"Story {index}",
                "source": "vnexpress",
                "published_date": "2026-02-14T09:00:00",
                "url": f"https://example.com/news-{index}",
                "related_symbols": ["VCB"],
                "sentiment": "positive",
            }
            for index in range(limit)
        ]

    monkeypatch.setattr(
        "vnibb.services.news_service.news_crawler.get_latest_news",
        fake_latest_news,
    )

    response = await get_news_flow(symbols=["VCB"], limit=2)

    assert response.total == 2
    assert response.has_more is True
