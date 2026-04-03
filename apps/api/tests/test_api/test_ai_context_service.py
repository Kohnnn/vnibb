from __future__ import annotations

from types import SimpleNamespace

import pytest

from vnibb.services.ai_context_service import (
    AIContextService,
    _build_dividends_context,
    _build_flow_context,
)


@pytest.mark.asyncio
async def test_build_runtime_context_includes_broad_market_and_symbol_context(monkeypatch):
    service = AIContextService()
    captured_symbols: list[str] = []

    async def fake_build_market_snapshot(*, prefer_appwrite_data: bool):
        assert prefer_appwrite_data is True
        return {
            "source": "appwrite",
            "indices": [{"index_code": "VNINDEX", "change_pct": 0.8}],
            "sectors": {"breadth": {"advance_count": 140, "decline_count": 95}},
        }

    async def fake_build_symbol_snapshot(symbol: str, *, prefer_appwrite_data: bool):
        assert prefer_appwrite_data is True
        captured_symbols.append(symbol)
        return {
            "symbol": symbol,
            "source": "appwrite",
            "company": {"symbol": symbol},
            "recent_news": {"latest_articles": [{"title": f"{symbol} headline"}]},
        }

    monkeypatch.setattr(service, "_build_market_snapshot", fake_build_market_snapshot)
    monkeypatch.setattr(service, "_build_symbol_snapshot", fake_build_symbol_snapshot)

    context = await service.build_runtime_context(
        message="Compare VNM and FPT",
        history=[{"role": "user", "content": "Review VNM versus FPT"}],
        client_context={"symbol": "VCB", "widgetPayload": {"api_key": "filtered", "note": "ok"}},
        prefer_appwrite_data=True,
    )

    assert captured_symbols == ["VCB", "VNM", "FPT"]
    assert context["broad_market_context"] == {
        "source": "appwrite",
        "indices": [{"index_code": "VNINDEX", "change_pct": 0.8}],
        "sectors": {"breadth": {"advance_count": 140, "decline_count": 95}},
        "available_source_ids": ["MKT-INDICES", "MKT-SECTORS"],
    }
    assert [item["symbol"] for item in context["market_context"]] == ["VCB", "VNM", "FPT"]
    assert context["market_context"][0]["available_source_ids"] == ["VCB-PROFILE", "VCB-NEWS"]
    assert [item["id"] for item in context["source_catalog"]] == [
        "MKT-INDICES",
        "MKT-SECTORS",
        "VCB-PROFILE",
        "VCB-NEWS",
        "VNM-PROFILE",
        "VNM-NEWS",
        "FPT-PROFILE",
        "FPT-NEWS",
    ]
    assert context["retrieval_policy"]["source_precedence"] == [
        "appwrite",
        "postgres",
        "browser_context",
    ]
    assert "api_key" not in context["client_context"]["widgetPayload"]


def test_merge_snapshots_fills_recent_news_from_fallback():
    service = AIContextService()

    merged = service._merge_snapshots(
        {
            "symbol": "VNM",
            "source": "appwrite",
            "company": {"symbol": "VNM"},
            "recent_news": None,
            "foreign_trading": None,
            "dividends": None,
        },
        {
            "symbol": "VNM",
            "source": "postgres",
            "recent_news": {"latest_articles": [{"title": "Fallback article"}]},
            "foreign_trading": {"summary": {"net_value_5d": 120.0}},
            "dividends": {"recent_dividends": [{"dividend_value": 1500.0}]},
        },
    )

    assert merged["source"] == "appwrite"
    assert merged["recent_news"] == {"latest_articles": [{"title": "Fallback article"}]}
    assert merged["foreign_trading"] == {"summary": {"net_value_5d": 120.0}}
    assert merged["dividends"] == {"recent_dividends": [{"dividend_value": 1500.0}]}


def test_build_flow_context_summarizes_recent_sessions():
    context = _build_flow_context(
        [
            {"trade_date": "2026-04-01", "net_value": 10, "net_volume": 100},
            {"trade_date": "2026-04-02", "net_value": -5, "net_volume": -30},
            {"trade_date": "2026-04-03", "net_value": 8, "net_volume": 50},
        ]
    )

    assert context is not None
    assert context["latest_session"]["trade_date"] == "2026-04-03"
    assert context["summary"]["net_value_5d"] == 13.0
    assert context["summary"]["positive_sessions_20d"] == 2
    assert context["summary"]["negative_sessions_20d"] == 1


def test_build_dividends_context_keeps_recent_items_and_summary():
    context = _build_dividends_context(
        [
            {"exercise_date": "2026-03-20", "dividend_value": 1200, "issue_method": "cash"},
            {"exercise_date": "2025-09-20", "dividend_value": 800, "issue_method": "cash"},
        ]
    )

    assert context is not None
    assert context["summary"]["cash_dividend_total_recent"] == 2000.0
    assert context["summary"]["latest_issue_method"] == "cash"


@pytest.mark.asyncio
async def test_build_runtime_context_expands_single_symbol_with_peers_for_compare_prompts(
    monkeypatch,
):
    service = AIContextService()
    captured_symbols: list[str] = []

    async def fake_build_market_snapshot(*, prefer_appwrite_data: bool):
        return None

    async def fake_build_symbol_snapshot(symbol: str, *, prefer_appwrite_data: bool):
        captured_symbols.append(symbol)
        return {"symbol": symbol, "source": "appwrite", "company": {"symbol": symbol}}

    async def fake_get_peers(symbol: str, limit: int = 2):
        assert symbol == "VNM"
        assert limit == 2
        return SimpleNamespace(peers=[SimpleNamespace(symbol="FPT"), SimpleNamespace(symbol="MWG")])

    monkeypatch.setattr(service, "_build_market_snapshot", fake_build_market_snapshot)
    monkeypatch.setattr(service, "_build_symbol_snapshot", fake_build_symbol_snapshot)
    monkeypatch.setattr(
        "vnibb.services.ai_context_service.comparison_service.get_peers",
        fake_get_peers,
    )

    context = await service.build_runtime_context(
        message="Compare VNM with peers",
        history=[],
        client_context={"symbol": "VNM"},
        prefer_appwrite_data=True,
    )

    assert captured_symbols == ["VNM", "FPT", "MWG"]
    assert [item["symbol"] for item in context["market_context"]] == ["VNM", "FPT", "MWG"]
