from __future__ import annotations

import argparse
import json
import logging
import re
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from mcp.server.fastmcp import FastMCP

from vnibb.core.appwrite_client import (
    appwrite_runtime_summary,
    check_appwrite_connectivity,
    get_appwrite_stock_prices,
    list_appwrite_documents,
    list_appwrite_documents_paginated,
)
from vnibb.core.config import settings
from vnibb.core.logging_config import setup_logging
from vnibb.services.ai_context_service import AIContextService, sanitize_context_value
from vnibb.services.mongo_market_data_service import get_mongo_market_data_service

logger = logging.getLogger(__name__)

MCP_INSTRUCTIONS = """
VNIBB read-only MCP server for Appwrite-backed Vietnam market research.

Use this server to read curated VNIBB market data from Appwrite without mutating the database.

Guardrails:
- Prefer `get_symbol_snapshot` and `get_market_snapshot` before low-level collection queries.
- Treat `query_appwrite_collection` as a narrow escape hatch, not the first choice.
- For deep analytical history (EOD prices, fundamentals, intraday, macro), use the MongoDB-backed
  tools: `get_eod_price_history`, `get_premium_dataset`, `get_intraday_trades`, `get_price_depth`.
  Call `list_premium_datasets` to discover allowlisted dataset names.
- This server is intentionally read-only. It does not expose admin, write, delete, backfill, or schema-mutation tools.
- User-owned and operationally sensitive collections are intentionally excluded.
- Include freshness and source notes when summarizing data for downstream agents.
""".strip()

ROADMAP_WARNING = """
VNIBB MCP intentionally excludes write/admin tools in this branch.

Roadmap only:
- dashboard mutations
- watchlist mutations
- Appwrite document writes
- sync/backfill triggers
- admin/data-ops controls

These are dangerous because they can alter user state, trigger expensive jobs,
or expose sensitive operational surfaces. Keep them out of public/read-only MCP deployments.
""".strip()

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class CollectionSpec:
    collection: str
    description: str
    default_order: str
    default_desc: bool
    max_limit: int
    date_field: str | None
    allowed_filters: tuple[str, ...]
    allowed_sort_fields: tuple[str, ...]


COLLECTION_SPECS: dict[str, CollectionSpec] = {
    "stocks": CollectionSpec(
        collection="stocks",
        description="Master stock list with company, exchange, industry, and sector fields.",
        default_order="symbol",
        default_desc=False,
        max_limit=100,
        date_field=None,
        allowed_filters=("symbol", "exchange", "industry", "sector"),
        allowed_sort_fields=("symbol", "exchange", "industry", "sector", "company_name"),
    ),
    "stock_prices": CollectionSpec(
        collection="stock_prices",
        description="Historical OHLCV rows keyed by symbol, time, and interval.",
        default_order="time",
        default_desc=True,
        max_limit=250,
        date_field="time",
        allowed_filters=("symbol", "interval"),
        allowed_sort_fields=("time", "close", "volume", "value"),
    ),
    "stock_indices": CollectionSpec(
        collection="stock_indices",
        description="Index snapshots such as VNINDEX, VN30, HNX, and UPCOM.",
        default_order="time",
        default_desc=True,
        max_limit=50,
        date_field="time",
        allowed_filters=("index_code",),
        allowed_sort_fields=("time", "close", "change_pct"),
    ),
    "income_statements": CollectionSpec(
        collection="income_statements",
        description="Quarterly and annual income statements.",
        default_order="fiscal_year",
        default_desc=True,
        max_limit=20,
        date_field=None,
        allowed_filters=("symbol", "period_type"),
        allowed_sort_fields=("fiscal_year", "fiscal_quarter", "revenue", "net_income"),
    ),
    "balance_sheets": CollectionSpec(
        collection="balance_sheets",
        description="Quarterly and annual balance sheets.",
        default_order="fiscal_year",
        default_desc=True,
        max_limit=20,
        date_field=None,
        allowed_filters=("symbol", "period_type"),
        allowed_sort_fields=("fiscal_year", "fiscal_quarter", "total_assets", "total_equity"),
    ),
    "cash_flows": CollectionSpec(
        collection="cash_flows",
        description="Quarterly and annual cash flow statements.",
        default_order="fiscal_year",
        default_desc=True,
        max_limit=20,
        date_field=None,
        allowed_filters=("symbol", "period_type"),
        allowed_sort_fields=(
            "fiscal_year",
            "fiscal_quarter",
            "operating_cash_flow",
            "free_cash_flow",
        ),
    ),
    "financial_ratios": CollectionSpec(
        collection="financial_ratios",
        description="Pre-calculated valuation, profitability, and leverage ratios.",
        default_order="fiscal_year",
        default_desc=True,
        max_limit=20,
        date_field=None,
        allowed_filters=("symbol", "period_type"),
        allowed_sort_fields=("fiscal_year", "fiscal_quarter", "pe_ratio", "pb_ratio", "roe", "roa"),
    ),
    "company_news": CollectionSpec(
        collection="company_news",
        description="Company-specific news articles.",
        default_order="published_date",
        default_desc=True,
        max_limit=25,
        date_field="published_date",
        allowed_filters=("symbol", "source"),
        allowed_sort_fields=("published_date", "source"),
    ),
    "company_events": CollectionSpec(
        collection="company_events",
        description="Corporate events such as AGM, dividends, and splits.",
        default_order="event_date",
        default_desc=True,
        max_limit=25,
        date_field="event_date",
        allowed_filters=("symbol", "event_type"),
        allowed_sort_fields=("event_date", "event_type", "record_date", "payment_date"),
    ),
    "dividends": CollectionSpec(
        collection="dividends",
        description="Dividend history and exercise dates.",
        default_order="exercise_date",
        default_desc=True,
        max_limit=25,
        date_field="exercise_date",
        allowed_filters=("symbol",),
        allowed_sort_fields=("exercise_date", "payment_date", "dividend_rate", "dividend_value"),
    ),
    "insider_deals": CollectionSpec(
        collection="insider_deals",
        description="Insider trading transactions and announcements.",
        default_order="announce_date",
        default_desc=True,
        max_limit=25,
        date_field="announce_date",
        allowed_filters=("symbol",),
        allowed_sort_fields=("announce_date", "deal_value", "deal_quantity", "deal_price"),
    ),
    "foreign_trading": CollectionSpec(
        collection="foreign_trading",
        description="Daily foreign trading aggregates.",
        default_order="trade_date",
        default_desc=True,
        max_limit=60,
        date_field="trade_date",
        allowed_filters=("symbol",),
        allowed_sort_fields=("trade_date", "net_value", "net_volume", "buy_value", "sell_value"),
    ),
    "order_flow_daily": CollectionSpec(
        collection="order_flow_daily",
        description="Daily order flow and large-order summaries.",
        default_order="trade_date",
        default_desc=True,
        max_limit=60,
        date_field="trade_date",
        allowed_filters=("symbol",),
        allowed_sort_fields=(
            "trade_date",
            "net_volume",
            "buy_value",
            "sell_value",
            "big_order_count",
        ),
    ),
    "market_sectors": CollectionSpec(
        collection="market_sectors",
        description="Sector taxonomy and parent-child relationships.",
        default_order="sector_code",
        default_desc=False,
        max_limit=100,
        date_field=None,
        allowed_filters=(),
        allowed_sort_fields=("sector_code", "sector_name", "parent_code"),
    ),
    "sector_performance": CollectionSpec(
        collection="sector_performance",
        description="Sector-level daily performance metrics.",
        default_order="trade_date",
        default_desc=True,
        max_limit=50,
        date_field="trade_date",
        allowed_filters=(),
        allowed_sort_fields=("trade_date", "change_pct", "volume", "value"),
    ),
    "screener_snapshots": CollectionSpec(
        collection="screener_snapshots",
        description="Derived screener snapshots used by the workspace.",
        default_order="snapshot_date",
        default_desc=True,
        max_limit=100,
        date_field="snapshot_date",
        allowed_filters=("symbol", "exchange", "industry", "sector"),
        allowed_sort_fields=("snapshot_date", "market_cap", "rs_rating", "volume", "value"),
    ),
}

STATEMENT_COLLECTIONS = {
    "income": "income_statements",
    "income_statement": "income_statements",
    "balance": "balance_sheets",
    "balance_sheet": "balance_sheets",
    "cash": "cash_flows",
    "cash_flow": "cash_flows",
}

MARKET_INDEX_CODES = ("VNINDEX", "VN30", "HNX", "UPCOM")


@dataclass(frozen=True)
class PremiumDatasetSpec:
    """Allowlist entry for a MongoDB-backed vnstock premium dataset.

    These datasets live in the shared `market_vnstock_premium_records` collection
    on the private (Tailscale) MongoDB host. Each is identified by its `dataset`
    field value, which matches the canonical names written by the catalog backfill.
    """

    dataset: str
    description: str
    max_limit: int
    scope_type: str = "symbol"


# Curated, read-only allowlist for the generic `get_premium_dataset` tool.
# Disabled/empty source datasets are intentionally excluded:
# company.capital_history, company.insider_deals, equity.block_trades,
# equity.put_through, and the legacy quote.* names.
PREMIUM_DATASET_SPECS: dict[str, PremiumDatasetSpec] = {
    spec.dataset: spec
    for spec in (
        # Fundamentals
        PremiumDatasetSpec("finance.ratio", "Financial ratios (year + quarter).", 200),
        PremiumDatasetSpec("finance.income_statement", "Income statements (year + quarter).", 200),
        PremiumDatasetSpec("finance.balance_sheet", "Balance sheets (year + quarter).", 200),
        PremiumDatasetSpec("finance.cash_flow", "Cash flow statements (year + quarter).", 200),
        # Company reference
        PremiumDatasetSpec("company.info", "Company profile and metadata.", 20),
        PremiumDatasetSpec("company.events", "Corporate events.", 200),
        PremiumDatasetSpec("company.officers", "Company officers/management.", 200),
        PremiumDatasetSpec("company.subsidiaries", "Company subsidiaries.", 200),
        PremiumDatasetSpec("company.affiliate", "Company affiliates.", 200),
        PremiumDatasetSpec("company.news", "Company news records.", 200),
        PremiumDatasetSpec("reference.shareholders", "Major shareholders.", 200),
        # Equity market datasets
        PremiumDatasetSpec("equity.summary", "Equity summary snapshot.", 20),
        PremiumDatasetSpec("equity.session_stats", "Equity session statistics.", 60),
        PremiumDatasetSpec("equity.foreign_flow", "Foreign trading flow history.", 500),
        PremiumDatasetSpec("equity.trade_history", "Equity trade history.", 500),
        PremiumDatasetSpec("equity.proprietary_flow", "Proprietary trading flow.", 200),
        PremiumDatasetSpec("equity.quote", "Latest equity quote snapshot.", 60),
        PremiumDatasetSpec("equity.intraday", "Intraday tick trades (bounded symbols).", 1000),
        PremiumDatasetSpec("equity.trades", "Matched trades (bounded symbols).", 1000),
        PremiumDatasetSpec("equity.price_depth", "Volume-at-price depth.", 500),
        PremiumDatasetSpec("equity.order_book", "Order book snapshot.", 200),
        PremiumDatasetSpec("equity.matched_by_price", "Matched volume by price.", 500),
        PremiumDatasetSpec("equity.odd_lot", "Odd-lot session data.", 200),
        PremiumDatasetSpec("equity.volume_profile", "Volume profile by price.", 500),
        # Valuation
        PremiumDatasetSpec("market.pe", "Market P/E series.", 200),
        PremiumDatasetSpec("market.pb", "Market P/B series.", 200),
        PremiumDatasetSpec("market.evaluation", "Market valuation evaluation.", 200),
        PremiumDatasetSpec("analytics.valuation.pe", "Analytics valuation P/E.", 200),
        PremiumDatasetSpec("analytics.valuation.pb", "Analytics valuation P/B.", 200),
        # Macro series (market-scope)
        PremiumDatasetSpec("macro.gdp", "Macro GDP series.", 500, scope_type="market"),
        PremiumDatasetSpec("macro.cpi", "Macro CPI series.", 500, scope_type="market"),
        PremiumDatasetSpec("macro.exchange_rate", "Macro exchange-rate series.", 500, scope_type="market"),
        PremiumDatasetSpec("macro.interest_rate", "Macro interest-rate series.", 200, scope_type="market"),
        PremiumDatasetSpec("macro.money_supply", "Macro money-supply series.", 500, scope_type="market"),
        PremiumDatasetSpec("macro.fdi", "Macro FDI series.", 500, scope_type="market"),
        PremiumDatasetSpec("macro.import_export", "Macro import/export series.", 500, scope_type="market"),
        PremiumDatasetSpec("macro.industry_prod", "Macro industrial-production series.", 500, scope_type="market"),
        PremiumDatasetSpec("macro.population_labor", "Macro population/labor series.", 300, scope_type="market"),
        PremiumDatasetSpec("macro.retail", "Macro retail series.", 500, scope_type="market"),
    )
}


def _ensure_mongo_available() -> None:
    if not get_mongo_market_data_service().enabled:
        raise RuntimeError(
            "MongoDB analytical source is not configured for VNIBB MCP "
            "(set MONGODB_ENABLED and MONGODB_URL)"
        )


def _normalize_dataset_name(dataset: str) -> str:
    return str(dataset or "").strip().lower()


def _serialize_premium_dataset_specs() -> list[dict[str, Any]]:
    return [
        {
            "dataset": spec.dataset,
            "description": spec.description,
            "max_limit": spec.max_limit,
            "scope_type": spec.scope_type,
            "read_only": True,
        }
        for spec in sorted(PREMIUM_DATASET_SPECS.values(), key=lambda item: item.dataset)
    ]


def normalize_symbol_input(symbol: str) -> str:
    raw = str(symbol or "").strip().upper()
    if not raw:
        return ""

    tokens = [token for token in re.split(r"[^A-Z0-9]+", raw) if token]
    if not tokens:
        return raw
    if ":" in raw and len(tokens) > 1:
        return tokens[-1]
    return tokens[0]


def normalize_collection_name(collection: str) -> str:
    return str(collection or "").strip().lower()


def parse_iso_date(value: str | None) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if not DATE_RE.fullmatch(text):
        raise ValueError("Dates must use YYYY-MM-DD format")
    return datetime.strptime(text, "%Y-%m-%d").date()


def _date_start_iso(value: date) -> str:
    return datetime.combine(value, datetime.min.time()).isoformat(timespec="milliseconds") + "Z"


def _date_end_iso(value: date) -> str:
    return datetime.combine(value, datetime.max.time()).isoformat(timespec="milliseconds") + "Z"


def _query_equal(attribute: str, values: list[Any]) -> dict[str, Any]:
    return {"method": "equal", "attribute": attribute, "values": values}


def _query_limit(value: int) -> dict[str, Any]:
    return {"method": "limit", "values": [int(value)]}


def _query_order(attribute: str, descending: bool = False) -> dict[str, Any]:
    return {"method": "orderDesc" if descending else "orderAsc", "attribute": attribute}


def _query_gte(attribute: str, value: str) -> dict[str, Any]:
    return {"method": "greaterThanEqual", "attribute": attribute, "values": [value]}


def _query_lte(attribute: str, value: str) -> dict[str, Any]:
    return {"method": "lessThanEqual", "attribute": attribute, "values": [value]}


def _coerce_limit(requested_limit: int, max_limit: int) -> int:
    return max(1, min(int(requested_limit), int(max_limit)))


def _normalize_filter_value(key: str, value: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"Filter '{key}' cannot be empty")

    if key == "symbol":
        normalized = normalize_symbol_input(text)
        if not normalized:
            raise ValueError("A valid stock symbol is required")
        return normalized

    if key in {
        "exchange",
        "industry",
        "sector",
        "interval",
        "period_type",
        "source",
        "event_type",
        "index_code",
    }:
        return (
            text.upper() if key in {"exchange", "interval", "period_type", "index_code"} else text
        )

    return text


def build_collection_queries(
    *,
    collection: str,
    symbol: str | None = None,
    exchange: str | None = None,
    industry: str | None = None,
    sector: str | None = None,
    interval: str | None = None,
    period_type: str | None = None,
    source: str | None = None,
    event_type: str | None = None,
    index_code: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 20,
    sort_by: str | None = None,
    descending: bool | None = None,
) -> tuple[CollectionSpec, list[dict[str, Any]], dict[str, Any], int]:
    normalized_collection = normalize_collection_name(collection)
    spec = COLLECTION_SPECS.get(normalized_collection)
    if spec is None:
        raise ValueError(f"Collection '{collection}' is not enabled for VNIBB MCP")

    raw_filters = {
        "symbol": symbol,
        "exchange": exchange,
        "industry": industry,
        "sector": sector,
        "interval": interval,
        "period_type": period_type,
        "source": source,
        "event_type": event_type,
        "index_code": index_code,
    }

    queries: list[dict[str, Any]] = []
    applied_filters: dict[str, Any] = {}

    for key, value in raw_filters.items():
        if value is None or str(value).strip() == "":
            continue
        if key not in spec.allowed_filters:
            raise ValueError(
                f"Collection '{spec.collection}' does not support filter '{key}' in read-only MCP"
            )
        normalized_value = _normalize_filter_value(key, value)
        queries.append(_query_equal(key, [normalized_value]))
        applied_filters[key] = normalized_value

    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    if start and end and start > end:
        raise ValueError("start_date cannot be later than end_date")
    if (start or end) and not spec.date_field:
        raise ValueError(f"Collection '{spec.collection}' does not support date range filters")
    if start and spec.date_field:
        queries.append(_query_gte(spec.date_field, _date_start_iso(start)))
        applied_filters["start_date"] = start.isoformat()
    if end and spec.date_field:
        queries.append(_query_lte(spec.date_field, _date_end_iso(end)))
        applied_filters["end_date"] = end.isoformat()

    requested_sort = str(sort_by or spec.default_order).strip()
    if requested_sort not in spec.allowed_sort_fields:
        raise ValueError(
            f"Collection '{spec.collection}' does not support sort field '{requested_sort}'"
        )

    effective_desc = spec.default_desc if descending is None else bool(descending)
    queries.append(_query_order(requested_sort, descending=effective_desc))

    bounded_limit = _coerce_limit(limit, spec.max_limit)
    queries.append(_query_limit(bounded_limit))
    applied_filters["sort_by"] = requested_sort
    applied_filters["descending"] = effective_desc

    return spec, queries, applied_filters, bounded_limit


def _serialize_collection_specs() -> dict[str, Any]:
    return {
        name: {
            **asdict(spec),
            "guardrails": {
                "read_only": True,
                "max_limit": spec.max_limit,
                "user_owned_data_excluded": True,
            },
        }
        for name, spec in COLLECTION_SPECS.items()
    }


def read_guardrails_resource() -> str:
    return ROADMAP_WARNING


async def query_appwrite_collection_data(
    *,
    collection: str,
    symbol: str | None = None,
    exchange: str | None = None,
    industry: str | None = None,
    sector: str | None = None,
    interval: str | None = None,
    period_type: str | None = None,
    source: str | None = None,
    event_type: str | None = None,
    index_code: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 20,
    sort_by: str | None = None,
    descending: bool | None = None,
) -> dict[str, Any]:
    spec, queries, applied_filters, bounded_limit = build_collection_queries(
        collection=collection,
        symbol=symbol,
        exchange=exchange,
        industry=industry,
        sector=sector,
        interval=interval,
        period_type=period_type,
        source=source,
        event_type=event_type,
        index_code=index_code,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        sort_by=sort_by,
        descending=descending,
    )

    rows = await list_appwrite_documents_paginated(
        spec.collection,
        queries=queries,
        page_size=min(bounded_limit, 100),
        max_documents=bounded_limit,
    )

    return {
        "collection": spec.collection,
        "description": spec.description,
        "filters_applied": applied_filters,
        "row_count": len(rows),
        "items": sanitize_context_value(rows),
    }


async def _get_latest_symbol_document(
    collection_id: str,
    symbol: str,
    *,
    period_type: str | None = None,
) -> dict[str, Any] | None:
    queries = [_query_equal("symbol", [normalize_symbol_input(symbol)])]
    if period_type:
        queries.append(
            _query_equal("period_type", [_normalize_filter_value("period_type", period_type)])
        )
    queries.extend(
        [
            _query_order("fiscal_year", descending=True),
            _query_order("fiscal_quarter", descending=True),
            _query_limit(1),
        ]
    )
    docs = await list_appwrite_documents(collection_id, queries=queries)
    return docs[0] if docs else None


async def _get_symbol_rows(
    collection_id: str,
    symbol: str,
    *,
    order_attribute: str,
    limit: int,
) -> list[dict[str, Any]]:
    return await list_appwrite_documents(
        collection_id,
        queries=[
            _query_equal("symbol", [normalize_symbol_input(symbol)]),
            _query_order(order_attribute, descending=True),
            _query_limit(limit),
        ],
    )


def _ensure_appwrite_available() -> None:
    if not settings.is_appwrite_configured:
        raise RuntimeError("Appwrite is not configured for VNIBB MCP")


def _build_transport_security() -> Any:
    """Build streamable-HTTP transport security from settings.

    By default the MCP SDK enforces DNS-rebinding protection and only accepts
    `localhost`/`127.0.0.1` Host headers. To let trusted machines (e.g. Tailscale
    peers) connect directly to the published port, set VNIBB_MCP_ALLOWED_HOSTS /
    VNIBB_MCP_ALLOWED_ORIGINS. When neither is set, defaults are preserved.
    """
    allowed_hosts = list(settings.vnibb_mcp_allowed_hosts or [])
    allowed_origins = list(settings.vnibb_mcp_allowed_origins or [])
    if not allowed_hosts and not allowed_origins:
        return None

    try:
        from mcp.server.transport_security import TransportSecuritySettings
    except Exception:  # pragma: no cover - depends on SDK version
        logger.warning(
            "mcp.server.transport_security unavailable; ignoring MCP allowlist settings"
        )
        return None

    # Always keep loopback so the Caddy reverse proxy (Host: localhost:8001) works.
    default_hosts = ["localhost", "localhost:8001", "127.0.0.1", "127.0.0.1:8001"]
    default_origins = ["http://localhost", "http://localhost:8001", "http://127.0.0.1", "http://127.0.0.1:8001"]
    merged_hosts = sorted({*default_hosts, *allowed_hosts})
    merged_origins = sorted({*default_origins, *allowed_origins})
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=merged_hosts,
        allowed_origins=merged_origins,
    )


mcp = FastMCP(
    name="VNIBB Read-Only MCP",
    instructions=MCP_INSTRUCTIONS,
    json_response=True,
    stateless_http=True,
    transport_security=_build_transport_security(),
)


@mcp.resource("vnibb://mcp/guardrails")
def resource_guardrails() -> str:
    """Read-only MCP guardrails and the intentionally dangerous roadmap items."""
    return read_guardrails_resource()


@mcp.resource("vnibb://appwrite/collections")
def resource_supported_collections() -> str:
    """Supported Appwrite collection metadata for the VNIBB read-only MCP."""
    return json.dumps(_serialize_collection_specs(), indent=2, sort_keys=True)


@mcp.resource("vnibb://mongo/datasets")
def resource_premium_datasets() -> str:
    """Supported MongoDB vnstock premium dataset metadata for the VNIBB read-only MCP."""
    return json.dumps(_serialize_premium_dataset_specs(), indent=2, sort_keys=True)


@mcp.resource("vnibb://appwrite/schema/{collection}")
def resource_collection_schema(collection: str) -> str:
    """Return the MCP-facing metadata for one supported Appwrite collection."""
    normalized = normalize_collection_name(collection)
    spec = COLLECTION_SPECS.get(normalized)
    if spec is None:
        raise ValueError(f"Collection '{collection}' is not enabled for VNIBB MCP")
    return json.dumps({normalized: {**asdict(spec), "read_only": True}}, indent=2, sort_keys=True)


@mcp.prompt()
def symbol_deep_dive(symbol: str) -> str:
    """Prompt template for an Appwrite-first VNIBB symbol review."""
    normalized = normalize_symbol_input(symbol)
    return (
        f"Analyze {normalized} using VNIBB's read-only Appwrite MCP. Start with `get_symbol_snapshot`, "
        f"then validate price action with `get_symbol_prices`, recent catalysts with `get_company_news`, "
        f"and any event timeline details with `get_corporate_timeline`. Keep the answer evidence-first and "
        f"mention freshness where relevant."
    )


@mcp.prompt()
def market_brief() -> str:
    """Prompt template for a market-open or market-close brief."""
    return (
        "Generate a VNIBB market brief using `get_market_snapshot` first. If one sector or symbol needs "
        "deeper evidence, follow up with `get_symbol_snapshot` or `query_appwrite_collection`. Do not invent "
        "data that is not present in Appwrite."
    )


@mcp.prompt()
def appwrite_collection_audit(collection: str, symbol: str | None = None) -> str:
    """Prompt template for safe collection-level inspection."""
    normalized_collection = normalize_collection_name(collection)
    normalized_symbol = normalize_symbol_input(symbol or "")
    if normalized_symbol:
        return (
            f"Audit the `{normalized_collection}` Appwrite collection for `{normalized_symbol}` using "
            "`query_appwrite_collection`. Summarize what fields are present, what looks fresh, and any obvious "
            "coverage gaps. Stay read-only."
        )
    return (
        f"Audit the `{normalized_collection}` Appwrite collection using `list_supported_collections` and "
        "`query_appwrite_collection`. Stay read-only and note any operational caveats."
    )


@mcp.tool()
def list_supported_collections() -> dict[str, Any]:
    """List the Appwrite collections intentionally exposed by the read-only VNIBB MCP."""
    return {
        "server": "VNIBB Read-Only MCP",
        "read_only": True,
        "collections": _serialize_collection_specs(),
        "roadmap_warning": ROADMAP_WARNING,
    }


@mcp.tool()
async def get_appwrite_status() -> dict[str, Any]:
    """Check Appwrite connectivity and return a non-sensitive runtime summary."""
    connectivity = await check_appwrite_connectivity()
    return {
        "connectivity": connectivity,
        "runtime": appwrite_runtime_summary(),
        "read_only": True,
    }


@mcp.tool()
async def get_symbol_snapshot(symbol: str) -> dict[str, Any]:
    """Get a rich Appwrite-first symbol snapshot across prices, ratios, statements, news, and flows."""
    _ensure_appwrite_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    service = AIContextService()
    snapshot = await service._build_appwrite_snapshot(normalized, use_vnibb_mcp=False)
    if snapshot is None:
        return {
            "symbol": normalized,
            "source": "appwrite",
            "found": False,
            "message": "No Appwrite snapshot was found for this symbol.",
        }

    return {
        "symbol": normalized,
        "source": "appwrite",
        "found": True,
        "snapshot": sanitize_context_value(snapshot),
    }


@mcp.tool()
async def get_market_snapshot() -> dict[str, Any]:
    """Get the current Appwrite-backed market snapshot for key VN indices and sectors."""
    _ensure_appwrite_available()
    service = AIContextService()
    snapshot = await service._build_appwrite_market_snapshot(use_vnibb_mcp=False)
    return {
        "source": "appwrite",
        "indices_expected": list(MARKET_INDEX_CODES),
        "snapshot": sanitize_context_value(snapshot or {}),
    }


@mcp.tool()
async def get_symbol_prices(
    symbol: str,
    interval: str = "1D",
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 60,
    descending: bool = False,
) -> dict[str, Any]:
    """Get Appwrite OHLCV rows for one symbol and interval."""
    _ensure_appwrite_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    bounded_limit = _coerce_limit(limit, COLLECTION_SPECS["stock_prices"].max_limit)
    rows = await get_appwrite_stock_prices(
        normalized,
        interval=_normalize_filter_value("interval", interval),
        start_date=parse_iso_date(start_date),
        end_date=parse_iso_date(end_date),
        limit=bounded_limit,
        descending=descending,
    )

    return {
        "symbol": normalized,
        "interval": _normalize_filter_value("interval", interval),
        "row_count": len(rows),
        "start_date": start_date,
        "end_date": end_date,
        "items": sanitize_context_value(rows),
    }


@mcp.tool()
async def get_latest_financial_statement(
    symbol: str,
    statement: str = "income_statement",
    period_type: str | None = None,
) -> dict[str, Any]:
    """Get the latest Appwrite financial statement row for a symbol."""
    _ensure_appwrite_available()
    normalized_symbol = normalize_symbol_input(symbol)
    if not normalized_symbol:
        raise ValueError("A stock symbol is required")

    statement_key = str(statement or "").strip().lower()
    collection_id = STATEMENT_COLLECTIONS.get(statement_key)
    if collection_id is None:
        raise ValueError("statement must be one of: income_statement, balance_sheet, cash_flow")

    row = await _get_latest_symbol_document(
        collection_id, normalized_symbol, period_type=period_type
    )
    return {
        "symbol": normalized_symbol,
        "statement": statement_key,
        "collection": collection_id,
        "period_type": _normalize_filter_value("period_type", period_type) if period_type else None,
        "item": sanitize_context_value(row or {}),
        "found": row is not None,
    }


@mcp.tool()
async def get_latest_financial_ratios(
    symbol: str, period_type: str | None = None
) -> dict[str, Any]:
    """Get the latest Appwrite financial ratio row for a symbol."""
    _ensure_appwrite_available()
    normalized_symbol = normalize_symbol_input(symbol)
    if not normalized_symbol:
        raise ValueError("A stock symbol is required")

    row = await _get_latest_symbol_document(
        "financial_ratios", normalized_symbol, period_type=period_type
    )
    return {
        "symbol": normalized_symbol,
        "collection": "financial_ratios",
        "period_type": _normalize_filter_value("period_type", period_type) if period_type else None,
        "item": sanitize_context_value(row or {}),
        "found": row is not None,
    }


@mcp.tool()
async def get_company_news(symbol: str, limit: int = 10) -> dict[str, Any]:
    """Get recent Appwrite company news rows for one symbol."""
    _ensure_appwrite_available()
    normalized_symbol = normalize_symbol_input(symbol)
    if not normalized_symbol:
        raise ValueError("A stock symbol is required")

    bounded_limit = _coerce_limit(limit, COLLECTION_SPECS["company_news"].max_limit)
    rows = await _get_symbol_rows(
        "company_news",
        normalized_symbol,
        order_attribute="published_date",
        limit=bounded_limit,
    )
    return {
        "symbol": normalized_symbol,
        "row_count": len(rows),
        "items": sanitize_context_value(rows),
    }


@mcp.tool()
async def get_corporate_timeline(symbol: str, limit: int = 15) -> dict[str, Any]:
    """Get a merged Appwrite timeline across company events, dividends, and insider deals."""
    _ensure_appwrite_available()
    normalized_symbol = normalize_symbol_input(symbol)
    if not normalized_symbol:
        raise ValueError("A stock symbol is required")

    bounded_limit = _coerce_limit(limit, 30)
    event_rows, dividend_rows, insider_rows = await _gather_corporate_timeline_rows(
        normalized_symbol,
        bounded_limit,
    )

    timeline: list[dict[str, Any]] = []
    for row in event_rows:
        timeline.append(
            {
                "kind": "company_event",
                "date": row.get("event_date"),
                "label": row.get("event_type") or row.get("title") or "Event",
                "payload": row,
            }
        )
    for row in dividend_rows:
        timeline.append(
            {
                "kind": "dividend",
                "date": row.get("exercise_date") or row.get("payment_date"),
                "label": row.get("issue_method") or "Dividend",
                "payload": row,
            }
        )
    for row in insider_rows:
        timeline.append(
            {
                "kind": "insider_deal",
                "date": row.get("announce_date"),
                "label": row.get("deal_action") or row.get("deal_method") or "Insider deal",
                "payload": row,
            }
        )

    timeline.sort(key=lambda item: str(item.get("date") or ""), reverse=True)
    timeline = timeline[:bounded_limit]

    return {
        "symbol": normalized_symbol,
        "row_count": len(timeline),
        "items": sanitize_context_value(timeline),
    }


async def _gather_corporate_timeline_rows(
    symbol: str,
    limit: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    event_rows = await _get_symbol_rows(
        "company_events", symbol, order_attribute="event_date", limit=limit
    )
    dividend_rows = await _get_symbol_rows(
        "dividends", symbol, order_attribute="exercise_date", limit=limit
    )
    insider_rows = await _get_symbol_rows(
        "insider_deals", symbol, order_attribute="announce_date", limit=limit
    )
    return event_rows, dividend_rows, insider_rows


@mcp.tool()
async def query_appwrite_collection(
    collection: str,
    symbol: str | None = None,
    exchange: str | None = None,
    industry: str | None = None,
    sector: str | None = None,
    interval: str | None = None,
    period_type: str | None = None,
    source: str | None = None,
    event_type: str | None = None,
    index_code: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 20,
    sort_by: str | None = None,
    descending: bool | None = None,
) -> dict[str, Any]:
    """Read a supported Appwrite collection with strict VNIBB read-only guardrails."""
    _ensure_appwrite_available()
    return await query_appwrite_collection_data(
        collection=collection,
        symbol=symbol,
        exchange=exchange,
        industry=industry,
        sector=sector,
        interval=interval,
        period_type=period_type,
        source=source,
        event_type=event_type,
        index_code=index_code,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        sort_by=sort_by,
        descending=descending,
    )


@mcp.tool()
async def get_mongo_status() -> dict[str, Any]:
    """Check the read-only MongoDB analytical source and summarize available collections.

    The MongoDB source holds the full vnstock premium corpus (EOD prices and the
    shared `market_vnstock_premium_records` datasets) on a private Tailscale host.
    """
    service = get_mongo_market_data_service()
    if not service.enabled:
        return {
            "enabled": False,
            "read_only": True,
            "message": "MongoDB analytical source is not configured (MONGODB_ENABLED / MONGODB_URL).",
        }
    collections = await service.inspect_collections(sample_limit=1)
    return {
        "enabled": True,
        "read_only": True,
        "database": settings.mongodb_database,
        "collections": sanitize_context_value(collections),
    }


@mcp.tool()
def list_premium_datasets() -> dict[str, Any]:
    """List the MongoDB vnstock premium datasets exposed by `get_premium_dataset`."""
    return {
        "server": "VNIBB Read-Only MCP",
        "read_only": True,
        "source": "mongodb:market_vnstock_premium_records",
        "datasets": _serialize_premium_dataset_specs(),
    }


@mcp.tool()
async def get_eod_price_history(
    symbol: str,
    lookback_days: int = 365,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 1000,
) -> dict[str, Any]:
    """Get read-only end-of-day OHLCV history for one symbol from MongoDB.

    Provide either `lookback_days` (default 365) or an explicit `start_date`/`end_date`
    range (YYYY-MM-DD). Results are capped to protect the shared data host.
    """
    _ensure_mongo_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    service = get_mongo_market_data_service()
    bounded_limit = _coerce_limit(limit, 5000)
    parsed_start = parse_iso_date(start_date)
    parsed_end = parse_iso_date(end_date)

    if parsed_start and parsed_end:
        if parsed_start > parsed_end:
            raise ValueError("start_date must be on or before end_date")
        rows = await service.get_eod_prices_between(
            normalized,
            start_date=parsed_start,
            end_date=parsed_end,
            limit=bounded_limit,
        )
    else:
        rows = await service.get_eod_prices(
            normalized,
            lookback_days=max(1, int(lookback_days)),
            limit=bounded_limit,
        )

    return {
        "symbol": normalized,
        "source": "mongodb:market_prices_eod",
        "row_count": len(rows),
        "start_date": start_date,
        "end_date": end_date,
        "items": sanitize_context_value(rows),
    }


@mcp.tool()
async def get_premium_dataset(
    symbol: str,
    dataset: str,
    limit: int = 100,
) -> dict[str, Any]:
    """Read a guarded MongoDB vnstock premium dataset for one symbol.

    `dataset` must be one of the allowlisted names from `list_premium_datasets`.
    Unknown or disabled datasets are rejected. Limits are capped per dataset.
    """
    _ensure_mongo_available()
    normalized_symbol = normalize_symbol_input(symbol)
    if not normalized_symbol:
        raise ValueError("A stock symbol is required")

    normalized_dataset = _normalize_dataset_name(dataset)
    spec = PREMIUM_DATASET_SPECS.get(normalized_dataset)
    if spec is None:
        raise ValueError(
            f"Dataset '{dataset}' is not exposed by the read-only VNIBB MCP. "
            "Call `list_premium_datasets` for the allowed names."
        )

    bounded_limit = _coerce_limit(limit, spec.max_limit)
    service = get_mongo_market_data_service()
    records = await service.get_raw_dataset_records(
        normalized_symbol,
        dataset=spec.dataset,
        limit=bounded_limit,
    )
    return {
        "symbol": normalized_symbol,
        "dataset": spec.dataset,
        "scope_type": spec.scope_type,
        "source": "mongodb:market_vnstock_premium_records",
        "row_count": len(records),
        "items": sanitize_context_value(records),
    }


@mcp.tool()
async def get_intraday_trades(
    symbol: str,
    lookback_days: int = 7,
    limit: int = 1000,
) -> dict[str, Any]:
    """Get read-only intraday tick trades for one symbol from MongoDB (bounded symbols)."""
    _ensure_mongo_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    service = get_mongo_market_data_service()
    rows = await service.get_intraday_trades(
        normalized,
        lookback_days=max(1, int(lookback_days)),
        limit=_coerce_limit(limit, 20000),
    )
    return {
        "symbol": normalized,
        "source": "mongodb:market_vnstock_premium_records",
        "row_count": len(rows),
        "items": sanitize_context_value(rows),
    }


@mcp.tool()
async def get_price_depth(symbol: str, limit: int = 500) -> dict[str, Any]:
    """Get read-only volume-at-price depth rows for one symbol from MongoDB."""
    _ensure_mongo_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    service = get_mongo_market_data_service()
    rows = await service.get_price_depth(
        normalized,
        limit=_coerce_limit(limit, 5000),
    )
    return {
        "symbol": normalized,
        "source": "mongodb:market_vnstock_premium_records",
        "row_count": len(rows),
        "items": sanitize_context_value(rows),
    }


def create_http_app() -> FastAPI:
    mcp_http_app = mcp.streamable_http_app()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async with mcp.session_manager.run():
            yield

    app = FastAPI(
        title="VNIBB Read-Only MCP",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def _shared_token_guard(request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)

        expected = settings.vnibb_mcp_shared_bearer_token
        if not expected:
            return await call_next(request)

        received = request.headers.get("authorization", "")
        if received != f"Bearer {expected}":
            return JSONResponse(
                status_code=401,
                content={
                    "error": True,
                    "message": "Missing or invalid VNIBB MCP bearer token",
                },
            )

        return await call_next(request)

    @app.get("/health")
    async def health() -> JSONResponse:
        return JSONResponse(
            {
                "ok": True,
                "server": "VNIBB Read-Only MCP",
                "read_only": True,
                "mcp_endpoint": "/mcp",
                "revision": settings.release_revision,
                "appwrite": appwrite_runtime_summary(),
            }
        )

    @app.get("/")
    async def root() -> PlainTextResponse:
        return PlainTextResponse("VNIBB Read-Only MCP is running. Connect clients to /mcp.")

    app.mount("/", mcp_http_app)
    return app


app = create_http_app()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the VNIBB read-only MCP server")
    parser.add_argument(
        "--transport",
        choices=("stdio", "streamable-http"),
        default=settings.vnibb_mcp_transport,
        help="stdio for local IDE clients, streamable-http for remote/OCI deployment",
    )
    parser.add_argument("--host", default=settings.vnibb_mcp_host)
    parser.add_argument("--port", type=int, default=settings.vnibb_mcp_port)
    return parser.parse_args()


def main() -> None:
    setup_logging()
    args = parse_args()
    if args.transport == "stdio":
        mcp.run(transport="stdio")
        return

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
