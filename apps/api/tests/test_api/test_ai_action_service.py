from __future__ import annotations

from vnibb.services.ai_action_service import build_action_suggestions


def test_build_action_suggestions_returns_compare_and_chart_actions():
    actions = build_action_suggestions(
        "Compare VNM and FPT with a trend view",
        {
            "client_context": {"symbol": "VNM"},
        },
        [
            {"id": "comparison_snapshot", "sourceIds": ["VNM-RATIOS", "FPT-RATIOS"]},
            {"id": "comparison_quality_chart", "sourceIds": ["VNM-RATIOS", "FPT-RATIOS"]},
            {"id": "price_trend_chart", "sourceIds": ["VNM-PRICES", "FPT-PRICES"]},
        ],
    )

    action_ids = [action["id"] for action in actions]
    assert "add_widget_comparison_analysis" in action_ids
    assert "add_widget_price_chart" in action_ids


def test_build_action_suggestions_returns_symbol_switch_for_single_other_symbol():
    actions = build_action_suggestions(
        "Show me HPG instead",
        {"client_context": {"symbol": "VNM"}},
        [],
    )

    assert actions == [
        {
            "id": "switch_symbol_hpg",
            "type": "set_global_symbol",
            "label": "Switch to HPG",
            "description": "Set the linked dashboard ticker to HPG.",
            "confirmText": "Switch the linked dashboard symbol to HPG?",
            "payload": {"symbol": "HPG"},
        }
    ]


def test_build_action_suggestions_returns_sector_and_foreign_actions():
    actions = build_action_suggestions(
        "Show sector breadth and foreign flow",
        {"client_context": {"symbol": "VNM"}},
        [
            {"id": "sector_breadth_snapshot", "sourceIds": ["MKT-SECTORS"]},
            {"id": "foreign_flow_chart", "sourceIds": ["VNM-FOREIGN"]},
        ],
    )

    action_ids = [action["id"] for action in actions]
    assert "add_widget_market_breadth" in action_ids
    assert "add_widget_foreign_trading" in action_ids
