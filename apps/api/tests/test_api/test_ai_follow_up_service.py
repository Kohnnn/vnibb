from __future__ import annotations

import pytest
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


@pytest.mark.parametrize(
    ("kinds", "expected_ids"),
    [
        (("financial_ratios",), {"peer_comparison"}),
        (("financial_ratios", "price_history"), {"valuation_range", "peer_comparison"}),
        (("income_statement", "financial_ratios"), {"margin_durability", "peer_comparison"}),
    ],
)
def test_sparse_ratios_context_requires_evidence_for_each_prompt(kinds, expected_ids):
    context = _symbol_context()
    context["source_catalog"] = [
        entry for entry in context["source_catalog"] if entry["kind"] in kinds
    ]

    follow_ups = build_follow_up_suggestions("Summarize VNM", context, [], limit=10)

    assert {entry["id"] for entry in follow_ups} == expected_ids
    for entry in follow_ups:
        if entry["id"] == "valuation_range":
            assert entry["sourceIds"] == ["VNM-PRICES", "VNM-RATIOS"]
        elif entry["id"] == "margin_durability":
            assert entry["sourceIds"] == ["VNM-INCOME", "VNM-RATIOS"]


MULTI_KIND_SCAFFOLDS = (
    ("valuation_range", "symbol", ("financial_ratios", "price_history"), None),
    ("margin_durability", "symbol", ("income_statement", "financial_ratios"), None),
    ("balance_sheet_risk", "symbol", ("balance_sheet", "cash_flow"), None),
    ("flow_persistence", "symbol", ("foreign_trading", "order_flow"), "foreign_flow_chart"),
    ("catalyst_risk", "symbol", ("company_events", "dividends"), None),
    (
        "market_breadth_read",
        "market",
        ("sector_breadth", "market_indices"),
        "sector_breadth_snapshot",
    ),
)


@pytest.mark.parametrize(
    ("scaffold_id", "scope", "required_kinds", "artifact_id"), MULTI_KIND_SCAFFOLDS
)
@pytest.mark.parametrize("missing_kind_index", [None, 0, 1])
def test_multi_kind_follow_ups_require_all_sources(
    scaffold_id, scope, required_kinds, artifact_id, missing_kind_index
):
    catalog = [
        {
            "id": f"SOURCE-{index}",
            "kind": kind,
            **({"symbol": "VNM"} if scope == "symbol" else {}),
        }
        for index, kind in enumerate(required_kinds)
        if index != missing_kind_index
    ]
    context = {
        "client_context": {"symbol": "VNM"} if scope == "symbol" else {},
        "source_catalog": catalog,
    }
    artifacts = (
        [{"id": artifact_id, "sourceIds": [entry["id"] for entry in catalog]}]
        if artifact_id
        else []
    )

    follow_ups = build_follow_up_suggestions(
        "What should I research next?", context, artifacts, limit=10
    )
    by_id = {entry["id"]: entry for entry in follow_ups}

    if missing_kind_index is None:
        assert scaffold_id in by_id
        assert by_id[scaffold_id]["sourceIds"] == ["SOURCE-0", "SOURCE-1"]
    else:
        assert scaffold_id not in by_id


@pytest.mark.parametrize(
    ("scaffold_id", "required_kinds"),
    [(scaffold[0], scaffold[2]) for scaffold in MULTI_KIND_SCAFFOLDS if scaffold[1] == "symbol"],
)
@pytest.mark.parametrize("missing_kind_index", [0, 1])
@pytest.mark.parametrize("other_symbol", ["HPG", None])
def test_missing_symbol_evidence_cannot_be_filled_by_other_or_unknown_symbols(
    scaffold_id, required_kinds, missing_kind_index, other_symbol
):
    catalog = [
        {
            "id": f"SOURCE-{index}",
            "kind": kind,
            "symbol": other_symbol if index == missing_kind_index else "VNM",
        }
        for index, kind in enumerate(required_kinds)
    ]
    context = {"client_context": {"symbol": "VNM"}, "source_catalog": catalog}

    follow_ups = build_follow_up_suggestions("Summarize VNM", context, [], limit=10)

    assert scaffold_id not in {entry["id"] for entry in follow_ups}
    target_source_id = f"SOURCE-{1 - missing_kind_index}"
    assert all(entry["sourceIds"] == [target_source_id] for entry in follow_ups)


@pytest.mark.parametrize(
    ("kind", "scaffold_id"),
    [
        ("financial_ratios", "peer_comparison"),
        ("company_news", "news_narrative_shift"),
        ("insider_deals", "insider_conviction"),
    ],
)
def test_single_kind_follow_ups_remain_answerable(kind, scaffold_id):
    context = {
        "client_context": {"symbol": "VNM"},
        "source_catalog": [{"id": "VNM-SOURCE", "kind": kind, "symbol": "VNM"}],
    }

    follow_ups = build_follow_up_suggestions("Summarize VNM", context, [])

    assert [entry["id"] for entry in follow_ups] == [scaffold_id]
    assert follow_ups[0]["sourceIds"] == ["VNM-SOURCE"]


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
    assert [entry["id"] for entry in first] == ["peer_comparison"]
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
            {"id": "MKT-INDICES", "kind": "market_indices"},
        ],
    }
    follow_ups = build_follow_up_suggestions(
        "Summarize VNM",
        context,
        [{"id": "sector_breadth_snapshot", "sourceIds": ["MKT-SECTORS"]}],
    )
    assert follow_ups[0]["id"] == "market_breadth_read"
    assert follow_ups[0]["sourceIds"] == ["MKT-INDICES", "MKT-SECTORS"]


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


@pytest.mark.parametrize("source_id", [None, "", "   "])
def test_required_evidence_without_citable_id_cannot_back_follow_up(source_id):
    context = {
        "client_context": {"symbol": "VNM"},
        "source_catalog": [
            {"id": "VNM-RATIOS", "kind": "financial_ratios", "symbol": "VNM"},
            {"id": source_id, "kind": "price_history", "symbol": "VNM"},
        ],
    }
    suggestions = build_follow_up_suggestions("Summarize VNM", context, [], limit=10)
    assert [entry["id"] for entry in suggestions] == ["peer_comparison"]
    assert suggestions[0]["sourceIds"] == ["VNM-RATIOS"]


def test_follow_up_citations_are_normalized_and_unique():
    context = {
        "client_context": {"symbol": "VNM"},
        "source_catalog": [
            {"id": " VNM-RATIOS ", "kind": "financial_ratios", "symbol": "VNM"},
            {"id": "VNM-RATIOS", "kind": "financial_ratios", "symbol": "VNM"},
            {"id": " VNM-PRICES ", "kind": "price_history", "symbol": "VNM"},
        ],
    }
    suggestions = build_follow_up_suggestions("Summarize VNM", context, [], limit=10)
    valuation = next(entry for entry in suggestions if entry["id"] == "valuation_range")
    assert valuation["sourceIds"] == ["VNM-PRICES", "VNM-RATIOS"]
