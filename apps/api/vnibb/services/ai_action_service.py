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


FOLLOW_UP_MAX = 3

# Deterministic, context-grounded follow-up scaffolds. Each entry names the
# source kinds that make it answerable, the artifact that counts as supporting
# evidence when present, and the tab that should surface it first.
FOLLOW_UP_SCAFFOLDS: tuple[dict[str, Any], ...] = (
    {
        "id": "valuation_range",
        "label": "Break down valuation range",
        "prompt": "Break down {symbol}'s valuation range using the current ratios and price history.",
        "scope": "symbol",
        "requires": ("financial_ratios", "price_history"),
        "artifacts": (),
        "tabs": ("fundamentals", "overview"),
    },
    {
        "id": "margin_durability",
        "label": "Check margin durability",
        "prompt": "Is {symbol}'s margin trend durable, or does it look cyclical? Use the statement snapshots.",
        "scope": "symbol",
        "requires": ("income_statement", "financial_ratios"),
        "artifacts": (),
        "tabs": ("financials", "fundamentals"),
    },
    {
        "id": "balance_sheet_risk",
        "label": "Stress-test balance sheet",
        "prompt": "Stress-test {symbol}'s balance sheet: leverage, liquidity, and cash-flow coverage.",
        "scope": "symbol",
        "requires": ("balance_sheet", "cash_flow"),
        "artifacts": (),
        "tabs": ("financials", "fundamentals"),
    },
    {
        "id": "flow_persistence",
        "label": "Is the flow signal persistent?",
        "prompt": "Is the current foreign and order-flow signal for {symbol} persistent or a one-session move?",
        "scope": "symbol",
        "requires": ("foreign_trading", "order_flow"),
        "artifacts": ("foreign_flow_chart", "foreign_flow_leaderboard"),
        "tabs": ("flows", "market"),
    },
    {
        "id": "catalyst_risk",
        "label": "Rank catalysts and event risk",
        "prompt": "Rank {symbol}'s upcoming catalysts and event risk over the next two quarters.",
        "scope": "symbol",
        "requires": ("company_events", "dividends"),
        "artifacts": (),
        "tabs": ("events", "news"),
    },
    {
        "id": "news_narrative_shift",
        "label": "Has the narrative shifted?",
        "prompt": "Has {symbol}'s news narrative shifted meaningfully versus the last few weeks?",
        "scope": "symbol",
        "requires": ("company_news",),
        "artifacts": (),
        "tabs": ("news",),
    },
    {
        "id": "peer_comparison",
        "label": "Compare against peers",
        "prompt": "Compare {symbol} against its closest peers on quality, growth, and valuation.",
        "scope": "symbol",
        "requires": ("financial_ratios",),
        "artifacts": ("comparison_snapshot", "comparison_quality_chart"),
        "tabs": ("fundamentals", "overview"),
    },
    {
        "id": "insider_conviction",
        "label": "Check insider conviction",
        "prompt": "What does recent insider activity at {symbol} imply about management conviction?",
        "scope": "symbol",
        "requires": ("insider_deals",),
        "artifacts": (),
        "tabs": ("ownership", "news"),
    },
    {
        "id": "market_breadth_read",
        "label": "Read the market breadth",
        "prompt": "Is the current market breadth supportive or deteriorating, and which sectors lead?",
        "scope": "market",
        "requires": ("sector_breadth", "market_indices"),
        "artifacts": ("sector_breadth_snapshot", "sector_change_chart"),
        "tabs": ("market", "overview"),
    },
)


def _follow_up_priority(
    scaffold: dict[str, Any],
    *,
    available_kinds: set[str],
    artifact_ids: set[str],
    active_tab: str,
) -> int:
    """Higher score sorts first. Only grounded scaffolds reach this function."""
    score = 0
    if any(artifact_id in artifact_ids for artifact_id in scaffold["artifacts"]):
        # The answer already produced this evidence, so the follow-up is cheap
        # and directly continuous with what the user just read.
        score += 4
    if active_tab and active_tab in scaffold["tabs"]:
        score += 3
    if scaffold["scope"] == "symbol":
        score += 1
    score += len([kind for kind in scaffold["requires"] if kind in available_kinds])
    return score


def build_follow_up_suggestions(
    message: str,
    context: dict[str, Any],
    artifacts: list[dict[str, Any]],
    limit: int = FOLLOW_UP_MAX,
) -> list[dict[str, Any]]:
    """Derive grounded, answerable follow-up prompts from validated context.

    Every suggestion is backed by a source kind present in the runtime context,
    so it can be answered from data VNIBB already holds. Nothing is invented: a
    scaffold whose required kinds are all absent is never emitted.
    """
    if limit <= 0:
        return []

    client_context = context.get("client_context") if isinstance(context, dict) else None
    client_context = client_context if isinstance(client_context, dict) else {}
    current_symbol = str(client_context.get("symbol") or "").strip().upper()
    active_tab = str(client_context.get("activeTab") or "").strip().lower()

    source_catalog = context.get("source_catalog") if isinstance(context, dict) else []
    available_kinds: set[str] = set()
    for entry in source_catalog or []:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind") or "").strip()
        if kind:
            available_kinds.add(kind)
        symbol = str(entry.get("symbol") or "").strip()
        if symbol and not current_symbol:
            current_symbol = symbol.upper()

    artifact_ids = {
        str(artifact.get("id") or "").strip()
        for artifact in artifacts or []
        if isinstance(artifact, dict) and str(artifact.get("id") or "").strip()
    }

    ranked: list[tuple[int, dict[str, Any]]] = []
    for scaffold in FOLLOW_UP_SCAFFOLDS:
        requires = scaffold["requires"]
        if not any(kind in available_kinds for kind in requires):
            continue
        if scaffold["scope"] == "symbol" and not current_symbol:
            continue
        if _message_mentions(message, scaffold["label"].lower()):
            # Do not suggest what the user just asked for.
            continue
        # Symbol-scoped scaffolds already required a known symbol above, so the
        # placeholder always resolves here.
        prompt = scaffold["prompt"].replace("{symbol}", current_symbol)
        ranked.append(
            (
                _follow_up_priority(
                    scaffold,
                    available_kinds=available_kinds,
                    artifact_ids=artifact_ids,
                    active_tab=active_tab,
                ),
                {
                    "id": scaffold["id"],
                    "label": scaffold["label"],
                    "prompt": prompt,
                    "sourceIds": sorted(
                        str(entry.get("id") or "")
                        for entry in source_catalog or []
                        if isinstance(entry, dict)
                        and str(entry.get("kind") or "") in scaffold["requires"]
                        and str(entry.get("id") or "")
                    ),
                },
            )
        )

    ranked.sort(key=lambda item: (-item[0], item[1]["id"]))
    return [entry for _, entry in ranked[:limit]]
