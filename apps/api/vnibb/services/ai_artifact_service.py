from __future__ import annotations

from collections.abc import Sequence
from typing import Any

CHART_COLORS = ["#22d3ee", "#60a5fa", "#34d399", "#f59e0b", "#f472b6"]


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


def _build_chart_artifact(
    artifact_id: str,
    title: str,
    description: str,
    chart_type: str,
    x_key: str,
    series: list[dict[str, str]],
    rows: list[dict[str, Any]],
    source_ids: list[str],
    value_kind: str,
) -> dict[str, Any] | None:
    filtered_rows = [
        row
        for row in rows
        if any(key != x_key and value not in (None, "") for key, value in row.items())
    ]
    if not filtered_rows or not series:
        return None

    return {
        "id": artifact_id,
        "type": "chart",
        "title": title,
        "description": description,
        "chartType": chart_type,
        "xKey": x_key,
        "valueKind": value_kind,
        "series": series,
        "rows": filtered_rows,
        "sourceIds": source_ids,
    }


def _price_trend_chart(
    market_context: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str]]:
    all_dates: list[str] = []
    date_seen: set[str] = set()
    rows_by_date: dict[str, dict[str, Any]] = {}
    series: list[dict[str, str]] = []
    source_ids: list[str] = []

    for index, snapshot in enumerate(market_context):
        symbol = str(snapshot.get("symbol") or "").strip().upper()
        recent_series = (snapshot.get("price_context") or {}).get("recent_series") or []
        if not symbol or not recent_series:
            continue

        valid_points = [
            point
            for point in recent_series
            if _coerce_number(point.get("close")) not in (None, 0)
            and str(point.get("time") or "").strip()
        ]
        if len(valid_points) < 2:
            continue

        base_close = _coerce_number(valid_points[0].get("close"))
        if base_close in (None, 0):
            continue

        series.append(
            {
                "key": symbol,
                "label": f"{symbol} Base 100",
                "color": CHART_COLORS[index % len(CHART_COLORS)],
            }
        )
        for source_id in _symbol_source_ids(snapshot, "-PRICES"):
            if source_id not in source_ids:
                source_ids.append(source_id)

        for point in valid_points:
            date = str(point.get("time") or "")[:10]
            close = _coerce_number(point.get("close"))
            if not date or close is None:
                continue
            if date not in date_seen:
                date_seen.add(date)
                all_dates.append(date)
            rows_by_date.setdefault(date, {"date": date})[symbol] = round(
                (close / base_close) * 100, 2
            )

    rows = [rows_by_date[date] for date in all_dates if date in rows_by_date]
    return rows, series, source_ids


def _comparison_quality_chart(
    market_context: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str]]:
    rows: list[dict[str, Any]] = []
    source_ids: list[str] = []

    for snapshot in market_context:
        symbol = str(snapshot.get("symbol") or "").strip().upper()
        ratios = snapshot.get("ratios") or {}
        if not symbol:
            continue
        rows.append(
            {
                "symbol": symbol,
                "roe": _coerce_number(ratios.get("roe")),
                "revenue_growth": _coerce_number(ratios.get("revenue_growth")),
            }
        )
        for source_id in _symbol_source_ids(snapshot, "-RATIOS"):
            if source_id not in source_ids:
                source_ids.append(source_id)

    series = [
        {"key": "roe", "label": "ROE", "color": CHART_COLORS[0]},
        {"key": "revenue_growth", "label": "Revenue Growth", "color": CHART_COLORS[1]},
    ]
    return rows, series, source_ids


def _sector_change_chart(
    broad_market_context: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str]]:
    sectors = (broad_market_context or {}).get("sectors") or {}
    sector_rows = [
        *list(sectors.get("sector_leaders") or []),
        *list(sectors.get("sector_laggards") or []),
    ]

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for sector in sector_rows:
        sector_name = str(sector.get("sector_name") or sector.get("sector_code") or "").strip()
        if not sector_name or sector_name in seen:
            continue
        seen.add(sector_name)
        rows.append(
            {
                "sector": sector_name,
                "change_pct": _coerce_number(sector.get("change_pct")),
            }
        )

    series = [{"key": "change_pct", "label": "Change %", "color": CHART_COLORS[0]}]
    source_ids = ["MKT-SECTORS"] if rows else []
    return rows, series, source_ids


def _foreign_flow_chart(
    market_context: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str]]:
    rows: list[dict[str, Any]] = []
    source_ids: list[str] = []

    for snapshot in market_context:
        symbol = str(snapshot.get("symbol") or "").strip().upper()
        foreign_summary = (snapshot.get("foreign_trading") or {}).get("summary") or {}
        if not symbol:
            continue
        rows.append(
            {
                "symbol": symbol,
                "net_value_20d": _coerce_number(foreign_summary.get("net_value_20d")),
            }
        )
        for source_id in _symbol_source_ids(snapshot, "-FOREIGN"):
            if source_id not in source_ids:
                source_ids.append(source_id)

    rows.sort(key=lambda item: item.get("net_value_20d") or 0, reverse=True)
    series = [{"key": "net_value_20d", "label": "20D Net", "color": CHART_COLORS[2]}]
    return rows, series, source_ids


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


def build_chart_artifacts(message: str, context: dict[str, Any]) -> list[dict[str, Any]]:
    market_context = context.get("market_context") or []
    broad_market_context = context.get("broad_market_context") or {}
    artifacts: list[dict[str, Any]] = []

    if _message_mentions(
        message,
        "compare",
        "versus",
        " vs ",
        "peer",
        "valuation",
        "rank",
        "trend",
        "technical",
        "analysis",
    ):
        price_rows, price_series, price_source_ids = _price_trend_chart(market_context)
        artifact = _build_chart_artifact(
            "price_trend_chart",
            "Normalized Price Trend",
            "Base-100 trend from validated recent price history.",
            "line",
            "date",
            price_series,
            price_rows,
            price_source_ids,
            "number",
        )
        if artifact:
            artifacts.append(artifact)

    if _message_mentions(message, "compare", "versus", " vs ", "peer", "valuation", "rank"):
        quality_rows, quality_series, quality_source_ids = _comparison_quality_chart(market_context)
        artifact = _build_chart_artifact(
            "comparison_quality_chart",
            "Quality And Growth",
            "ROE and revenue growth from validated comparison context.",
            "bar",
            "symbol",
            quality_series,
            quality_rows,
            quality_source_ids,
            "percent",
        )
        if artifact:
            artifacts.append(artifact)

    if _message_mentions(message, "sector", "breadth", "laggard", "leader", "market breadth"):
        sector_rows, sector_series, sector_source_ids = _sector_change_chart(broad_market_context)
        artifact = _build_chart_artifact(
            "sector_change_chart",
            "Sector Change Overview",
            "Sector performance from validated market breadth context.",
            "bar",
            "sector",
            sector_series,
            sector_rows,
            sector_source_ids,
            "percent",
        )
        if artifact:
            artifacts.append(artifact)

    if _message_mentions(message, "foreign flow", "foreign", "order flow"):
        foreign_rows, foreign_series, foreign_source_ids = _foreign_flow_chart(market_context)
        artifact = _build_chart_artifact(
            "foreign_flow_chart",
            "20D Foreign Net Flow",
            "Validated 20-day foreign net flow comparison by symbol.",
            "bar",
            "symbol",
            foreign_series,
            foreign_rows,
            foreign_source_ids,
            "currency",
        )
        if artifact:
            artifacts.append(artifact)

    return artifacts


def build_artifacts(message: str, context: dict[str, Any]) -> list[dict[str, Any]]:
    return [*build_table_artifacts(message, context), *build_chart_artifacts(message, context)]
