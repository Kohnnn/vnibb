from __future__ import annotations

from collections.abc import Sequence
from typing import Any


def _coerce_number(value: Any) -> float | None:
    if value in (None, "", "null"):
        return None
    try:
        numeric = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if numeric != numeric:
        return None
    return numeric


def _message_mentions(message: str, *phrases: str) -> bool:
    lowered = str(message or "").lower()
    return any(phrase in lowered for phrase in phrases)


def _symbol_source_ids(snapshot: dict[str, Any], *suffixes: str) -> list[str]:
    available_source_ids = snapshot.get("available_source_ids") or []
    return [
        source_id
        for source_id in available_source_ids
        if isinstance(source_id, str) and any(source_id.endswith(suffix) for suffix in suffixes)
    ]


def _comparison_rows(
    market_context: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    source_ids: list[str] = []

    for snapshot in market_context:
        symbol = str(snapshot.get("symbol") or "").strip().upper()
        if not symbol:
            continue

        price_context = snapshot.get("price_context") or {}
        ratios = snapshot.get("ratios") or {}
        company = snapshot.get("company") or {}
        rows.append(
            {
                "symbol": symbol,
                "company": company.get("short_name") or company.get("company_name") or None,
                "price": _coerce_number((price_context.get("latest") or {}).get("close")),
                "change_20d_pct": _coerce_number(
                    (price_context.get("summary") or {}).get("change_20d_pct")
                ),
                "pe_ratio": _coerce_number(ratios.get("pe_ratio")),
                "pb_ratio": _coerce_number(ratios.get("pb_ratio")),
                "roe": _coerce_number(ratios.get("roe")),
                "revenue_growth": _coerce_number(ratios.get("revenue_growth")),
            }
        )
        for source_id in _symbol_source_ids(snapshot, "-PROFILE", "-PRICES", "-RATIOS"):
            if source_id not in source_ids:
                source_ids.append(source_id)

    return rows, source_ids


def _foreign_flow_rows(
    market_context: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    source_ids: list[str] = []

    for snapshot in market_context:
        flow = snapshot.get("foreign_trading") or {}
        summary = flow.get("summary") or {}
        latest_session = flow.get("latest_session") or {}
        symbol = str(snapshot.get("symbol") or "").strip().upper()
        if not symbol:
            continue

        rows.append(
            {
                "symbol": symbol,
                "latest_net_value": _coerce_number(latest_session.get("net_value")),
                "net_value_5d": _coerce_number(summary.get("net_value_5d")),
                "net_value_20d": _coerce_number(summary.get("net_value_20d")),
                "room_pct": _coerce_number(latest_session.get("room_pct")),
            }
        )
        for source_id in _symbol_source_ids(snapshot, "-FOREIGN"):
            if source_id not in source_ids:
                source_ids.append(source_id)

    rows.sort(key=lambda item: item.get("net_value_20d") or 0, reverse=True)
    return rows, source_ids


def _sector_rows(
    broad_market_context: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    sectors = (broad_market_context or {}).get("sectors") or {}
    leaders = sectors.get("sector_leaders") or []
    laggards = sectors.get("sector_laggards") or []
    rows: list[dict[str, Any]] = []
    seen_codes: set[str] = set()

    for label, items in (("Leader", leaders), ("Laggard", laggards)):
        for item in items:
            sector_code = str(item.get("sector_code") or "").strip().upper()
            if not sector_code or sector_code in seen_codes:
                continue
            seen_codes.add(sector_code)
            rows.append(
                {
                    "view": label,
                    "sector": item.get("sector_name") or sector_code,
                    "change_pct": _coerce_number(item.get("change_pct")),
                    "advance_count": _coerce_number(item.get("advance_count")),
                    "decline_count": _coerce_number(item.get("decline_count")),
                    "top_gainer": item.get("top_gainer_symbol"),
                    "top_loser": item.get("top_loser_symbol"),
                }
            )

    source_ids = ["MKT-SECTORS"] if rows else []
    return rows, source_ids


def _build_table_artifact(
    artifact_id: str,
    title: str,
    description: str,
    columns: list[dict[str, str]],
    rows: list[dict[str, Any]],
    source_ids: list[str],
) -> dict[str, Any] | None:
    filtered_rows = [row for row in rows if any(value not in (None, "") for value in row.values())]
    if not filtered_rows:
        return None

    return {
        "id": artifact_id,
        "type": "table",
        "title": title,
        "description": description,
        "columns": columns,
        "rows": filtered_rows,
        "sourceIds": source_ids,
    }


def build_table_artifacts(message: str, context: dict[str, Any]) -> list[dict[str, Any]]:
    market_context = context.get("market_context") or []
    broad_market_context = context.get("broad_market_context") or {}
    artifacts: list[dict[str, Any]] = []

    if _message_mentions(message, "compare", "versus", " vs ", "peer", "valuation", "rank"):
        comparison_rows, comparison_source_ids = _comparison_rows(market_context)
        if len(comparison_rows) >= 2:
            artifact = _build_table_artifact(
                "comparison_snapshot",
                "Comparison Snapshot",
                "Validated cross-symbol comparison from the current Appwrite-first market context.",
                [
                    {"key": "symbol", "label": "Symbol", "kind": "text"},
                    {"key": "company", "label": "Company", "kind": "text"},
                    {"key": "price", "label": "Price", "kind": "currency"},
                    {"key": "change_20d_pct", "label": "20D %", "kind": "percent"},
                    {"key": "pe_ratio", "label": "P/E", "kind": "number"},
                    {"key": "pb_ratio", "label": "P/B", "kind": "number"},
                    {"key": "roe", "label": "ROE", "kind": "percent"},
                    {"key": "revenue_growth", "label": "Rev Growth", "kind": "percent"},
                ],
                comparison_rows,
                comparison_source_ids,
            )
            if artifact:
                artifacts.append(artifact)

    if _message_mentions(message, "sector", "breadth", "laggard", "leader", "market breadth"):
        sector_rows, sector_source_ids = _sector_rows(broad_market_context)
        artifact = _build_table_artifact(
            "sector_breadth_snapshot",
            "Sector Breadth Snapshot",
            "Leaders and laggards from the validated market breadth context.",
            [
                {"key": "view", "label": "View", "kind": "text"},
                {"key": "sector", "label": "Sector", "kind": "text"},
                {"key": "change_pct", "label": "Change %", "kind": "percent"},
                {"key": "advance_count", "label": "Adv", "kind": "number"},
                {"key": "decline_count", "label": "Dec", "kind": "number"},
                {"key": "top_gainer", "label": "Top Gainer", "kind": "text"},
                {"key": "top_loser", "label": "Top Loser", "kind": "text"},
            ],
            sector_rows,
            sector_source_ids,
        )
        if artifact:
            artifacts.append(artifact)

    if _message_mentions(message, "foreign flow", "foreign", "order flow"):
        foreign_rows, foreign_source_ids = _foreign_flow_rows(market_context)
        if foreign_rows:
            artifact = _build_table_artifact(
                "foreign_flow_leaderboard",
                "Foreign Flow Leaderboard",
                "Recent foreign flow ranking derived from validated symbol snapshots.",
                [
                    {"key": "symbol", "label": "Symbol", "kind": "text"},
                    {"key": "latest_net_value", "label": "Latest Net", "kind": "currency"},
                    {"key": "net_value_5d", "label": "5D Net", "kind": "currency"},
                    {"key": "net_value_20d", "label": "20D Net", "kind": "currency"},
                    {"key": "room_pct", "label": "Room %", "kind": "percent"},
                ],
                foreign_rows,
                foreign_source_ids,
            )
            if artifact:
                artifacts.append(artifact)

    return artifacts
