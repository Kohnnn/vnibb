from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from typing import Any

from sqlalchemy import desc, select

from vnibb.core.appwrite_client import (
    get_appwrite_stock,
    get_appwrite_stock_prices,
    list_appwrite_documents,
    list_appwrite_documents_paginated,
)
from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.market import MarketSector, SectorPerformance
from vnibb.models.news import CompanyEvent, CompanyNews, Dividend, InsiderDeal
from vnibb.models.stock import Stock, StockIndex, StockPrice
from vnibb.models.trading import FinancialRatio, ForeignTrading, OrderFlowDaily

logger = logging.getLogger(__name__)

SYMBOL_RE = re.compile(r"\b[A-Z]{2,4}\b")
SYMBOL_STOPWORDS = {
    "AND",
    "ARE",
    "FOR",
    "NOT",
    "THE",
    "THIS",
    "THAT",
    "WITH",
}
SENSITIVE_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
}
MAX_CONTEXT_DEPTH = 5
MAX_DICT_ITEMS = 20
MAX_LIST_ITEMS = 20
MAX_STRING_LENGTH = 500
PRICE_WINDOW = 20
FLOW_WINDOW = 20
NEWS_LIMIT = 4
EVENT_LIMIT = 4
SECTOR_LIMIT = 4
MARKET_INDEX_CODES = ("VNINDEX", "VN30", "HNX", "UPCOM")


def _query_equal(attribute: str, values: Sequence[Any]) -> dict[str, Any]:
    return {"method": "equal", "attribute": attribute, "values": list(values)}


def _query_limit(value: int) -> dict[str, Any]:
    return {"method": "limit", "values": [int(value)]}


def _query_order(attribute: str, descending: bool = False) -> dict[str, Any]:
    return {"method": "orderDesc" if descending else "orderAsc", "attribute": attribute}


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


def _iso_value(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _compact_dict(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value not in (None, "", [], {})}


def _truncate_text(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(cleaned) <= MAX_STRING_LENGTH:
        return cleaned
    return f"{cleaned[:MAX_STRING_LENGTH]}..."


def sanitize_context_value(value: Any, depth: int = 0) -> Any:
    if depth >= MAX_CONTEXT_DEPTH:
        return "[truncated]"

    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= MAX_DICT_ITEMS:
                sanitized["_truncated"] = True
                break
            normalized_key = str(key)
            if normalized_key.lower() in SENSITIVE_KEYS:
                continue
            sanitized[normalized_key] = sanitize_context_value(item, depth + 1)
        return sanitized

    if isinstance(value, (list, tuple, set)):
        items = list(value)[:MAX_LIST_ITEMS]
        return [sanitize_context_value(item, depth + 1) for item in items]

    if isinstance(value, str):
        return _truncate_text(value)

    if isinstance(value, (int, float, bool)) or value is None:
        return value

    if hasattr(value, "isoformat"):
        return value.isoformat()

    return _truncate_text(str(value))


def _dedupe_symbols(symbols: Sequence[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for symbol in symbols:
        value = str(symbol or "").strip().upper()
        if not value or value in seen or value in SYMBOL_STOPWORDS:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def _extract_symbols(*texts: str | None) -> list[str]:
    matches: list[str] = []
    for text in texts:
        if not text:
            continue
        matches.extend(SYMBOL_RE.findall(text.upper()))
    return _dedupe_symbols(matches)


def _pick_fields(data: dict[str, Any] | None, fields: Sequence[str]) -> dict[str, Any] | None:
    if not data:
        return None
    subset = {field: data.get(field) for field in fields if data.get(field) not in (None, "")}
    return subset or None


def _build_price_context(price_rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    normalized_rows = []
    for row in price_rows:
        row_time = str(row.get("time") or "")[:10]
        close = _coerce_number(row.get("close"))
        volume = _coerce_number(row.get("volume"))
        if not row_time or close is None:
            continue
        normalized_rows.append({"time": row_time, "close": close, "volume": volume})

    if not normalized_rows:
        return None

    series = sorted(normalized_rows, key=lambda item: item["time"])
    latest = series[-1]
    latest_close = latest["close"]

    def percent_change(offset: int) -> float | None:
        if len(series) <= offset:
            return None
        previous = series[-(offset + 1)]["close"]
        if previous in (None, 0):
            return None
        return round(((latest_close - previous) / previous) * 100, 2)

    recent_window = series[-PRICE_WINDOW:]
    recent_volumes = [row["volume"] for row in recent_window if row.get("volume") is not None]
    low_20d = min((row["close"] for row in recent_window), default=None)
    high_20d = max((row["close"] for row in recent_window), default=None)

    return {
        "latest": latest,
        "summary": {
            "change_5d_pct": percent_change(5),
            "change_20d_pct": percent_change(20),
            "low_20d": low_20d,
            "high_20d": high_20d,
            "average_volume_20d": round(sum(recent_volumes) / len(recent_volumes), 2)
            if recent_volumes
            else None,
        },
        "recent_series": recent_window,
    }


def _build_news_context(news_rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    articles: list[dict[str, Any]] = []
    sentiment_counts: dict[str, int] = {}

    for row in news_rows:
        title = _truncate_text(str(row.get("title") or ""))
        if not title:
            continue

        sentiment = str(row.get("sentiment") or "").strip().lower()
        if sentiment:
            sentiment_counts[sentiment] = sentiment_counts.get(sentiment, 0) + 1

        article = _compact_dict(
            {
                "title": title,
                "summary": _truncate_text(str(row.get("summary") or "")) or None,
                "source": row.get("source"),
                "published_date": _iso_value(row.get("published_date") or row.get("published_at")),
                "sentiment": sentiment or None,
                "url": row.get("url"),
                "price_change_ratio": _coerce_number(row.get("price_change_ratio")),
            }
        )
        articles.append(article)

    if not articles:
        return None

    return {
        "latest_articles": articles[:NEWS_LIMIT],
        "sentiment_counts": sentiment_counts or None,
    }


def _build_indices_context(index_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_by_code: dict[str, dict[str, Any]] = {}
    for row in index_rows:
        code = str(row.get("index_code") or "").strip().upper()
        if not code or code in latest_by_code:
            continue
        latest_by_code[code] = _compact_dict(
            {
                "index_code": code,
                "time": _iso_value(row.get("time")),
                "close": _coerce_number(row.get("close")),
                "change": _coerce_number(row.get("change")),
                "change_pct": _coerce_number(row.get("change_pct")),
                "volume": _coerce_number(row.get("volume")),
            }
        )

    return [latest_by_code[code] for code in MARKET_INDEX_CODES if code in latest_by_code]


def _build_sector_context(
    sector_rows: list[dict[str, Any]],
    sector_names: dict[str, str],
) -> dict[str, Any] | None:
    if not sector_rows:
        return None

    normalized_rows: list[dict[str, Any]] = []
    for row in sector_rows:
        code = str(row.get("sector_code") or "").strip().upper()
        if not code:
            continue
        normalized_rows.append(
            _compact_dict(
                {
                    "sector_code": code,
                    "sector_name": sector_names.get(code),
                    "trade_date": _iso_value(row.get("trade_date")),
                    "change_pct": _coerce_number(row.get("change_pct")),
                    "advance_count": row.get("advance_count"),
                    "decline_count": row.get("decline_count"),
                    "unchanged_count": row.get("unchanged_count"),
                    "top_gainer_symbol": row.get("top_gainer_symbol"),
                    "top_gainer_change": _coerce_number(row.get("top_gainer_change")),
                    "top_loser_symbol": row.get("top_loser_symbol"),
                    "top_loser_change": _coerce_number(row.get("top_loser_change")),
                }
            )
        )

    if not normalized_rows:
        return None

    ordered = sorted(normalized_rows, key=lambda item: item.get("change_pct") or 0, reverse=True)
    breadth = {
        "advance_count": sum(int(item.get("advance_count") or 0) for item in normalized_rows),
        "decline_count": sum(int(item.get("decline_count") or 0) for item in normalized_rows),
        "unchanged_count": sum(int(item.get("unchanged_count") or 0) for item in normalized_rows),
        "sector_count": len(normalized_rows),
    }

    return {
        "latest_trade_date": ordered[0].get("trade_date"),
        "breadth": breadth,
        "sector_leaders": ordered[:SECTOR_LIMIT],
        "sector_laggards": list(reversed(ordered[-SECTOR_LIMIT:])),
    }


def _sum_numeric(rows: Sequence[dict[str, Any]], field: str) -> float | None:
    values = [_coerce_number(row.get(field)) for row in rows]
    numeric_values = [value for value in values if value is not None]
    if not numeric_values:
        return None
    return round(sum(numeric_values), 2)


def _build_flow_context(
    rows: list[dict[str, Any]],
    *,
    extra_fields: Sequence[str] = (),
) -> dict[str, Any] | None:
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        trade_date = str(row.get("trade_date") or row.get("time") or "")[:10]
        if not trade_date:
            continue

        normalized = {
            "trade_date": trade_date,
            "buy_value": _coerce_number(row.get("buy_value")),
            "sell_value": _coerce_number(row.get("sell_value")),
            "net_value": _coerce_number(row.get("net_value")),
            "buy_volume": _coerce_number(row.get("buy_volume")),
            "sell_volume": _coerce_number(row.get("sell_volume")),
            "net_volume": _coerce_number(row.get("net_volume")),
        }
        for field in extra_fields:
            value = row.get(field)
            normalized[field] = _coerce_number(value) if value not in (None, "") else None
        normalized_rows.append(_compact_dict(normalized))

    if not normalized_rows:
        return None

    ordered = sorted(normalized_rows, key=lambda item: item["trade_date"])
    recent_window = ordered[-FLOW_WINDOW:]
    recent_sessions = recent_window[-5:]

    return {
        "latest_session": ordered[-1],
        "summary": _compact_dict(
            {
                "net_value_5d": _sum_numeric(recent_window[-5:], "net_value"),
                "net_value_20d": _sum_numeric(recent_window, "net_value"),
                "net_volume_5d": _sum_numeric(recent_window[-5:], "net_volume"),
                "net_volume_20d": _sum_numeric(recent_window, "net_volume"),
                "positive_sessions_20d": sum(
                    1 for row in recent_window if (row.get("net_value") or 0) > 0
                ),
                "negative_sessions_20d": sum(
                    1 for row in recent_window if (row.get("net_value") or 0) < 0
                ),
            }
        ),
        "recent_sessions": recent_sessions,
    }


def _build_insider_context(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    deals: list[dict[str, Any]] = []
    buy_count = 0
    sell_count = 0

    for row in rows:
        action = str(row.get("deal_action") or "").strip().lower()
        if any(keyword in action for keyword in ("mua", "buy")):
            buy_count += 1
        if any(keyword in action for keyword in ("ban", "bán", "sell")):
            sell_count += 1

        deals.append(
            _compact_dict(
                {
                    "announce_date": _iso_value(row.get("announce_date")),
                    "deal_action": str(row.get("deal_action") or "").strip() or None,
                    "deal_quantity": _coerce_number(row.get("deal_quantity")),
                    "deal_price": _coerce_number(row.get("deal_price")),
                    "deal_value": _coerce_number(row.get("deal_value")),
                    "deal_ratio": _coerce_number(row.get("deal_ratio")),
                    "insider_name": row.get("insider_name"),
                    "insider_position": row.get("insider_position"),
                }
            )
        )

    if not deals:
        return None

    return {
        "recent_deals": deals[:EVENT_LIMIT],
        "summary": _compact_dict(
            {
                "buy_count": buy_count,
                "sell_count": sell_count,
                "total_disclosed_value": _sum_numeric(deals, "deal_value"),
            }
        ),
    }


def _build_company_events_context(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    events = [
        _compact_dict(
            {
                "event_type": row.get("event_type"),
                "event_date": _iso_value(row.get("event_date")),
                "ex_date": _iso_value(row.get("ex_date")),
                "record_date": _iso_value(row.get("record_date")),
                "payment_date": _iso_value(row.get("payment_date")),
                "value": _coerce_number(row.get("value")),
                "description": _truncate_text(str(row.get("description") or "")) or None,
            }
        )
        for row in rows
    ]
    events = [event for event in events if event]
    if not events:
        return None

    return {"recent_events": events[:EVENT_LIMIT]}


def _build_dividends_context(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    dividends = [
        _compact_dict(
            {
                "exercise_date": _iso_value(row.get("exercise_date")),
                "record_date": _iso_value(row.get("record_date")),
                "payment_date": _iso_value(row.get("payment_date")),
                "cash_year": row.get("cash_year"),
                "dividend_rate": _coerce_number(row.get("dividend_rate")),
                "dividend_value": _coerce_number(row.get("dividend_value")),
                "issue_method": row.get("issue_method"),
            }
        )
        for row in rows
    ]
    dividends = [dividend for dividend in dividends if dividend]
    if not dividends:
        return None

    return {
        "recent_dividends": dividends[:EVENT_LIMIT],
        "summary": _compact_dict(
            {
                "cash_dividend_total_recent": _sum_numeric(
                    dividends[:EVENT_LIMIT], "dividend_value"
                ),
                "latest_issue_method": dividends[0].get("issue_method"),
            }
        ),
    }


def _source_priority_rank(source_system: str | None) -> int:
    normalized = str(source_system or "").strip().lower()
    if normalized == "appwrite":
        return 1
    if normalized == "postgres":
        return 2
    return 3


def _extract_section_as_of(section: Any) -> str | None:
    if not section:
        return None
    if isinstance(section, dict):
        for key in (
            "latest_trade_date",
            "published_date",
            "trade_date",
            "time",
            "event_date",
            "exercise_date",
            "announce_date",
            "record_date",
            "payment_date",
        ):
            value = section.get(key)
            if value not in (None, ""):
                return _iso_value(value)

        for nested_key, candidate_keys in (
            ("latest", ("time", "trade_date")),
            ("latest_session", ("trade_date", "time")),
        ):
            nested = section.get(nested_key)
            if isinstance(nested, dict):
                for candidate in candidate_keys:
                    value = nested.get(candidate)
                    if value not in (None, ""):
                        return _iso_value(value)

        for list_key, candidate_keys in (
            ("latest_articles", ("published_date",)),
            ("recent_deals", ("announce_date",)),
            ("recent_events", ("event_date", "ex_date")),
            ("recent_dividends", ("exercise_date",)),
            ("recent_sessions", ("trade_date",)),
        ):
            items = section.get(list_key)
            if isinstance(items, list) and items:
                first_item = items[0]
                if isinstance(first_item, dict):
                    for candidate in candidate_keys:
                        value = first_item.get(candidate)
                        if value not in (None, ""):
                            return _iso_value(value)
    return None


def _build_source_reference(
    source_id: str,
    *,
    scope: str,
    kind: str,
    label: str,
    source_system: str | None,
    symbol: str | None = None,
    as_of: str | None = None,
) -> dict[str, Any]:
    return _compact_dict(
        {
            "id": source_id,
            "scope": scope,
            "kind": kind,
            "label": label,
            "source": source_system,
            "symbol": symbol,
            "as_of": as_of,
            "priority": _source_priority_rank(source_system),
        }
    )


def _annotate_source_catalog(
    broad_market_context: dict[str, Any] | None,
    market_context: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    source_catalog: list[dict[str, Any]] = []

    if broad_market_context:
        broad_source = str(broad_market_context.get("source") or "").strip().lower() or None
        broad_source_ids: list[str] = []
        for key, source_id, kind, label in (
            ("indices", "MKT-INDICES", "market_indices", "Market index snapshot"),
            ("sectors", "MKT-SECTORS", "sector_breadth", "Sector breadth snapshot"),
        ):
            section = broad_market_context.get(key)
            if not section:
                continue
            broad_source_ids.append(source_id)
            source_catalog.append(
                _build_source_reference(
                    source_id,
                    scope="market",
                    kind=kind,
                    label=label,
                    source_system=broad_source,
                    as_of=_extract_section_as_of(section),
                )
            )
        if broad_source_ids:
            broad_market_context["available_source_ids"] = broad_source_ids

    for snapshot in market_context:
        symbol = str(snapshot.get("symbol") or "").strip().upper()
        if not symbol:
            continue

        source_system = str(snapshot.get("source") or "").strip().lower() or None
        symbol_source_ids: list[str] = []
        for key, code, kind, label in (
            ("company", "PROFILE", "company_profile", "Company profile"),
            ("price_context", "PRICES", "price_history", "Price history snapshot"),
            ("ratios", "RATIOS", "financial_ratios", "Financial ratios snapshot"),
            ("income_statement", "INCOME", "income_statement", "Income statement snapshot"),
            ("balance_sheet", "BALANCE", "balance_sheet", "Balance sheet snapshot"),
            ("cash_flow", "CASHFLOW", "cash_flow", "Cash flow snapshot"),
            ("recent_news", "NEWS", "company_news", "Company news summary"),
            ("foreign_trading", "FOREIGN", "foreign_trading", "Foreign trading summary"),
            ("order_flow", "ORDERFLOW", "order_flow", "Order flow summary"),
            ("insider_deals", "INSIDERS", "insider_deals", "Insider transactions summary"),
            ("company_events", "EVENTS", "company_events", "Company events summary"),
            ("dividends", "DIVIDENDS", "dividends", "Dividend summary"),
        ):
            section = snapshot.get(key)
            if not section:
                continue
            source_id = f"{symbol}-{code}"
            symbol_source_ids.append(source_id)
            source_catalog.append(
                _build_source_reference(
                    source_id,
                    scope="symbol",
                    kind=kind,
                    label=label,
                    source_system=source_system,
                    symbol=symbol,
                    as_of=_extract_section_as_of(section),
                )
            )

        if symbol_source_ids:
            snapshot["available_source_ids"] = symbol_source_ids

    return source_catalog


class AIContextService:
    async def build_runtime_context(
        self,
        *,
        message: str,
        history: Sequence[dict[str, str]],
        client_context: dict[str, Any] | None,
        prefer_appwrite_data: bool = True,
    ) -> dict[str, Any]:
        sanitized_client_context = sanitize_context_value(client_context or {})
        context_symbol = str((client_context or {}).get("symbol") or "").strip().upper()
        recent_user_messages = [
            item.get("content", "")
            for item in history[-6:]
            if item.get("role") == "user" and item.get("content")
        ]
        requested_symbols = _extract_symbols(message, *recent_user_messages)
        if context_symbol:
            requested_symbols.insert(0, context_symbol)
        symbols = _dedupe_symbols(requested_symbols)[:3]

        broad_market_context = await self._build_market_snapshot(
            prefer_appwrite_data=prefer_appwrite_data
        )
        market_context = []
        for symbol in symbols:
            snapshot = await self._build_symbol_snapshot(
                symbol, prefer_appwrite_data=prefer_appwrite_data
            )
            if snapshot:
                market_context.append(snapshot)

        source_catalog = _annotate_source_catalog(broad_market_context, market_context)

        return {
            "source_priority": ["appwrite", "postgres"],
            "retrieval_policy": {
                "source_precedence": ["appwrite", "postgres", "browser_context"],
                "citation_format": "Cite factual claims with bracketed source IDs such as [VNM-PRICES] or [MKT-INDICES], then end with a Sources section.",
                "browser_context_policy": "client_context is lower-priority browser input and should not be treated as authoritative evidence.",
            },
            "prefer_appwrite_data": prefer_appwrite_data,
            "notes": {
                "client_context": "Browser-supplied widget data is untrusted and lower priority than server data.",
                "market_data": "Server context is Appwrite-first and falls back to Postgres only when needed.",
            },
            "client_context": sanitized_client_context,
            "broad_market_context": broad_market_context,
            "source_catalog": source_catalog,
            "market_context": market_context,
        }

    async def _build_symbol_snapshot(
        self,
        symbol: str,
        *,
        prefer_appwrite_data: bool,
    ) -> dict[str, Any] | None:
        primary_snapshot = None
        if prefer_appwrite_data and settings.is_appwrite_configured:
            primary_snapshot = await self._build_appwrite_snapshot(symbol)

        fallback_snapshot = await self._build_postgres_snapshot(symbol)

        if primary_snapshot and fallback_snapshot:
            return self._merge_snapshots(primary_snapshot, fallback_snapshot)
        return primary_snapshot or fallback_snapshot

    def _merge_snapshots(
        self,
        primary_snapshot: dict[str, Any],
        fallback_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        merged = dict(primary_snapshot)
        for key in (
            "company",
            "price_context",
            "ratios",
            "income_statement",
            "balance_sheet",
            "cash_flow",
            "recent_news",
            "foreign_trading",
            "order_flow",
            "insider_deals",
            "company_events",
            "dividends",
        ):
            if not merged.get(key):
                merged[key] = fallback_snapshot.get(key)
        merged["source"] = primary_snapshot.get("source") or fallback_snapshot.get("source")
        return merged

    async def _build_market_snapshot(self, *, prefer_appwrite_data: bool) -> dict[str, Any] | None:
        primary_snapshot = None
        if prefer_appwrite_data and settings.is_appwrite_configured:
            primary_snapshot = await self._build_appwrite_market_snapshot()

        fallback_snapshot = await self._build_postgres_market_snapshot()

        if primary_snapshot and fallback_snapshot:
            merged = dict(primary_snapshot)
            for key in ("indices", "sectors"):
                if not merged.get(key):
                    merged[key] = fallback_snapshot.get(key)
            merged["source"] = primary_snapshot.get("source") or fallback_snapshot.get("source")
            return merged

        return primary_snapshot or fallback_snapshot

    async def _build_appwrite_snapshot(self, symbol: str) -> dict[str, Any] | None:
        try:
            (
                stock_doc,
                price_rows,
                ratio_doc,
                income_doc,
                balance_doc,
                cash_doc,
                news_rows,
                foreign_trading_rows,
                order_flow_rows,
                insider_deal_rows,
                company_event_rows,
                dividend_rows,
            ) = await self._load_appwrite_documents(symbol)
        except Exception as exc:
            logger.warning("Appwrite AI context load failed for %s: %s", symbol, exc)
            return None

        if not any(
            [
                stock_doc,
                price_rows,
                ratio_doc,
                income_doc,
                balance_doc,
                cash_doc,
                news_rows,
                foreign_trading_rows,
                order_flow_rows,
                insider_deal_rows,
                company_event_rows,
                dividend_rows,
            ]
        ):
            return None

        return {
            "symbol": symbol,
            "source": "appwrite",
            "company": _pick_fields(
                stock_doc,
                (
                    "symbol",
                    "company_name",
                    "short_name",
                    "exchange",
                    "industry",
                    "sector",
                    "listing_date",
                ),
            ),
            "price_context": _build_price_context(price_rows),
            "ratios": _pick_fields(
                ratio_doc,
                (
                    "period",
                    "period_type",
                    "fiscal_year",
                    "fiscal_quarter",
                    "pe_ratio",
                    "pb_ratio",
                    "ps_ratio",
                    "roe",
                    "roa",
                    "gross_margin",
                    "operating_margin",
                    "net_margin",
                    "current_ratio",
                    "debt_to_equity",
                    "revenue_growth",
                    "earnings_growth",
                    "eps",
                    "bvps",
                ),
            ),
            "income_statement": _pick_fields(
                income_doc,
                (
                    "period",
                    "period_type",
                    "fiscal_year",
                    "fiscal_quarter",
                    "revenue",
                    "gross_profit",
                    "operating_income",
                    "net_income",
                    "eps",
                ),
            ),
            "balance_sheet": _pick_fields(
                balance_doc,
                (
                    "period",
                    "period_type",
                    "fiscal_year",
                    "fiscal_quarter",
                    "total_assets",
                    "total_liabilities",
                    "total_equity",
                    "cash_and_equivalents",
                    "long_term_debt",
                ),
            ),
            "cash_flow": _pick_fields(
                cash_doc,
                (
                    "period",
                    "period_type",
                    "fiscal_year",
                    "fiscal_quarter",
                    "operating_cash_flow",
                    "investing_cash_flow",
                    "financing_cash_flow",
                    "free_cash_flow",
                    "dividends_paid",
                    "debt_repayment",
                ),
            ),
            "recent_news": _build_news_context(news_rows),
            "foreign_trading": _build_flow_context(
                foreign_trading_rows,
                extra_fields=("room_available", "room_pct"),
            ),
            "order_flow": _build_flow_context(
                order_flow_rows,
                extra_fields=(
                    "foreign_net_volume",
                    "proprietary_net_volume",
                    "big_order_count",
                    "block_trade_count",
                ),
            ),
            "insider_deals": _build_insider_context(insider_deal_rows),
            "company_events": _build_company_events_context(company_event_rows),
            "dividends": _build_dividends_context(dividend_rows),
        }

    async def _load_appwrite_documents(
        self,
        symbol: str,
    ) -> tuple[
        dict[str, Any] | None,
        list[dict[str, Any]],
        dict[str, Any] | None,
        dict[str, Any] | None,
        dict[str, Any] | None,
        dict[str, Any] | None,
        list[dict[str, Any]],
        list[dict[str, Any]],
        list[dict[str, Any]],
        list[dict[str, Any]],
        list[dict[str, Any]],
        list[dict[str, Any]],
    ]:
        stock_doc = await get_appwrite_stock(symbol)
        price_rows = await get_appwrite_stock_prices(symbol, limit=PRICE_WINDOW, descending=True)
        ratio_doc = await self._get_latest_appwrite_symbol_document("financial_ratios", symbol)
        income_doc = await self._get_latest_appwrite_symbol_document("income_statements", symbol)
        balance_doc = await self._get_latest_appwrite_symbol_document("balance_sheets", symbol)
        cash_doc = await self._get_latest_appwrite_symbol_document("cash_flows", symbol)
        news_rows = await self._get_latest_appwrite_news(symbol)
        foreign_trading_rows = await self._get_latest_appwrite_symbol_rows(
            "foreign_trading", symbol, order_attribute="trade_date", limit=FLOW_WINDOW
        )
        order_flow_rows = await self._get_latest_appwrite_symbol_rows(
            "order_flow_daily", symbol, order_attribute="trade_date", limit=FLOW_WINDOW
        )
        insider_deal_rows = await self._get_latest_appwrite_symbol_rows(
            "insider_deals", symbol, order_attribute="announce_date", limit=EVENT_LIMIT
        )
        company_event_rows = await self._get_latest_appwrite_symbol_rows(
            "company_events", symbol, order_attribute="event_date", limit=EVENT_LIMIT
        )
        dividend_rows = await self._get_latest_appwrite_symbol_rows(
            "dividends", symbol, order_attribute="exercise_date", limit=EVENT_LIMIT
        )
        return (
            stock_doc,
            price_rows,
            ratio_doc,
            income_doc,
            balance_doc,
            cash_doc,
            news_rows,
            foreign_trading_rows,
            order_flow_rows,
            insider_deal_rows,
            company_event_rows,
            dividend_rows,
        )

    async def _get_latest_appwrite_symbol_document(
        self,
        collection_id: str,
        symbol: str,
    ) -> dict[str, Any] | None:
        docs = await list_appwrite_documents(
            collection_id,
            queries=[
                _query_equal("symbol", [symbol.upper()]),
                _query_order("fiscal_year", descending=True),
                _query_order("fiscal_quarter", descending=True),
                _query_limit(1),
            ],
        )
        return docs[0] if docs else None

    async def _get_latest_appwrite_news(self, symbol: str) -> list[dict[str, Any]]:
        return await list_appwrite_documents(
            "company_news",
            queries=[
                _query_equal("symbol", [symbol.upper()]),
                _query_order("published_date", descending=True),
                _query_limit(NEWS_LIMIT),
            ],
        )

    async def _get_latest_appwrite_symbol_rows(
        self,
        collection_id: str,
        symbol: str,
        *,
        order_attribute: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        return await list_appwrite_documents(
            collection_id,
            queries=[
                _query_equal("symbol", [symbol.upper()]),
                _query_order(order_attribute, descending=True),
                _query_limit(limit),
            ],
        )

    async def _build_appwrite_market_snapshot(self) -> dict[str, Any] | None:
        try:
            index_rows = []
            for index_code in MARKET_INDEX_CODES:
                rows = await list_appwrite_documents(
                    "stock_indices",
                    queries=[
                        _query_equal("index_code", [index_code]),
                        _query_order("time", descending=True),
                        _query_limit(1),
                    ],
                )
                if rows:
                    index_rows.append(rows[0])

            latest_sector_rows = await list_appwrite_documents(
                "sector_performance",
                queries=[_query_order("trade_date", descending=True), _query_limit(1)],
            )
            sector_rows: list[dict[str, Any]] = []
            sector_names: dict[str, str] = {}
            if latest_sector_rows:
                latest_trade_date = latest_sector_rows[0].get("trade_date")
                if latest_trade_date:
                    sector_rows = await list_appwrite_documents_paginated(
                        "sector_performance",
                        queries=[_query_equal("trade_date", [latest_trade_date])],
                        page_size=100,
                        max_documents=100,
                    )

            if sector_rows:
                sector_docs = await list_appwrite_documents_paginated(
                    "market_sectors",
                    queries=[_query_limit(100)],
                    page_size=100,
                    max_documents=100,
                )
                sector_names = {
                    str(doc.get("sector_code") or "").strip().upper(): str(
                        doc.get("sector_name") or ""
                    ).strip()
                    for doc in sector_docs
                    if str(doc.get("sector_code") or "").strip()
                }

            indices_context = _build_indices_context(index_rows)
            sectors_context = _build_sector_context(sector_rows, sector_names)
            if not indices_context and not sectors_context:
                return None

            return {
                "source": "appwrite",
                "indices": indices_context,
                "sectors": sectors_context,
            }
        except Exception as exc:
            logger.warning("Appwrite market AI context load failed: %s", exc)
            return None

    async def _build_postgres_snapshot(self, symbol: str) -> dict[str, Any] | None:
        async with async_session_maker() as session:
            stock_row = (
                await session.execute(select(Stock).where(Stock.symbol == symbol).limit(1))
            ).scalar_one_or_none()
            price_rows = (
                (
                    await session.execute(
                        select(StockPrice)
                        .where(StockPrice.symbol == symbol)
                        .order_by(desc(StockPrice.time))
                        .limit(PRICE_WINDOW)
                    )
                )
                .scalars()
                .all()
            )
            ratio_row = (
                await session.execute(
                    select(FinancialRatio)
                    .where(FinancialRatio.symbol == symbol)
                    .order_by(
                        desc(FinancialRatio.fiscal_year),
                        desc(FinancialRatio.fiscal_quarter),
                        desc(FinancialRatio.updated_at),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            income_row = (
                await session.execute(
                    select(IncomeStatement)
                    .where(IncomeStatement.symbol == symbol)
                    .order_by(
                        desc(IncomeStatement.fiscal_year),
                        desc(IncomeStatement.fiscal_quarter),
                        desc(IncomeStatement.updated_at),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            balance_row = (
                await session.execute(
                    select(BalanceSheet)
                    .where(BalanceSheet.symbol == symbol)
                    .order_by(
                        desc(BalanceSheet.fiscal_year),
                        desc(BalanceSheet.fiscal_quarter),
                        desc(BalanceSheet.updated_at),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            cash_row = (
                await session.execute(
                    select(CashFlow)
                    .where(CashFlow.symbol == symbol)
                    .order_by(
                        desc(CashFlow.fiscal_year),
                        desc(CashFlow.fiscal_quarter),
                        desc(CashFlow.updated_at),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            news_rows = (
                (
                    await session.execute(
                        select(CompanyNews)
                        .where(CompanyNews.symbol == symbol)
                        .order_by(desc(CompanyNews.published_date), desc(CompanyNews.created_at))
                        .limit(NEWS_LIMIT)
                    )
                )
                .scalars()
                .all()
            )
            foreign_trading_rows = (
                (
                    await session.execute(
                        select(ForeignTrading)
                        .where(ForeignTrading.symbol == symbol)
                        .order_by(desc(ForeignTrading.trade_date), desc(ForeignTrading.updated_at))
                        .limit(FLOW_WINDOW)
                    )
                )
                .scalars()
                .all()
            )
            order_flow_rows = (
                (
                    await session.execute(
                        select(OrderFlowDaily)
                        .where(OrderFlowDaily.symbol == symbol)
                        .order_by(desc(OrderFlowDaily.trade_date), desc(OrderFlowDaily.updated_at))
                        .limit(FLOW_WINDOW)
                    )
                )
                .scalars()
                .all()
            )
            insider_deal_rows = (
                (
                    await session.execute(
                        select(InsiderDeal)
                        .where(InsiderDeal.symbol == symbol)
                        .order_by(desc(InsiderDeal.announce_date), desc(InsiderDeal.created_at))
                        .limit(EVENT_LIMIT)
                    )
                )
                .scalars()
                .all()
            )
            company_event_rows = (
                (
                    await session.execute(
                        select(CompanyEvent)
                        .where(CompanyEvent.symbol == symbol)
                        .order_by(desc(CompanyEvent.event_date), desc(CompanyEvent.updated_at))
                        .limit(EVENT_LIMIT)
                    )
                )
                .scalars()
                .all()
            )
            dividend_rows = (
                (
                    await session.execute(
                        select(Dividend)
                        .where(Dividend.symbol == symbol)
                        .order_by(desc(Dividend.exercise_date), desc(Dividend.cash_year))
                        .limit(EVENT_LIMIT)
                    )
                )
                .scalars()
                .all()
            )

        if not any(
            [
                stock_row,
                price_rows,
                ratio_row,
                income_row,
                balance_row,
                cash_row,
                news_rows,
                foreign_trading_rows,
                order_flow_rows,
                insider_deal_rows,
                company_event_rows,
                dividend_rows,
            ]
        ):
            return None

        price_context = _build_price_context(
            [
                {
                    "time": _iso_value(row.time),
                    "close": row.close,
                    "volume": row.volume,
                }
                for row in price_rows
            ]
        )

        return {
            "symbol": symbol,
            "source": "postgres",
            "company": {
                "symbol": symbol,
                "company_name": getattr(stock_row, "company_name", None),
                "short_name": getattr(stock_row, "short_name", None),
                "exchange": getattr(stock_row, "exchange", None),
                "industry": getattr(stock_row, "industry", None),
                "sector": getattr(stock_row, "sector", None),
                "listing_date": _iso_value(getattr(stock_row, "listing_date", None)),
            }
            if stock_row
            else None,
            "price_context": price_context,
            "ratios": {
                "period": getattr(ratio_row, "period", None),
                "period_type": getattr(ratio_row, "period_type", None),
                "fiscal_year": getattr(ratio_row, "fiscal_year", None),
                "fiscal_quarter": getattr(ratio_row, "fiscal_quarter", None),
                "pe_ratio": getattr(ratio_row, "pe_ratio", None),
                "pb_ratio": getattr(ratio_row, "pb_ratio", None),
                "ps_ratio": getattr(ratio_row, "ps_ratio", None),
                "roe": getattr(ratio_row, "roe", None),
                "roa": getattr(ratio_row, "roa", None),
                "gross_margin": getattr(ratio_row, "gross_margin", None),
                "operating_margin": getattr(ratio_row, "operating_margin", None),
                "net_margin": getattr(ratio_row, "net_margin", None),
                "current_ratio": getattr(ratio_row, "current_ratio", None),
                "debt_to_equity": getattr(ratio_row, "debt_to_equity", None),
                "revenue_growth": getattr(ratio_row, "revenue_growth", None),
                "earnings_growth": getattr(ratio_row, "earnings_growth", None),
                "eps": getattr(ratio_row, "eps", None),
                "bvps": getattr(ratio_row, "bvps", None),
            }
            if ratio_row
            else None,
            "income_statement": {
                "period": getattr(income_row, "period", None),
                "period_type": getattr(income_row, "period_type", None),
                "fiscal_year": getattr(income_row, "fiscal_year", None),
                "fiscal_quarter": getattr(income_row, "fiscal_quarter", None),
                "revenue": getattr(income_row, "revenue", None),
                "gross_profit": getattr(income_row, "gross_profit", None),
                "operating_income": getattr(income_row, "operating_income", None),
                "net_income": getattr(income_row, "net_income", None),
                "eps": getattr(income_row, "eps", None),
            }
            if income_row
            else None,
            "balance_sheet": {
                "period": getattr(balance_row, "period", None),
                "period_type": getattr(balance_row, "period_type", None),
                "fiscal_year": getattr(balance_row, "fiscal_year", None),
                "fiscal_quarter": getattr(balance_row, "fiscal_quarter", None),
                "total_assets": getattr(balance_row, "total_assets", None),
                "total_liabilities": getattr(balance_row, "total_liabilities", None),
                "total_equity": getattr(balance_row, "total_equity", None),
                "cash_and_equivalents": getattr(balance_row, "cash_and_equivalents", None),
                "long_term_debt": getattr(balance_row, "long_term_debt", None),
            }
            if balance_row
            else None,
            "cash_flow": {
                "period": getattr(cash_row, "period", None),
                "period_type": getattr(cash_row, "period_type", None),
                "fiscal_year": getattr(cash_row, "fiscal_year", None),
                "fiscal_quarter": getattr(cash_row, "fiscal_quarter", None),
                "operating_cash_flow": getattr(cash_row, "operating_cash_flow", None),
                "investing_cash_flow": getattr(cash_row, "investing_cash_flow", None),
                "financing_cash_flow": getattr(cash_row, "financing_cash_flow", None),
                "free_cash_flow": getattr(cash_row, "free_cash_flow", None),
                "dividends_paid": getattr(cash_row, "dividends_paid", None),
                "debt_repayment": getattr(cash_row, "debt_repayment", None),
            }
            if cash_row
            else None,
            "recent_news": _build_news_context(
                [
                    {
                        "title": row.title,
                        "summary": row.summary,
                        "source": row.source,
                        "published_date": row.published_date,
                        "url": row.url,
                        "price_change_ratio": row.price_change_ratio,
                    }
                    for row in news_rows
                ]
            ),
            "foreign_trading": _build_flow_context(
                [
                    {
                        "trade_date": row.trade_date,
                        "buy_value": row.buy_value,
                        "sell_value": row.sell_value,
                        "net_value": row.net_value,
                        "buy_volume": row.buy_volume,
                        "sell_volume": row.sell_volume,
                        "net_volume": row.net_volume,
                        "room_available": row.room_available,
                        "room_pct": row.room_pct,
                    }
                    for row in foreign_trading_rows
                ],
                extra_fields=("room_available", "room_pct"),
            ),
            "order_flow": _build_flow_context(
                [
                    {
                        "trade_date": row.trade_date,
                        "buy_value": row.buy_value,
                        "sell_value": row.sell_value,
                        "net_value": row.net_value,
                        "buy_volume": row.buy_volume,
                        "sell_volume": row.sell_volume,
                        "net_volume": row.net_volume,
                        "foreign_net_volume": row.foreign_net_volume,
                        "proprietary_net_volume": row.proprietary_net_volume,
                        "big_order_count": row.big_order_count,
                        "block_trade_count": row.block_trade_count,
                    }
                    for row in order_flow_rows
                ],
                extra_fields=(
                    "foreign_net_volume",
                    "proprietary_net_volume",
                    "big_order_count",
                    "block_trade_count",
                ),
            ),
            "insider_deals": _build_insider_context(
                [
                    {
                        "announce_date": row.announce_date,
                        "deal_action": row.deal_action,
                        "deal_quantity": row.deal_quantity,
                        "deal_price": row.deal_price,
                        "deal_value": row.deal_value,
                        "deal_ratio": row.deal_ratio,
                        "insider_name": row.insider_name,
                        "insider_position": row.insider_position,
                    }
                    for row in insider_deal_rows
                ]
            ),
            "company_events": _build_company_events_context(
                [
                    {
                        "event_type": row.event_type,
                        "event_date": row.event_date,
                        "ex_date": row.ex_date,
                        "record_date": row.record_date,
                        "payment_date": row.payment_date,
                        "value": row.value,
                        "description": row.description,
                    }
                    for row in company_event_rows
                ]
            ),
            "dividends": _build_dividends_context(
                [
                    {
                        "exercise_date": row.exercise_date,
                        "record_date": row.record_date,
                        "payment_date": row.payment_date,
                        "cash_year": row.cash_year,
                        "dividend_rate": row.dividend_rate,
                        "dividend_value": row.dividend_value,
                        "issue_method": row.issue_method,
                    }
                    for row in dividend_rows
                ]
            ),
        }

    async def _build_postgres_market_snapshot(self) -> dict[str, Any] | None:
        async with async_session_maker() as session:
            index_rows: list[StockIndex] = []
            for index_code in MARKET_INDEX_CODES:
                row = (
                    await session.execute(
                        select(StockIndex)
                        .where(StockIndex.index_code == index_code)
                        .order_by(desc(StockIndex.time), desc(StockIndex.created_at))
                        .limit(1)
                    )
                ).scalar_one_or_none()
                if row:
                    index_rows.append(row)

            latest_trade_date = (
                await session.execute(
                    select(SectorPerformance.trade_date)
                    .order_by(desc(SectorPerformance.trade_date))
                    .limit(1)
                )
            ).scalar_one_or_none()

            sector_rows: list[SectorPerformance] = []
            sector_names: dict[str, str] = {}
            if latest_trade_date is not None:
                sector_rows = (
                    (
                        await session.execute(
                            select(SectorPerformance).where(
                                SectorPerformance.trade_date == latest_trade_date
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
            if sector_rows:
                sector_docs = (await session.execute(select(MarketSector))).scalars().all()
                sector_names = {
                    str(doc.sector_code or "").strip().upper(): str(doc.sector_name or "").strip()
                    for doc in sector_docs
                    if str(doc.sector_code or "").strip()
                }

        indices_context = _build_indices_context(
            [
                {
                    "index_code": row.index_code,
                    "time": row.time,
                    "close": row.close,
                    "change": row.change,
                    "change_pct": row.change_pct,
                    "volume": row.volume,
                }
                for row in index_rows
            ]
        )
        sectors_context = _build_sector_context(
            [
                {
                    "sector_code": row.sector_code,
                    "trade_date": row.trade_date,
                    "change_pct": row.change_pct,
                    "advance_count": row.advance_count,
                    "decline_count": row.decline_count,
                    "unchanged_count": row.unchanged_count,
                    "top_gainer_symbol": row.top_gainer_symbol,
                    "top_gainer_change": row.top_gainer_change,
                    "top_loser_symbol": row.top_loser_symbol,
                    "top_loser_change": row.top_loser_change,
                }
                for row in sector_rows
            ],
            sector_names,
        )
        if not indices_context and not sectors_context:
            return None

        return {
            "source": "postgres",
            "indices": indices_context,
            "sectors": sectors_context,
        }


ai_context_service = AIContextService()
