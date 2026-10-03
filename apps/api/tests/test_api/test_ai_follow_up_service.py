from __future__ import annotations

from vnibb.services.ai_action_service import build_follow_up_suggestions


def _symbol_context(symbol: str = "VNM", *, active_tab: str = "", **kinds: bool) -> dict:
    catalog = [
        {"id": f"{symbol}-{code}", "kind": kind, "symbol": symbol}
        for code, kind in (
            ("PROFILE", "company_profile"),
            ("PRICES", "price_history"),
            ("RATIOS", "financial_ratios"),
            ("INCOME", "income_statement"),
            ("BALANCE", "balance_sheet"),
            ("CASHFLOW", "cash_flow"),
            ("NEWS", "company_news"),
            ("FOREIGN", "foreign_trading"),
            ("ORDERFLOW", "order_flow"),
            ("INSIDERS", "insider_deals"),
            ("EVENTS", "company_events"),
            ("DIVIDENDS", "dividends"),
        )
        if kinds.get(kind, True)
    ]
    return {
        "client_context": {"symbol": symbol, "activeTab": active_tab},
        "source_catalog": catalog,
    }


def test_follow_ups_are_deterministic_and_bounded():
    context = _symbol_context()
    first = build_follow_up_suggestions("Summarize VNM", context, [])
    second = build_follow_up_suggestions("Summarize VNM", context, [])
    assert first == second
    assert len(first) <= 3


def test_follow_ups_only_use_sources_present_in_context():
    context = _symbol_context(company_news=False, insider_deals=False)
    follow_ups = build_follow_up_suggestions("Summarize VNM", context, [])
    ids = {entry["id"] for entry in follow_ups}
    assert "news_narrative_shift" not in ids
    assert "insider_conviction" not in ids


def test_follow_ups_are_empty_without_grounding():
    assert build_follow_up_suggestions("What is going on?", {"source_catalog": []}, []) == []


def test_follow_ups_substitute_the_active_symbol():
    follow_ups = build_follow_up_suggestions("Summarize HPG", _symbol_context("HPG"), [])
    assert follow_ups
    for entry in follow_ups:
        assert "HPG" in entry["prompt"]
        assert "{symbol}" not in entry["prompt"]


def test_follow_up_backed_by_artifact_outranks_a_plain_one():
    context = _symbol_context(active_tab="")
    follow_ups = build_follow_up_suggestions(
        "Summarize VNM",
        context,
        [{"id": "comparison_snapshot", "sourceIds": ["VNM-RATIOS"]}],
    )
    assert follow_ups
    assert follow_ups[0]["id"] == "peer_comparison"
    assert follow_ups[0]["sourceIds"] == ["VNM-RATIOS"]





def test_market_follow_up_requires_no_symbol():
    context = {
        "client_context": {},
        "source_catalog": [
            {"id": "MKT-SECTORS", "kind": "sector_breadth"},
            {"id": "MKT-INDICES", "kind": "market_indices"},
        ],
    }
    follow_ups = build_follow_up_suggestions("How is the market?", context, [])
    assert [entry["id"] for entry in follow_ups] == ["market_breadth_read"]


def test_symbol_follow_ups_are_suppressed_without_a_symbol():
    context = {
        "client_context": {},
        "source_catalog": [{"id": "X-RATIOS", "kind": "financial_ratios"}],
    }
    assert build_follow_up_suggestions("Any thoughts?", context, []) == []


def test_symbol_follow_ups_reject_other_symbol_sources():
    context = {
        "client_context": {"symbol": "VNM"},
        "source_catalog": [
            {"id": "HPG-RATIOS", "kind": "financial_ratios", "symbol": "HPG"},
        ],
    }
    assert build_follow_up_suggestions("Summarize VNM", context, []) == []


def test_sparse_multi_symbol_follow_ups_only_use_target_symbol_sources():
    context = {
        "client_context": {"symbol": " vnm ", "activeTab": "fundamentals"},
        "source_catalog": [
            {"id": "HPG-RATIOS", "kind": "financial_ratios", "symbol": "HPG"},
            {"id": "HPG-PRICES", "kind": "price_history", "symbol": "HPG"},
            {"id": "HPG-NEWS", "kind": "company_news", "symbol": "HPG"},
            {"id": "VNM-RATIOS", "kind": "financial_ratios", "symbol": " vnm "},
        ],
    }
    first = build_follow_up_suggestions("Summarize VNM", context, [], limit=10)
    second = build_follow_up_suggestions("Summarize VNM", context, [], limit=10)

    assert first == second
    assert [entry["id"] for entry in first] == [
        "margin_durability",
        "peer_comparison",
        "valuation_range",
    ]
    assert all("VNM" in entry["prompt"] for entry in first)
    assert all(entry["sourceIds"] == ["VNM-RATIOS"] for entry in first)


def test_market_follow_up_preserves_market_sources_in_multi_symbol_context():
    context = {
        "client_context": {"symbol": "VNM"},
        "source_catalog": [
            {"id": "HPG-RATIOS", "kind": "financial_ratios", "symbol": "HPG"},
            {"id": "MKT-SECTORS", "kind": "sector_breadth"},
            {"id": "MKT-INDICES", "kind": "market_indices"},
        ],
    }
    follow_ups = build_follow_up_suggestions("Summarize VNM", context, [])

    assert [entry["id"] for entry in follow_ups] == ["market_breadth_read"]
    assert follow_ups[0]["sourceIds"] == ["MKT-INDICES", "MKT-SECTORS"]


def test_symbol_follow_ups_reject_unknown_symbol_evidence():
    context = {
        "client_context": {"symbol": "VNM"},
        "source_catalog": [
            {"id": "X-RATIOS", "kind": "financial_ratios"},
            {"id": "VNM-RATIOS", "kind": "financial_ratios"},
        ],
    }
    assert build_follow_up_suggestions("Summarize VNM", context, []) == []


def test_other_symbol_or_unknown_artifacts_do_not_boost_symbol_follow_ups():
    context = {
        "client_context": {"symbol": "VNM", "activeTab": "news"},
        "source_catalog": [
            {"id": "VNM-RATIOS", "kind": "financial_ratios", "symbol": "VNM"},
            {"id": "VNM-NEWS", "kind": "company_news", "symbol": "VNM"},
            {"id": "HPG-RATIOS", "kind": "financial_ratios", "symbol": "HPG"},
        ],
    }
    for artifact in (
        {"id": "comparison_snapshot", "sourceIds": ["HPG-RATIOS"]},
        {"id": "comparison_snapshot"},
    ):
        follow_ups = build_follow_up_suggestions("Summarize VNM", context, [artifact])
        assert follow_ups[0]["id"] == "news_narrative_shift"

    follow_ups = build_follow_up_suggestions(
        "Summarize VNM",
        context,
        [{"id": "comparison_snapshot", "sourceIds": ["HPG-RATIOS", "VNM-RATIOS"]}],
    )
    assert follow_ups[0]["id"] == "peer_comparison"
    assert follow_ups[0]["sourceIds"] == ["VNM-RATIOS"]


def test_market_artifact_ranking_is_preserved_with_symbol_follow_ups():
    context = {
        "client_context": {"symbol": "VNM"},
        "source_catalog": [
            {"id": "VNM-RATIOS", "kind": "financial_ratios", "symbol": "VNM"},
            {"id": "MKT-SECTORS", "kind": "sector_breadth"},
        ],
    }
    follow_ups = build_follow_up_suggestions(
        "Summarize VNM",
        context,
        [{"id": "sector_breadth_snapshot", "sourceIds": ["MKT-SECTORS"]}],
    )
    assert follow_ups[0]["id"] == "market_breadth_read"
    assert follow_ups[0]["sourceIds"] == ["MKT-SECTORS"]


def test_catalog_symbol_fallback_preserves_symbol_grounding():
    context = {
        "client_context": {},
        "source_catalog": [
            {"id": "MKT-SECTORS", "kind": "sector_breadth"},
            {"id": "VNM-RATIOS", "kind": "financial_ratios", "symbol": " vnm "},
            {"id": "HPG-RATIOS", "kind": "financial_ratios", "symbol": "HPG"},
        ],
    }
    follow_ups = build_follow_up_suggestions("Any thoughts?", context, [])

    assert follow_ups
    assert all("VNM" in entry["prompt"] for entry in follow_ups)
    assert all(entry["sourceIds"] == ["VNM-RATIOS"] for entry in follow_ups)
