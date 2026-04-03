from __future__ import annotations

import re
from typing import Any

SYMBOL_STOPWORDS = {
    "AND",
    "FOR",
    "LOOK",
    "ME",
    "SHOW",
    "SWITCH",
    "TAKE",
    "THE",
    "THIS",
    "THAT",
    "WITH",
}


SYMBOL_RE = re.compile(r"\b[A-Z]{2,4}\b")
COMPARE_KEYWORDS = ("compare", "versus", " vs ", "peer", "competitor", "rank")
SECTOR_KEYWORDS = ("sector", "breadth", "leader", "laggard", "market breadth")
FLOW_KEYWORDS = ("foreign flow", "foreign", "order flow")
CHART_KEYWORDS = ("trend", "technical", "chart", "price action")


def _message_mentions(message: str, *phrases: str) -> bool:
    lowered = str(message or "").lower()
    return any(phrase in lowered for phrase in phrases)


def _extract_symbols(message: str) -> list[str]:
    matches = SYMBOL_RE.findall(str(message or "").upper())
    seen: set[str] = set()
    symbols: list[str] = []
    for symbol in matches:
        if symbol in seen or symbol in SYMBOL_STOPWORDS:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return symbols


def _artifact_map(artifacts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(artifact.get("id") or "").strip(): artifact
        for artifact in artifacts
        if isinstance(artifact, dict) and str(artifact.get("id") or "").strip()
    }


def _action(
    action_id: str,
    action_type: str,
    label: str,
    description: str,
    *,
    confirm_text: str,
    payload: dict[str, Any],
    source_ids: list[str] | None = None,
) -> dict[str, Any]:
    action = {
        "id": action_id,
        "type": action_type,
        "label": label,
        "description": description,
        "confirmText": confirm_text,
        "payload": payload,
    }
    if source_ids:
        action["sourceIds"] = source_ids
    return action


def build_action_suggestions(
    message: str, context: dict[str, Any], artifacts: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    current_symbol = str((context.get("client_context") or {}).get("symbol") or "").strip().upper()
    mentioned_symbols = _extract_symbols(message)
    artifact_by_id = _artifact_map(artifacts)
    actions: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    compare_mode = _message_mentions(message, *COMPARE_KEYWORDS)

    if len(mentioned_symbols) == 1 and mentioned_symbols[0] != current_symbol and not compare_mode:
        target_symbol = mentioned_symbols[0]
        action_id = f"switch_symbol_{target_symbol.lower()}"
        seen_ids.add(action_id)
        actions.append(
            _action(
                action_id,
                "set_global_symbol",
                f"Switch to {target_symbol}",
                f"Set the linked dashboard ticker to {target_symbol}.",
                confirm_text=f"Switch the linked dashboard symbol to {target_symbol}?",
                payload={"symbol": target_symbol},
            )
        )

    if "comparison_snapshot" in artifact_by_id or "comparison_quality_chart" in artifact_by_id:
        action_id = "add_widget_comparison_analysis"
        if action_id not in seen_ids:
            actions.append(
                _action(
                    action_id,
                    "add_widget",
                    "Add Comparison Analysis",
                    "Insert a comparison widget in the current tab for deeper multi-stock review.",
                    confirm_text="Add a Comparison Analysis widget to the current tab?",
                    payload={"widgetType": "comparison_analysis"},
                    source_ids=[
                        *artifact_by_id.get("comparison_snapshot", {}).get("sourceIds", []),
                        *artifact_by_id.get("comparison_quality_chart", {}).get("sourceIds", []),
                    ]
                    or None,
                )
            )
            seen_ids.add(action_id)

    if (
        "sector_breadth_snapshot" in artifact_by_id
        or "sector_change_chart" in artifact_by_id
        or _message_mentions(message, *SECTOR_KEYWORDS)
    ):
        action_id = "add_widget_market_breadth"
        if action_id not in seen_ids:
            actions.append(
                _action(
                    action_id,
                    "add_widget",
                    "Add Market Breadth",
                    "Insert a market breadth widget in the current tab.",
                    confirm_text="Add a Market Breadth widget to the current tab?",
                    payload={"widgetType": "market_breadth"},
                    source_ids=[
                        *artifact_by_id.get("sector_breadth_snapshot", {}).get("sourceIds", []),
                        *artifact_by_id.get("sector_change_chart", {}).get("sourceIds", []),
                    ]
                    or None,
                )
            )
            seen_ids.add(action_id)

    if (
        "foreign_flow_leaderboard" in artifact_by_id
        or "foreign_flow_chart" in artifact_by_id
        or _message_mentions(message, *FLOW_KEYWORDS)
    ):
        action_id = "add_widget_foreign_trading"
        if action_id not in seen_ids:
            actions.append(
                _action(
                    action_id,
                    "add_widget",
                    "Add Foreign Trading",
                    "Insert a foreign trading widget for the active symbol.",
                    confirm_text="Add a Foreign Trading widget to the current tab?",
                    payload={"widgetType": "foreign_trading"},
                    source_ids=[
                        *artifact_by_id.get("foreign_flow_leaderboard", {}).get("sourceIds", []),
                        *artifact_by_id.get("foreign_flow_chart", {}).get("sourceIds", []),
                    ]
                    or None,
                )
            )
            seen_ids.add(action_id)

    if "price_trend_chart" in artifact_by_id or _message_mentions(message, *CHART_KEYWORDS):
        action_id = "add_widget_price_chart"
        if action_id not in seen_ids:
            actions.append(
                _action(
                    action_id,
                    "add_widget",
                    "Add Price Chart",
                    "Insert a price chart widget for the active symbol.",
                    confirm_text="Add a Price Chart widget to the current tab?",
                    payload={"widgetType": "price_chart"},
                    source_ids=artifact_by_id.get("price_trend_chart", {}).get("sourceIds", None),
                )
            )

    return actions
