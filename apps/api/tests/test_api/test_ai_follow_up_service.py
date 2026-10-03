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
        [{"id": "comparison_snapshot"}],
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
