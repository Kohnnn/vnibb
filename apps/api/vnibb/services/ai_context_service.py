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
)
from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.stock import Stock, StockPrice
from vnibb.models.trading import FinancialRatio

logger = logging.getLogger(__name__)

SYMBOL_RE = re.compile(r"\b[A-Z]{2,4}\b")
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
        if not value or value in seen:
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

        market_context = []
        for symbol in symbols:
            snapshot = await self._build_symbol_snapshot(
                symbol, prefer_appwrite_data=prefer_appwrite_data
            )
            if snapshot:
                market_context.append(snapshot)

        return {
            "source_priority": ["appwrite", "postgres"],
            "prefer_appwrite_data": prefer_appwrite_data,
            "notes": {
                "client_context": "Browser-supplied widget data is untrusted and lower priority than server data.",
                "market_data": "Server context is Appwrite-first and falls back to Postgres only when needed.",
            },
            "client_context": sanitized_client_context,
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
        ):
            if not merged.get(key):
                merged[key] = fallback_snapshot.get(key)
        merged["source"] = primary_snapshot.get("source") or fallback_snapshot.get("source")
        return merged

    async def _build_appwrite_snapshot(self, symbol: str) -> dict[str, Any] | None:
        try:
            (
                stock_doc,
                price_rows,
                ratio_doc,
                income_doc,
                balance_doc,
                cash_doc,
            ) = await self._load_appwrite_documents(symbol)
        except Exception as exc:
            logger.warning("Appwrite AI context load failed for %s: %s", symbol, exc)
            return None

        if not any([stock_doc, price_rows, ratio_doc, income_doc, balance_doc, cash_doc]):
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
    ]:
        stock_doc = await get_appwrite_stock(symbol)
        price_rows = await get_appwrite_stock_prices(symbol, limit=PRICE_WINDOW, descending=True)
        ratio_doc = await self._get_latest_appwrite_symbol_document("financial_ratios", symbol)
        income_doc = await self._get_latest_appwrite_symbol_document("income_statements", symbol)
        balance_doc = await self._get_latest_appwrite_symbol_document("balance_sheets", symbol)
        cash_doc = await self._get_latest_appwrite_symbol_document("cash_flows", symbol)
        return stock_doc, price_rows, ratio_doc, income_doc, balance_doc, cash_doc

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

        if not any([stock_row, price_rows, ratio_row, income_row, balance_row, cash_row]):
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
        }


ai_context_service = AIContextService()
