from __future__ import annotations

from datetime import datetime

import pytest

from vnibb.api.v1 import news


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
