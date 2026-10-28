from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import logging
import math
import re
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, PlainTextResponse
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field
from sqlalchemy import select

from vnibb.core.auth import User, require_active_user
from vnibb.core.config import settings
from vnibb.core.database import async_session_maker, check_database_connection
from vnibb.core.financial_sources import (
    ADMITTED_FINANCIAL_SOURCES,
    ISSUER_SOURCE,
    PRIMARY_FINANCIAL_SOURCES,
    SECONDARY_FINANCIAL_SOURCES,
    issuer_evidence_admitted,
)
from vnibb.core.logging_config import setup_logging
from vnibb.core.price_units import normalize_price_record, persisted_price_record
from vnibb.core.ratio_units import PERCENT_RATIO_FIELDS, admitted_ratio_value
from vnibb.models.company import Company, Officer, Shareholder
from vnibb.models.financials import BalanceSheet, CashFlow, IncomeStatement
from vnibb.models.market import MarketSector, SectorPerformance, Subsidiary
from vnibb.models.news import CompanyEvent, CompanyNews, Dividend, InsiderDeal
from vnibb.models.screener import ScreenerSnapshot
from vnibb.models.stock import Stock, StockIndex, StockPrice
from vnibb.models.sync_status import SyncStatus
from vnibb.models.trading import FinancialRatio, ForeignTrading, OrderFlowDaily
from vnibb.providers.vnstock.financials import FinancialStatementData
from vnibb.services.ai_context_service import AIContextService
from vnibb.services.financial_service import admit_statement_rows
from vnibb.services.matrix_service import require_matrix_export_rights, resolve_matrix_selection
from vnibb.services.mongo_market_data_service import MongoReadError, get_mongo_market_data_service
from vnibb.services.vietcap_financials import decode_vietcap_financial_record

logger = logging.getLogger(__name__)

MCP_INSTRUCTIONS = """
VNIBB read-only MCP server for Vietnam market research backed by the VNIBB Postgres database.

Use this server to read curated VNIBB market data from the VNIBB Postgres database without mutating any table.

Guardrails:
- Prefer `get_symbol_snapshot` and `get_market_snapshot` before low-level collection queries.
- Treat `query_database_collection` as a narrow escape hatch, not the first choice.
- For deep analytical history (EOD prices, fundamentals, intraday, macro), use the MongoDB-backed
  tools: `get_eod_price_history`, `get_premium_dataset`, `get_intraday_trades`, `get_price_depth`.
  Call `list_premium_datasets` to discover allowlisted dataset names.
- This server is intentionally read-only. It does not expose admin, write, delete, backfill, or schema-mutation tools.
- User-owned tables are excluded from generic queries. Matrix selections require the owner's
  verified Supabase JWT on each HTTP request and explicit source export rights.
- Include freshness and source notes when summarizing data for downstream agents.
- Provider execution is forbidden. Missing data stays unavailable; never fetch premium or
  banned provider data. Canonical financial evidence uses IQ primary/free VCI only.
""".strip()

ROADMAP_WARNING = """
VNIBB MCP intentionally excludes write/admin tools in this branch.

Roadmap only:
- dashboard mutations
- watchlist mutations
- database row writes
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
        allowed_sort_fields=("trade_date", "change_pct", "total_volume", "total_value"),
    ),
    "screener_snapshots": CollectionSpec(
        collection="screener_snapshots",
        description="Derived screener snapshots used by the workspace.",
        default_order="snapshot_date",
        default_desc=True,
        max_limit=100,
        date_field="snapshot_date",
        allowed_filters=("symbol", "exchange", "industry"),
        allowed_sort_fields=("snapshot_date", "market_cap", "rs_rating", "volume"),
    ),
    "companies": CollectionSpec("companies", "Persisted SQL profiles; not Mongo company.info.", "symbol", False, 100, "listing_date", ("symbol", "exchange", "industry", "sector"), ("symbol", "company_name", "listing_date")),
    "shareholders": CollectionSpec("shareholders", "Persisted SQL shareholders; not premium reference.shareholders.", "as_of_date", True, 200, "as_of_date", ("symbol",), ("as_of_date", "ownership_pct", "name")),
    "officers": CollectionSpec("officers", "Persisted SQL officers; not premium company.officers.", "name", False, 200, "appointment_date", ("symbol",), ("name", "appointment_date")),
    "subsidiaries": CollectionSpec("subsidiaries", "Persisted SQL subsidiaries; not premium company.subsidiaries.", "id", False, 200, None, ("symbol",), ("id", "subsidiary_name", "ownership_pct")),
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
    """Allowlist entry for a persisted analytical dataset; no provider execution.

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
        PremiumDatasetSpec("company.shareholder_structure", "Vietcap IQ shareholder structure; distinct from SQL shareholders.", 200),
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
        PremiumDatasetSpec("market.pe", "Market P/E series (5Y retained window).", 200, scope_type="market"),
        PremiumDatasetSpec("market.pb", "Market P/B series (5Y retained window).", 200, scope_type="market"),
        PremiumDatasetSpec("market.evaluation", "Market valuation evaluation (5Y retained window).", 200, scope_type="market"),
        PremiumDatasetSpec("analytics.valuation.pe", "Analytics valuation P/E (VNINDEX only).", 200, scope_type="market"),
        PremiumDatasetSpec("analytics.valuation.pb", "Analytics valuation P/B (VNINDEX only).", 200, scope_type="market"),
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
            "scope_key": "market" if spec.scope_type == "market" else "<symbol>",
            "supported_indices": ["VNINDEX"] if spec.dataset.startswith("analytics.valuation.") else [],
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
        raise ValueError("Dates must use YYYY-MM-DD format")
    if not DATE_RE.fullmatch(text):
        raise ValueError("Dates must use YYYY-MM-DD format")
    return datetime.strptime(text, "%Y-%m-%d").date()




def _query_equal(attribute: str, values: list[Any]) -> dict[str, Any]:
    return {"method": "equal", "attribute": attribute, "values": values}


def _query_limit(value: int) -> dict[str, Any]:
    return {"method": "limit", "values": [int(value)]}


def _query_order(attribute: str, descending: bool = False) -> dict[str, Any]:
    return {"method": "orderDesc" if descending else "orderAsc", "attribute": attribute}


def _query_gte(attribute: str, value: Any) -> dict[str, Any]:
    return {"method": "greaterThanEqual", "attribute": attribute, "values": [value]}


def _query_lte(attribute: str, value: Any) -> dict[str, Any]:
    return {"method": "lessThanEqual", "attribute": attribute, "values": [value]}


def _coerce_limit(requested_limit: int, max_limit: int) -> int:
    value = int(requested_limit)
    if value < 0:
        raise ValueError("limit must be nonnegative; zero returns no rows")
    return min(value, int(max_limit))


def _normalize_filter_value(key: str, value: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"Filter '{key}' cannot be empty")

    if key == "symbol":
        normalized = normalize_symbol_input(text)
        if not normalized:
            raise ValueError("A valid stock symbol is required")
        return normalized

    if key == "period_type":
        aliases = {"year": "year", "annual": "year", "yearly": "year", "fy": "year",
                   "quarter": "quarter", "quarterly": "quarter", "q": "quarter"}
        normalized = aliases.get(text.lower())
        if normalized is None:
            raise ValueError("Unsupported period_type; use year or quarter. TTM aggregation is not supported")
        return normalized

    if key in {
        "exchange",
        "industry",
        "sector",
        "interval",
        "source",
        "event_type",
        "index_code",
    }:
        return (
            text.upper() if key in {"exchange", "interval", "index_code"} else text
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
        if value is None:
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
    date_column = getattr(COLLECTION_MODELS[spec.collection], spec.date_field) if spec.date_field else None
    datetime_bounds = date_column is not None and date_column.type.python_type is datetime
    if start and spec.date_field:
        queries.append(_query_gte(spec.date_field, datetime.combine(start, datetime.min.time()) if datetime_bounds else start))
        applied_filters["start_date"] = start.isoformat()
    if end and spec.date_field:
        queries.append(_query_lte(spec.date_field, datetime.combine(end, datetime.max.time()) if datetime_bounds else end))
        applied_filters["end_date"] = end.isoformat()

    requested_sort = str(sort_by or spec.default_order).strip()
    if requested_sort not in spec.allowed_sort_fields:
        raise ValueError(
            f"Collection '{spec.collection}' does not support sort field '{requested_sort}'"
        )

    effective_desc = spec.default_desc if descending is None else bool(descending)
    queries.append(_query_order(requested_sort, descending=effective_desc))
    model = COLLECTION_MODELS[spec.collection]
    for key in (*spec.allowed_filters, *spec.allowed_sort_fields):
        if key not in model.__table__.columns:
            raise ValueError(f"Collection '{spec.collection}' has unmapped constraint '{key}'")

    bounded_limit = _coerce_limit(limit, spec.max_limit)
    queries.append(_query_limit(bounded_limit))
    applied_filters["sort_by"] = requested_sort
    applied_filters["descending"] = effective_desc

    return spec, queries, applied_filters, bounded_limit


def _serialize_collection_specs() -> dict[str, Any]:
    return {
        name: {
            **asdict(spec),
            "fields": list(COLLECTION_MODELS[name].__table__.columns.keys()),
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


AGENT_CONNECTION_GUIDE = """
VNIBB Read-Only MCP — connection guide for downstream agents.

This server exposes curated Vietnam equity market data from the VNIBB Postgres
database and the MongoDB analytical corpus. Vietcap IQ is primary; free vnstock
VCI is the only admitted secondary ingestion source. It is intentionally read-only:
no tool invokes providers, mutates state, triggers jobs, or installs premium modules.

Transport:
- stdio: run `vnibb-mcp --transport stdio` (IDE-local, no HTTP auth).
- streamable-http: the deployed FastAPI app mounts the MCP endpoint at `/mcp`
  (Caddy-public `https://<host>/mcp` or private-network `http://<host>:8001/mcp`).

Authentication:
- streamable-http deployments require `Authorization: Bearer <token>` where
  `<token>` is the shared `VNIBB_MCP_SHARED_BEARER_TOKEN`.
- Unauthenticated `/health` reports process/configuration only, not DB connectivity.
- User JWTs are accepted but scoped to the Matrix selection tool only.

Discovery:
- `vnibb://mcp/guardrails` — read-only policy and intentionally excluded surfaces.
- `vnibb://database/collections` — allowlisted Postgres tables, filters, sort
  fields, limits, and dates.
- `vnibb://database/schema/{collection}` — one table's MCP-facing metadata.
- `vnibb://mongo/datasets` — allowlisted persisted datasets (legacy storage names).
- `vnibb://mcp/skills` — retrieval workflows for common agent tasks.
- `vnibb://mcp/guide` — this connection guide. The `get_agent_connection_guide`
  tool returns this guide and `vnibb://mcp/skills` inline, so a client that
  cannot read resources can still self-bootstrap from the tool surface alone.

Recommended call order:
1. `get_database_status` / `get_mongo_status` — confirm reachability and sources.
2. `list_supported_collections` / `list_premium_datasets` — discover the surface.
3. `get_symbol_snapshot` / `get_market_snapshot` — rich evidence-first reads.
4. Deep dive with `get_symbol_prices`, `get_latest_financial_statement`,
   `get_latest_financial_ratios`, `get_company_news`, `get_corporate_timeline`,
   `get_eod_price_history`, `get_premium_dataset`, `get_intraday_trades`,
   `get_price_depth`.

Read-only contract:
- `query_database_collection` is a narrow escape hatch, not the first choice.
- Treat every row as evidence with its own source, scope, and date; never
  present unavailable or stale data as current.
- User-owned tables and Matrix selections require an explicit user JWT.
- Financial tools prefer IQ and explicitly identified VCI PostgreSQL rows; Mongo
  finance datasets require IQ envelopes. Empty is not permission for a fallback fetch.
- Historical non-financial rows remain readable with actual source/date evidence;
  freshness is not inferred from ingestion time. `premium` in names is storage legacy.
- Full-data tools preserve fetched evidence; Decimal and unsafe JavaScript integers
  are exact decimal strings. Nonfinite values error. Financial observation fields
  are admitted separately: unverified interest and ambiguous fiscal cells are null
  with unavailable reasons. `raw_data` and rejected `raw_observation` are retained
  evidence, not usable financial observations; PostgreSQL rows are never rewritten.
- SQL dates are inclusive; either EOD bound selects an open-sided range. Limits
  support zero, reject negatives and cap at collection/dataset maxima.
- Market datasets use market scope with no equity symbol; analytics valuations
  support VNINDEX only. TTM is unsupported; year/quarter aliases are normalized.
- Snapshots explicitly use compact AI summaries; full records use dedicated or
  generic reads. Local snapshot builders never call outbound MCP.
- `get_reference_dataset` selects IQ profile/metric-map physical stores;
  `get_ingestion_receipts` reads bounded acquisition evidence, never runs jobs.

Connect, discover via resources, and read with `get_symbol_snapshot` /
`get_market_snapshot` before low-level collection queries.
""".strip()


SKILLS_CATALOG = """
VNIBB Read-Only MCP — retrieval skills for downstream agents.

Each skill is a named workflow the agent can adopt when the matching intent is
detected. Skills are read-only: they compose existing tools and resources and
never mutate data. An agent that needs transport/auth/discovery facts first can
call `get_agent_connection_guide`, which returns the connection guide and this
catalog inline.

1. symbol_deep_dive
   Intent: research one symbol (fundamental + price + catalysts).
   Steps:
   - `get_symbol_snapshot` for the database-first cross-section.
   - `get_latest_financial_ratios` and `get_latest_financial_statement` for
     the latest reported period.
   - `get_symbol_prices` (interval 1D) to validate recent price action.
   - `get_company_news` and `get_corporate_timeline` for catalysts and events.
   - Cite source, scope, and data date for every claim.

2. market_brief
   Intent: market open/close brief across indices and sectors.
   Steps:
   - `get_market_snapshot` for index/sector summary.
   - `get_database_status` / `get_mongo_status` to note freshness.
   - Follow up any outlier with `get_symbol_snapshot`.

3. eod_price_history
   Intent: long-horizon OHLCV for charting or backtest context.
   Steps:
   - `get_eod_price_history` (lookback_days, start_date, end_date).
   - Verify interval and date range against the returned envelope.

4. premium_dataset
   Intent: analytical corpus rows from a vnstock dataset.
   Steps:
   - `list_premium_datasets` to confirm the dataset is allowlisted.
   - `get_premium_dataset` (symbol, dataset, limit).
   - Treat raw values as provider-sourced and check the dataset scope.

5. intraday_trades
   Intent: recent intraday tick activity for one symbol.
   Steps:
   - `get_intraday_trades` (symbol, lookback_days, limit).

6. price_depth
   Intent: volume-at-price depth profile for one symbol.
   Steps:
   - `get_price_depth` (symbol, limit) — newest write batch only.

7. database_collection_audit
   Intent: safe table-level inspection / coverage check.
   Steps:
   - `list_supported_collections` to confirm the table is exposed.
   - `query_database_collection` with the allowlisted filters.
   - Report field presence, freshness, and gaps; stay read-only.

8. matrix_selection
   Intent: read a user's Matrix selection rows (requires verified Supabase JWT).
   Steps:
   - `get_matrix_selection` (snapshot_id, result_ids) over an authorized HTTP
     request; stdio and shared bearer cannot authorize it.

9. reference_dataset
   Intent: exact IQ profile or metric-map document from its physical store.
   Steps:
   - `get_reference_dataset` (symbol, store) with store
     `market_company_profiles` or `market_financial_metric_map`.
   - Report the selected store, record identity, and descriptor evidence;
     legacy type-wide documents are historical retention, not a fallback.

10. ingestion_receipts
    Intent: check how a symbol's dataset was acquired, without running jobs.
    Steps:
    - `get_ingestion_receipts` (symbol, dataset, limit) for bounded SQL/Mongo
      acquisition evidence.
    - Report the actual scheduler owner, outcome, and source window; a receipt
      is acquisition evidence, not data freshness.
""".strip()


def read_agent_guide_resource() -> str:
    """Return the connection guide for downstream agents connecting to this MCP."""
    return AGENT_CONNECTION_GUIDE


def read_skills_catalog_resource() -> str:
    """Return the retrieval skills catalog for downstream agents."""
    return SKILLS_CATALOG

COLLECTION_MODELS: dict[str, Any] = {
    "stocks": Stock,
    "stock_prices": StockPrice,
    "stock_indices": StockIndex,
    "income_statements": IncomeStatement,
    "balance_sheets": BalanceSheet,
    "cash_flows": CashFlow,
    "financial_ratios": FinancialRatio,
    "company_news": CompanyNews,
    "company_events": CompanyEvent,
    "dividends": Dividend,
    "insider_deals": InsiderDeal,
    "foreign_trading": ForeignTrading,
    "order_flow_daily": OrderFlowDaily,
    "market_sectors": MarketSector,
    "sector_performance": SectorPerformance,
    "screener_snapshots": ScreenerSnapshot,
    "companies": Company,
    "shareholders": Shareholder,
    "officers": Officer,
    "subsidiaries": Subsidiary,
}


def serialize_data_value(value: Any) -> Any:
    """Lossless full-data JSON; Decimal is a string, integers retain precision."""
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Nonfinite numeric data cannot be represented in strict JSON")
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Nonfinite Decimal data cannot be represented in strict JSON")
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 2**53 - 1:
        return str(value)
    if isinstance(value, dict):
        return {key: serialize_data_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize_data_value(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return serialize_data_value(jsonable_encoder(value))


def _normalize_row_value(value: Any) -> Any:
    """Normalize one column value into a JSON-friendly MCP value."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _admit_statement_row(payload: dict[str, Any], model: Any) -> dict[str, Any]:
    statement_types = {IncomeStatement: "income", BalanceSheet: "balance", CashFlow: "cashflow"}
    statement_type = statement_types[model]
    raw = payload.get("raw_data") or {}
    lineage = raw.get("_financial_lineage") or {}
    canonical = lineage.get("canonical_data") or {}
    basis_fields = (
        "currency", "value_unit", "unit_metadata", "consolidation_basis",
        "flow_basis", "aggregation_basis", "source_periods", "unavailable_reason",
    )
    metadata = {
        name: canonical.get(name, lineage.get(name))
        for name in basis_fields if name in canonical or name in lineage
    }
    metadata["unavailable_reason"] = canonical.get("unavailable_reason") or lineage.get("unavailable_reason")
    if any(
        evidence.get(name) not in (None, payload.get(name) if name != "statement_type" else statement_type)
        for evidence in (canonical, lineage)
        for name in ("source", "symbol", "statement_type")
    ):
        metadata["unavailable_reason"] = "conflicting_statement_source"
    aliases = {
        "income_before_tax": "pre_tax_profit", "income_tax": "tax_expense",
        "non_current_liabilities": "long_term_liabilities",
    }
    monetary = {
        column.name: aliases.get(column.name, column.name)
        for column in model.__table__.columns if column.type.python_type in (float, Decimal)
    }
    values = {name: payload.get(name) for name in ("symbol", "period", "fiscal_year", "fiscal_quarter", "source")}
    units = dict(metadata.get("unit_metadata") or {})
    for column, field in monetary.items():
        if field in FinancialStatementData.model_fields:
            values[field] = payload.get(column)
            if column in units:
                units[field] = ({"components": [units[field], units[column]]}
                                if field != column and field in units else units[column])
    metadata["unit_metadata"] = units
    admitted = admit_statement_rows([
        FinancialStatementData(**values, **metadata, statement_type=statement_type, raw_data=raw)
    ], payload.get("period_type") or "year")[0]
    unavailable = {}
    for column, field in monetary.items():
        if payload.get(column) is not None and getattr(admitted, field, None) is None:
            unavailable[column] = (
                admitted.unavailable_reason
                or admitted.unit_metadata.get(field, {}).get("unavailable_reason")
                or "unverified_monetary_unit"
            )
    if unavailable or admitted.unavailable_reason:
        payload["raw_observation"] = dict(payload)
        if admitted.unavailable_reason:
            payload["unavailable_reason"] = admitted.unavailable_reason
        payload.update(dict.fromkeys(unavailable))
        payload["unavailable_metrics"] = unavailable
        payload["data_status"] = "partial_unavailable"
    payload.update({name: getattr(admitted, name) for name in basis_fields})
    return payload


def _serialize_row(row: Any, *, model: Any = None) -> dict[str, Any]:
    payload = dict(row)
    if model is StockPrice:
        payload = persisted_price_record(payload)
    elif model in (IncomeStatement, BalanceSheet, CashFlow) and payload.get("period"):
        payload = _admit_statement_row(payload, model)
    elif model is FinancialRatio:
        raw_data = payload.get("raw_data")
        ratio_units = raw_data.get("ratio_units") if isinstance(raw_data, dict) else None
        if not isinstance(ratio_units, dict) or not ratio_units:
            ratio_units = dict.fromkeys(PERCENT_RATIO_FIELDS, "unknown")
        unavailable_metrics = {}
        for metric in PERCENT_RATIO_FIELDS:
            column = "debt_to_assets" if metric == "debt_assets" else metric
            value = payload.get(column)
            payload[column] = admitted_ratio_value(
                value, metric, ratio_units=ratio_units, source=payload.get("source")
            )
            if value is not None and payload[column] is None:
                unavailable_metrics[column] = "Percentage unit evidence is missing or unsupported"
        if payload.get("interest_coverage") is not None:
            decoded = decode_vietcap_financial_record(raw_data) if isinstance(raw_data, dict) else {}
            basis = decoded.get("fiscalBasis") or {}
            certified = (
                isinstance(raw_data, dict)
                and payload.get("source") == "vietcap"
                and raw_data.get("symbol") == payload.get("symbol")
                and raw_data.get("dataset") == "finance.ratio"
                and basis.get("periodType") == payload.get("period_type")
                and decoded.get("values", {}).get("interest_coverage") == payload["interest_coverage"]
                and basis.get("period") == payload.get("period")
                and basis.get("year") == payload.get("fiscal_year")
                and basis.get("quarter") == payload.get("fiscal_quarter")
            )
            if not certified:
                payload["raw_observation"] = dict(row)
                payload["interest_coverage"] = None
                unavailable_metrics["interest_coverage"] = "interest_inputs_unverified"
        if unavailable_metrics:
            payload["unavailable_metrics"] = unavailable_metrics
            payload["data_status"] = "partial_unavailable"
    return {key: _normalize_row_value(value) for key, value in payload.items()}


def _model_columns(model: Any) -> list[Any]:
    """Ordered column list for a mapped model, which is the MCP row shape."""
    return list(model.__table__.columns)


def _price_series_metadata(rows: list[dict[str, Any]]) -> dict[str, Any]:
    units = {row.get("price_unit") or "unknown" for row in rows}
    unknown_count = sum(row.get("price_unit", "unknown") == "unknown" for row in rows)
    comparable = bool(rows) and len(units) == 1 and "unknown" not in units
    warnings = []
    if unknown_count:
        warnings.append(
            "Rows with unknown price units are unscaled; do not compare or aggregate them "
            "with known-unit prices."
        )
    if len(units) > 1:
        warnings.append("Mixed price units do not form a comparable price series.")
    return {
        "price_unit": next(iter(units)) if comparable else "unknown",
        "price_units": sorted(units),
        "unknown_price_unit_count": unknown_count,
        "prices_comparable": comparable,
        "warnings": warnings,
    }


def _selected_store_metadata(rows: list[dict[str, Any]]) -> dict[str, Any]:
    metadata = serialize_data_value(getattr(rows, "metadata", {}))
    stores = {str(row["sourceCollection"]) for row in rows if row.get("sourceCollection")}
    if metadata.get("source_collection"):
        stores.add(str(metadata["source_collection"]))
    ordered = sorted(stores)
    return {**metadata, "source": f"mongodb:{ordered[0]}" if len(ordered) == 1 else None,
            "source_collections": ordered,
            "freshness": "not_assessed; inspect observation timestamps, not write/retrieval time"}


def _coerce_compared_value(column: Any, value: Any) -> Any:
    """Adapt a filter value to the SQLAlchemy column type before comparison."""
    python_type = getattr(column.type, "python_type", None)
    if isinstance(value, datetime):
        return value.date() if python_type is date else value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()) if python_type is datetime else value

    text = str(value).strip()
    python_type = getattr(column.type, "python_type", None)

    if python_type is int:
        try:
            return int(text)
        except ValueError:
            return value
    if python_type is float:
        try:
            return float(text)
        except ValueError:
            return value
    if python_type is datetime:
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            parsed = parse_iso_date(text)
            return parsed if parsed is not None else value
    if python_type is date:
        parsed = parse_iso_date(text)
        return parsed if parsed is not None else value
    return value


def _query_offset(value: int) -> dict[str, Any]:
    return {"method": "offset", "values": [int(value)]}


def _apply_sql_queries(statement: Any, model: Any, queries: list[dict[str, Any]]) -> Any:
    """Translate the MCP `queries` list semantics into SQL where/order/limit clauses."""
    for query in queries:
        method = str(query.get("method") or "")
        values = list(query.get("values") or [])

        if method == "limit":
            if values:
                statement = statement.limit(max(0, int(values[0])))
            continue
        if method == "offset":
            if values:
                statement = statement.offset(max(0, int(values[0])))
            continue

        column = getattr(model, str(query.get("attribute") or ""), None)
        if column is None:
            raise ValueError(f"Unmapped SQL constraint '{query.get('attribute')}'")

        if method == "equal":
            if values:
                statement = statement.where(
                    column.in_([_coerce_compared_value(column, value) for value in values])
                )
        elif method == "greaterThanEqual":
            if values:
                statement = statement.where(column >= _coerce_compared_value(column, values[0]))
        elif method == "lessThanEqual":
            if values:
                statement = statement.where(column <= _coerce_compared_value(column, values[0]))
        elif method in {"orderAsc", "orderDesc"}:
            statement = statement.order_by(
                column.desc() if method == "orderDesc" else column.asc()
            )

        else:
            raise ValueError(f"Unsupported SQL constraint method '{method}'")

    for column in model.__table__.primary_key.columns:
        statement = statement.order_by(column.asc())
    return statement


def _resolve_collection_model(collection_id: str) -> Any:
    normalized = normalize_collection_name(collection_id)
    model = COLLECTION_MODELS.get(normalized)
    if model is None:
        raise ValueError(f"Collection '{collection_id}' is not enabled for VNIBB MCP")
    return model


async def list_collection_documents(
    collection_id: str,
    queries: list[dict[str, Any]] | None = None,
    timeout_seconds: float = 8.0,
) -> list[dict[str, Any]]:
    """Read rows from the VNIBB Postgres table behind a collection name."""
    model = _resolve_collection_model(collection_id)
    statement = _apply_sql_queries(select(*_model_columns(model)), model, list(queries or []))

    async with async_session_maker() as session:
        result = await session.execute(statement)
        return [_serialize_row(row, model=model) for row in result.mappings().all()]


async def list_collection_documents_paginated(
    collection_id: str,
    queries: list[dict[str, Any]] | None = None,
    *,
    page_size: int = 250,
    max_documents: int | None = None,
    timeout_seconds: float = 8.0,
) -> list[dict[str, Any]]:
    """Read up to ``max_documents`` rows, paging so a bounded query can span pages.

    The collection queries the MCP builds carry a small ``limit`` that must stay
    the *first* page's size, not the whole window: asking for 250 rows with a
    100-row page size has to return 250 rows across three pages, otherwise a
    bounded caller silently receives a truncated result set.
    """
    model = _resolve_collection_model(collection_id)
    if max_documents is not None and max_documents <= 0:
        return []

    page_size = max(1, page_size)
    collected: list[dict[str, Any]] = []
    offset = 0

    while max_documents is None or len(collected) < max_documents:
        remaining = page_size if max_documents is None else min(page_size, max_documents - len(collected))
        statement = _apply_sql_queries(
            select(*_model_columns(model)),
            model,
            list(queries or []) + [_query_limit(remaining), _query_offset(offset)],
        )

        async with async_session_maker() as session:
            result = await session.execute(statement)
            page = [_serialize_row(row, model=model) for row in result.mappings().all()]

        collected.extend(page)
        if len(page) < remaining:
            break
        offset += len(page)

    return collected


async def get_stock_document(symbol: str) -> dict[str, Any] | None:
    """Fetch a single stock master row by symbol."""
    rows = await list_collection_documents(
        "stocks",
        queries=[
            _query_equal("symbol", [symbol.upper()]),
            _query_limit(1),
        ],
    )
    return rows[0] if rows else None


async def get_stock_price_rows(
    symbol: str,
    *,
    interval: str = "1D",
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = 250,
    descending: bool = False,
) -> list[dict[str, Any]]:
    """Fetch stock price rows for a symbol/date window."""
    queries: list[dict[str, Any]] = [
        _query_equal("symbol", [symbol.upper()]),
        _query_equal("interval", [interval]),
        _query_order("time", descending=descending),
    ]

    if start_date is not None:
        queries.append(_query_gte("time", start_date))
    if end_date is not None:
        queries.append(_query_lte("time", end_date))

    return await list_collection_documents_paginated(
        "stock_prices",
        queries=queries,
        page_size=min(max(limit, 1), 250),
        max_documents=limit,
    )


async def check_database_connectivity(timeout_seconds: float = 3.0) -> dict[str, Any]:
    """Validate VNIBB Postgres reachability."""
    try:
        connected = await check_database_connection()
    except Exception as exc:
        return {"status": "error", "message": str(exc)}

    if connected:
        return {"status": "connected", "message": "VNIBB Postgres database is reachable"}
    return {"status": "error", "message": "VNIBB Postgres database is not reachable"}


def database_runtime_summary() -> dict[str, Any]:
    """Return a non-sensitive runtime configuration summary for the VNIBB database."""
    return {
        "configured": True,
        "backend": "postgres",
    }


async def query_database_collection_data(
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
    financial_collection = spec.collection in {*STATEMENT_COLLECTIONS.values(), "financial_ratios"}
    if financial_collection:
        queries.insert(0, _query_equal("source", list(ADMITTED_FINANCIAL_SOURCES)))
        applied_filters["admitted_sources"] = list(ADMITTED_FINANCIAL_SOURCES)

    rows = await list_collection_documents_paginated(
        spec.collection,
        queries=queries,
        page_size=min(bounded_limit, 100),
        max_documents=bounded_limit,
    )

    return {
        "collection": spec.collection,
        "description": spec.description,
        "filters_applied": applied_filters,
        "limit": bounded_limit,
        "max_limit": spec.max_limit,
        "source": f"postgres:{spec.collection}",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "row_count": len(rows),
        "items": serialize_data_value(rows),
        **(_price_series_metadata(rows) if spec.collection == "stock_prices" else {}),
    }


async def _get_latest_symbol_document(
    collection_id: str,
    symbol: str,
    *,
    period_type: str | None = None,
) -> dict[str, Any] | None:
    queries = [_query_equal("symbol", [normalize_symbol_input(symbol)])]
    if period_type is not None:
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
    for source_values in (
        list(PRIMARY_FINANCIAL_SOURCES),
        list(SECONDARY_FINANCIAL_SOURCES),
        [ISSUER_SOURCE],
    ):
        source_queries = [_query_equal("source", source_values), *queries]
        rows = await list_collection_documents(collection_id, queries=source_queries)
        for row in rows:
            if source_values == [ISSUER_SOURCE] and not issuer_evidence_admitted(row.get("raw_data")):
                continue
            return row
    return None


async def _get_symbol_rows(
    collection_id: str,
    symbol: str,
    *,
    order_attribute: str,
    limit: int,
) -> list[dict[str, Any]]:
    return await list_collection_documents(
        collection_id,
        queries=[
            _query_equal("symbol", [normalize_symbol_input(symbol)]),
            _query_order(order_attribute, descending=True),
            _query_limit(limit),
        ],
    )


async def _ensure_database_available() -> None:
    if not await check_database_connection():
        raise RuntimeError("The VNIBB database is not reachable")


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


class AuthorizedMCP(FastMCP):
    """Keep user JWTs scoped to Matrix at the MCP dispatch boundary."""

    def _matrix_only_request(self) -> bool:
        try:
            request = self.get_context().request_context.request
        except (AttributeError, ValueError):
            return False
        return isinstance(request, Request) and isinstance(
            getattr(request.state, "matrix_user", None), User
        )

    async def list_tools(self):
        tools = await super().list_tools()
        if self._matrix_only_request():
            return [tool for tool in tools if tool.name == "get_matrix_selection"]
        return tools

    async def call_tool(self, name: str, arguments: dict[str, Any]):
        if self._matrix_only_request() and name != "get_matrix_selection":
            raise ToolError("Tool not authorized for user JWT")
        return await super().call_tool(name, arguments)

    async def list_resources(self):
        return [] if self._matrix_only_request() else await super().list_resources()

    async def list_resource_templates(self):
        return [] if self._matrix_only_request() else await super().list_resource_templates()

    async def read_resource(self, uri):
        if self._matrix_only_request():
            raise PermissionError("Resource not authorized for user JWT")
        return await super().read_resource(uri)

    async def list_prompts(self):
        return [] if self._matrix_only_request() else await super().list_prompts()

    async def get_prompt(self, name: str, arguments: dict[str, Any] | None = None):
        if self._matrix_only_request():
            raise PermissionError("Prompt not authorized for user JWT")
        return await super().get_prompt(name, arguments)


mcp = AuthorizedMCP(
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


@mcp.resource("vnibb://database/collections")
def resource_supported_collections() -> str:
    """Supported VNIBB database table metadata for the VNIBB read-only MCP."""
    return json.dumps(_serialize_collection_specs(), indent=2, sort_keys=True)


@mcp.resource("vnibb://mongo/datasets")
def resource_premium_datasets() -> str:
    """Supported MongoDB vnstock premium dataset metadata for the VNIBB read-only MCP."""
    return json.dumps(_serialize_premium_dataset_specs(), indent=2, sort_keys=True)



@mcp.resource("vnibb://mcp/guide")
def resource_agent_guide() -> str:
    """Connection guide for downstream agents: transport, auth, discovery, read order."""
    return read_agent_guide_resource()


@mcp.resource("vnibb://mcp/skills")
def resource_skills_catalog() -> str:
    """Retrieval skills catalog for downstream agents: named workflows over the read-only tools."""
    return read_skills_catalog_resource()


@mcp.resource("vnibb://database/schema/{collection}")
def resource_collection_schema(collection: str) -> str:
    """Return the MCP-facing metadata for one supported VNIBB database table."""
    normalized = normalize_collection_name(collection)
    spec = COLLECTION_SPECS.get(normalized)
    if spec is None:
        raise ValueError(f"Collection '{collection}' is not enabled for VNIBB MCP")
    return json.dumps({normalized: {**_serialize_collection_specs()[normalized], "read_only": True}}, indent=2, sort_keys=True)


@mcp.prompt()
def symbol_deep_dive(symbol: str) -> str:
    """Prompt template for a database-first VNIBB symbol review."""
    normalized = normalize_symbol_input(symbol)
    return (
        f"Analyze {normalized} using VNIBB's read-only database MCP. Start with `get_symbol_snapshot`, "
        f"then validate price action with `get_symbol_prices`, recent catalysts with `get_company_news`, "
        f"and any event timeline details with `get_corporate_timeline`. Keep the answer evidence-first and "
        f"mention freshness where relevant."
    )


@mcp.prompt()
def market_brief() -> str:
    """Prompt template for a market-open or market-close brief."""
    return (
        "Generate a VNIBB market brief using `get_market_snapshot` first. If one sector or symbol needs "
        "deeper evidence, follow up with `get_symbol_snapshot` or `query_database_collection`. Do not invent "
        "data that is not present in the VNIBB database."
    )


@mcp.prompt()
def eod_price_history(
    symbol: str, lookback_days: int = 365, start_date: str | None = None, end_date: str | None = None
) -> str:
    """Prompt template for long-horizon OHLCV history retrieval."""
    normalized = normalize_symbol_input(symbol)
    range_part = ""
    if start_date or end_date:
        range_part = f" from {start_date or 'start'} to {end_date or 'now'}"
    return (
        f"Retrieve the EOD OHLCV history for {normalized}{range_part} using `get_eod_price_history` "
        f"(lookback_days={lookback_days}). Verify the interval and returned date range, then cite the "
        f"envelope's freshness and source."
    )


@mcp.prompt()
def premium_dataset(symbol: str, dataset: str, limit: int = 100) -> str:
    """Prompt template for one allowlisted vnstock premium dataset."""
    normalized = normalize_symbol_input(symbol)
    return (
        f"Fetch rows for dataset `{dataset}` of {normalized} using `list_premium_datasets` first to confirm "
        f"allowlisting, then `get_premium_dataset(symbol='{normalized}', dataset='{dataset}', limit={limit})`. "
        f"Treat the rows as provider-sourced evidence and note the dataset scope."
    )


@mcp.prompt()
def intraday_trades(symbol: str, lookback_days: int = 7, limit: int = 500) -> str:
    """Prompt template for recent intraday tick activity."""
    normalized = normalize_symbol_input(symbol)
    return (
        f"Pull recent intraday tick trades for {normalized} using `get_intraday_trades` "
        f"(lookback_days={lookback_days}, limit={limit}) and summarize the session activity."
    )


@mcp.prompt()
def price_depth(symbol: str, limit: int = 500) -> str:
    """Prompt template for volume-at-price depth retrieval."""
    normalized = normalize_symbol_input(symbol)
    return (
        f"Get the volume-at-price depth profile for {normalized} using `get_price_depth(symbol='{normalized}', "
        f"limit={limit})`. Report batch updatedAt and per-row observedAt separately; write time is not market freshness."
    )


@mcp.prompt()
def database_collection_audit(collection: str, symbol: str | None = None) -> str:
    """Prompt template for safe table-level inspection."""
    normalized_collection = normalize_collection_name(collection)
    normalized_symbol = normalize_symbol_input(symbol or "")
    if normalized_symbol:
        return (
            f"Audit the `{normalized_collection}` VNIBB database table for `{normalized_symbol}` using "
            "`query_database_collection`. Summarize what fields are present, what looks fresh, and any obvious "
            "coverage gaps. Stay read-only."
        )
    return (
        f"Audit the `{normalized_collection}` VNIBB database table using `list_supported_collections` and "
        "`query_database_collection`. Stay read-only and note any operational caveats."
    )


def _matrix_request_user(ctx: Context) -> User:
    try:
        request = ctx.request_context.request
    except ValueError:
        request = None
    user = getattr(request.state, "matrix_user", None) if isinstance(request, Request) else None
    if not isinstance(user, User) or user.provider != "supabase":
        raise ToolError("Matrix requires a verified user JWT over HTTP; shared bearer and stdio cannot authorize it")
    return user


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
async def get_matrix_selection(
    snapshot_id: str, result_ids: Annotated[list[str], Field(min_length=1, max_length=120)], ctx: Context
) -> dict[str, Any]:
    """Read the caller's frozen Matrix selection and evidence, subject to source export rights."""
    user = _matrix_request_user(ctx)
    try:
        async with async_session_maker() as db:
            packet = await resolve_matrix_selection(
                db, user.id, {"snapshot_id": snapshot_id, "result_ids": result_ids}
            )
            require_matrix_export_rights(packet)
            return packet
    except HTTPException as exc:
        message = {
            403: "Matrix source export is not permitted",
            404: "Matrix selection not found",
            422: "Invalid Matrix selection",
        }.get(exc.status_code, "Matrix selection unavailable")
        raise ToolError(message) from None
    except Exception:
        raise ToolError("Matrix selection unavailable") from None


@mcp.tool()
def list_supported_collections() -> dict[str, Any]:
    """List the VNIBB database tables intentionally exposed by the read-only VNIBB MCP."""
    return {
        "server": "VNIBB Read-Only MCP",
        "read_only": True,
        "collections": _serialize_collection_specs(),
        "roadmap_warning": ROADMAP_WARNING,
    }

@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
def get_agent_connection_guide() -> dict[str, Any]:
    """Return the connection guide and retrieval skills for agents integrating with this MCP."""
    return {
        "server": "VNIBB Read-Only MCP",
        "read_only": True,
        "guide_resource": "vnibb://mcp/guide",
        "skills_resource": "vnibb://mcp/skills",
        "guide": AGENT_CONNECTION_GUIDE,
        "skills": SKILLS_CATALOG,
    }


@mcp.tool()
async def get_database_status() -> dict[str, Any]:
    """Check VNIBB database connectivity and return a non-sensitive runtime summary."""
    connectivity = await check_database_connectivity()
    return {
        "connectivity": connectivity,
        "runtime": database_runtime_summary(),
        "read_only": True,
    }


@mcp.tool()
async def get_symbol_snapshot(symbol: str) -> dict[str, Any]:
    """Get a rich database-first symbol snapshot across prices, ratios, statements, news, and flows."""
    await _ensure_database_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    service = AIContextService()
    snapshot = await service._build_database_snapshot_direct(normalized)
    if snapshot is None:
        return {
            "symbol": normalized,
            "source": "postgres",
            "found": False,
            "message": "No VNIBB database snapshot was found for this symbol.",
        }

    financial_collections = {"ratios": "financial_ratios", **STATEMENT_COLLECTIONS}
    for key, collection in financial_collections.items():
        if key in snapshot:
            snapshot[key] = await _get_latest_symbol_document(collection, normalized)
    if snapshot.get("ratios"):
        for short_name, column in (("pe", "pe_ratio"), ("pb", "pb_ratio"), ("ps", "ps_ratio")):
            snapshot["ratios"][short_name] = snapshot["ratios"].get(column)

    return {
        "symbol": normalized,
        "source": "postgres",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "found": True,
        "snapshot": serialize_data_value(snapshot),
        "serialization_policy": "compact_ai_snapshot; bounded summaries, full financial evidence; use dedicated/generic tools for full rows",
    }


@mcp.tool()
async def get_market_snapshot() -> dict[str, Any]:
    """Get the current database-backed market snapshot for key VN indices and sectors."""
    await _ensure_database_available()
    service = AIContextService()
    snapshot = await service._build_database_market_snapshot_direct()
    return {
        "source": "postgres",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "indices_expected": list(MARKET_INDEX_CODES),
        "snapshot": serialize_data_value(snapshot or {}),
        "serialization_policy": "compact_ai_snapshot; bounded summaries; use dedicated/generic tools for full rows",
    }


@mcp.tool()
async def get_symbol_prices(
    symbol: str,
    interval: str = "1D",
    start_date: str | None = None,
    end_date: str | None = None,
    limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 250}, description="Zero returns no rows; requests above 250 are capped")] = 60,
    descending: bool = False,
) -> dict[str, Any]:
    """Get VNIBB database OHLCV rows for one symbol and interval."""
    await _ensure_database_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    bounded_limit = _coerce_limit(limit, COLLECTION_SPECS["stock_prices"].max_limit)
    parsed_start, parsed_end = parse_iso_date(start_date), parse_iso_date(end_date)
    if parsed_start and parsed_end and parsed_start > parsed_end:
        raise ValueError("start_date cannot be later than end_date")
    rows = await get_stock_price_rows(
        normalized,
        interval=_normalize_filter_value("interval", interval),
        start_date=parsed_start,
        end_date=parsed_end,
        limit=bounded_limit,
        descending=descending,
    )

    return {
        "symbol": normalized,
        "interval": _normalize_filter_value("interval", interval),
        "source": "postgres:stock_prices",
        "retrieved_at": datetime.now(UTC).isoformat(),
        **_price_series_metadata(rows),
        "row_count": len(rows),
        "limit": bounded_limit,
        "max_limit": 250,
        "start_date": start_date,
        "end_date": end_date,
        "items": serialize_data_value(rows),
    }


@mcp.tool()
async def get_latest_financial_statement(
    symbol: str,
    statement: str = "income_statement",
    period_type: str | None = None,
) -> dict[str, Any]:
    """Get the latest VNIBB database financial statement row for a symbol."""
    await _ensure_database_available()
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
        "period_type": _normalize_filter_value("period_type", period_type) if period_type is not None else None,
        "item": serialize_data_value(row or {}),
        "found": row is not None,
        "source": f"postgres:{collection_id}",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "provider_source": row.get("source") if row else None,
        "data_status": row.get("data_status", "available") if row else "empty_no_admitted_source",
        "freshness": "not_assessed; inspect source dates and fiscal period",
    }


@mcp.tool()
async def get_latest_financial_ratios(
    symbol: str, period_type: str | None = None
) -> dict[str, Any]:
    """Get the latest VNIBB database financial ratio row for a symbol."""
    await _ensure_database_available()
    normalized_symbol = normalize_symbol_input(symbol)
    if not normalized_symbol:
        raise ValueError("A stock symbol is required")

    row = await _get_latest_symbol_document(
        "financial_ratios", normalized_symbol, period_type=period_type
    )
    return {
        "symbol": normalized_symbol,
        "collection": "financial_ratios",
        "period_type": _normalize_filter_value("period_type", period_type) if period_type is not None else None,
        "item": serialize_data_value(row or {}),
        "found": row is not None,
        "source": "postgres:financial_ratios",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "provider_source": row.get("source") if row else None,
        "data_status": row.get("data_status", "available") if row else "empty_no_admitted_source",
        "freshness": "not_assessed; inspect source dates and fiscal period",
    }


@mcp.tool()
async def get_company_news(symbol: str, limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 25})] = 10) -> dict[str, Any]:
    """Get recent VNIBB database company news rows for one symbol."""
    await _ensure_database_available()
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
        "source": "postgres:company_news",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "row_count": len(rows),
        "limit": bounded_limit,
        "max_limit": COLLECTION_SPECS["company_news"].max_limit,
        "items": serialize_data_value(rows),
    }


@mcp.tool()
async def get_corporate_timeline(symbol: str, limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 30})] = 15) -> dict[str, Any]:
    """Get a merged VNIBB database timeline across company events, dividends, and insider deals."""
    await _ensure_database_available()
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
        "source": "postgres:company_events,dividends,insider_deals",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "row_count": len(timeline),
        "limit": bounded_limit,
        "max_limit": 30,
        "items": serialize_data_value(timeline),
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
async def query_database_collection(
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
    limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 250}, description="Per-collection cap applies; zero returns no rows")] = 20,
    sort_by: str | None = None,
    descending: bool | None = None,
) -> dict[str, Any]:
    """Read a supported VNIBB database table with strict VNIBB read-only guardrails."""
    await _ensure_database_available()
    return await query_database_collection_data(
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
    """Check MongoDB connectivity independently of corpus contents; never execute providers."""
    service = get_mongo_market_data_service()
    if not service.enabled:
        return {
            "enabled": False,
            "read_only": True,
            "connectivity": {"status": "not_configured"},
            "message": "MongoDB analytical source is not configured (MONGODB_ENABLED / MONGODB_URL).",
        }
    try:
        await asyncio.to_thread(lambda: service._get_database().command("ping"))
    except Exception:
        logger.warning("MCP MongoDB connectivity check failed")
        return {
            "enabled": True,
            "read_only": True,
            "connectivity": {"status": "error", "message": "MongoDB is not reachable"},
        }
    collections = await service.inspect_collections(sample_limit=1)
    return {
        "enabled": True,
        "read_only": True,
        "connectivity": {"status": "connected"},
        "database": settings.mongodb_database,
        "collections": serialize_data_value(collections),
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
    lookback_days: Annotated[int, Field(ge=1)] = 365,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 5000})] = 1000,
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

    if int(lookback_days) < 1:
        raise ValueError("lookback_days must be positive")
    if parsed_start or parsed_end:
        if parsed_start and parsed_end and parsed_start > parsed_end:
            raise ValueError("start_date must be on or before end_date")
        rows = await service.get_eod_prices_between(
            normalized,
            start_date=parsed_start,
            end_date=parsed_end,
            limit=bounded_limit,
            include_provenance=True,
        )
    else:
        rows = await service.get_eod_prices(
            normalized,
            lookback_days=max(1, int(lookback_days)),
            limit=bounded_limit,
            include_provenance=True,
        )

    for row in rows:
        # `tradeDate` is the retained provider field; `time` is the canonical session
        # identity that every other price envelope exposes (dates are session-scoped).
        trade_date = row.get("tradeDate")
        if trade_date is not None and not any(row.get(key) for key in ("time", "date", "timestamp")):
            day = trade_date.date() if isinstance(trade_date, datetime) else str(trade_date)[:10]
            row["time"] = day.isoformat() if isinstance(day, date) else str(day)

    rows = [normalize_price_record(row, symbol=normalized) for row in rows]

    return {
        "symbol": normalized,
        "source": "mongodb:market_prices_eod",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "row_count": len(rows),
        "limit": bounded_limit,
        "max_limit": 5000,
        "lookback_days": int(lookback_days) if not (parsed_start or parsed_end) else None,
        **_price_series_metadata(rows),
        "start_date": start_date,
        "end_date": end_date,
        "items": serialize_data_value(rows),
    }


@mcp.tool()
async def get_premium_dataset(
    symbol: str | None = None,
    dataset: str = "",
    limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 1000}, description="Dataset-specific cap applies; zero returns no rows")] = 100,
    period_type: str | None = None,
    index_code: str | None = None,
) -> dict[str, Any]:
    """Read one allowlisted persisted dataset, never execute a provider.

    Financial datasets require Vietcap IQ source envelopes. `period_type` selects
    the exact year/quarter variant. Legacy non-financial data retains its provenance.
    """
    _ensure_mongo_available()
    normalized_symbol = normalize_symbol_input(symbol or "")
    normalized_dataset = _normalize_dataset_name(dataset)
    spec = PREMIUM_DATASET_SPECS.get(normalized_dataset)
    if spec is None:
        raise ValueError(
            f"Dataset '{dataset}' is not exposed by the read-only VNIBB MCP. "
            "Call `list_premium_datasets` for the allowed names."
        )

    if spec.scope_type == "symbol" and not normalized_symbol:
        raise ValueError("A stock symbol is required for symbol-scoped datasets")
    if index_code is not None and (not spec.dataset.startswith("analytics.valuation.") or index_code.strip().upper() != "VNINDEX"):
        raise ValueError("Index selection is supported only for analytics.valuation datasets and VNINDEX")
    if period_type is not None and not spec.dataset.startswith("finance."):
        raise ValueError("period_type is supported only for financial datasets")
    bounded_limit = _coerce_limit(limit, spec.max_limit)
    service = get_mongo_market_data_service()
    normalized_period = _normalize_filter_value("period_type", period_type) if period_type is not None else None
    read_options: dict[str, Any] = {"dataset": spec.dataset, "limit": bounded_limit,
                                  "scope_type": spec.scope_type,
                                  "scope_key": "market" if spec.scope_type == "market" else normalized_symbol}
    if spec.dataset.startswith("finance.") or spec.dataset == "company.shareholder_structure":
        read_options["source"] = "vietcap"
    if normalized_period:
        read_options["variant"] = f"{spec.dataset}.{normalized_period}"
    try:
        records = await service.get_raw_dataset_records_precise(normalized_symbol, **read_options)
    except MongoReadError as exc:
        raise ToolError(f"{exc}; this is not an empty result") from None
    except Exception:
        logger.warning("MCP MongoDB dataset read query_failed")
        raise ToolError("MongoDB analytical read query_failed; this is not an empty result") from None
    return {
        "symbol": normalized_symbol,
        "dataset": spec.dataset,
        "scope_type": spec.scope_type,
        "scope_key": "market" if spec.scope_type == "market" else normalized_symbol,
        "index_code": "VNINDEX" if spec.dataset.startswith("analytics.valuation.") else None,
        "limit": bounded_limit,
        "max_limit": spec.max_limit,
        "source": "mongodb:market_vnstock_premium_records",
        "retrieved_at": datetime.now(UTC).isoformat(),
        "provider_source": "vietcap" if spec.dataset.startswith("finance.") or spec.dataset == "company.shareholder_structure" else None,
        "period_type": normalized_period,
        "data_status": "available" if records else "empty",
        "freshness": "not_assessed; inspect observedAt/sourceDate and fiscal period",
        **serialize_data_value(getattr(records, "metadata", {})),
        "provider_execution": False,
        "row_count": len(records),
        "items": serialize_data_value(records),
    }


@mcp.tool()
async def get_intraday_trades(
    symbol: str,
    lookback_days: Annotated[int, Field(ge=1)] = 7,
    limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 20000})] = 1000,
) -> dict[str, Any]:
    """Get read-only intraday tick trades for one symbol from MongoDB (bounded symbols)."""
    _ensure_mongo_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    service = get_mongo_market_data_service()
    if int(lookback_days) < 1:
        raise ValueError("lookback_days must be positive")
    rows = await service.get_intraday_trades(
        normalized,
        lookback_days=max(1, int(lookback_days)),
        limit=_coerce_limit(limit, 20000),
    )
    return {
        "symbol": normalized,
        **_selected_store_metadata(rows),
        "retrieved_at": datetime.now(UTC).isoformat(),
        "row_count": len(rows),
        "limit": _coerce_limit(limit, 20000),
        "max_limit": 20000,
        "lookback_days": int(lookback_days),
        "items": serialize_data_value(rows),
    }


@mcp.tool()
async def get_price_depth(symbol: str, limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 5000})] = 500) -> dict[str, Any]:
    """Get read-only volume-at-price depth rows for one symbol from MongoDB.

    Rows are flat price levels from the newest ``updatedAt`` write batch.
    ``limit`` caps valid levels; ``observedAt`` is returned per row, separately
    from batch write time, which does not prove market-data freshness.
    """
    _ensure_mongo_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")

    service = get_mongo_market_data_service()
    rows = await service.get_price_depth_precise(
        normalized,
        limit=_coerce_limit(limit, 5000),
        include_provenance=True,
    )
    return {
        "symbol": normalized,
        **_selected_store_metadata(rows),
        "coverage": "current_write_batch; not historical session replay",
        "row_count": len(rows),
        "retrieved_at": datetime.now(UTC).isoformat(),
        "limit": _coerce_limit(limit, 5000),
        "max_limit": 5000,
        "items": serialize_data_value(rows),
    }


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
async def get_reference_dataset(
    symbol: str, store: str,
    limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 100})] = 100,
) -> dict[str, Any]:
    """Read IQ profiles or metric descriptors from their explicit physical Mongo store."""
    _ensure_mongo_available()
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")
    if store not in {"market_company_profiles", "market_financial_metric_map"}:
        raise ValueError("store must be market_company_profiles or market_financial_metric_map")
    bounded_limit = _coerce_limit(limit, 100)
    rows = await get_mongo_market_data_service().get_reference_records(normalized, store=store, limit=bounded_limit)
    return {"symbol": normalized, "source": f"mongodb:{store}", "provider_source": "vietcap",
            "retrieved_at": datetime.now(UTC).isoformat(),
            "row_count": len(rows), "items": serialize_data_value(rows), "limit": bounded_limit,
            "data_status": "available" if rows else "empty", "provider_execution": False,
            "freshness": "not_assessed; inspect source dates separately from ingestion"}


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
async def get_ingestion_receipts(
    symbol: str, dataset: str,
    limit: Annotated[int, Field(ge=0, json_schema_extra={"maximum": 20})] = 5,
) -> dict[str, Any]:
    """Read bounded acquisition receipts from the selected store; never run ingestion."""
    normalized = normalize_symbol_input(symbol)
    if not normalized:
        raise ValueError("A stock symbol is required")
    # Each dataset is persisted by its actual scheduler cycle owner; the legacy
    # supplemental cycle is still accepted so older receipts stay readable.
    supplemental = ("supplemental_company_maintenance",)
    dataset_owners: dict[str, tuple[str, ...]] = {
        "shareholders": supplemental, "officers": supplemental, "subsidiaries": supplemental,
        "company_news": supplemental, "insider_deals": supplemental,
        "profiles": ("daily_profile_maintenance",) + supplemental,
        "financials_year": ("daily_financial_maintenance",) + supplemental,
        "financials_quarter": ("daily_financial_maintenance",) + supplemental,
        "ratios_year": ("daily_financial_maintenance",) + supplemental,
        "ratios_quarter": ("financial_ratios_maintenance",) + supplemental,
        "iq_company_profile": ("iq_reference_maintenance",),
        "iq_shareholder_structure": ("iq_reference_maintenance",),
        "foreign_trading": ("foreign_trading_universe",),
        "intraday_trades": ("intraday_trades_universe",),
    }
    if dataset not in dataset_owners and dataset != "eod_catchup":
        raise ValueError("Unsupported receipt dataset; use a supplemental/trading/financial/IQ maintenance dataset or eod_catchup")
    bounded_limit = _coerce_limit(limit, 20)
    if dataset == "eod_catchup":
        _ensure_mongo_available()
        rows = await get_mongo_market_data_service().get_eod_catchup_receipts(normalized, limit=bounded_limit)
        store = "mongodb:market_eod_catchup_receipts"
    else:
        await _ensure_database_available()
        receipt_path = SyncStatus.additional_data["stages"][dataset]["receipts"][normalized]
        statement = select(SyncStatus).where(
            SyncStatus.sync_type.in_(dataset_owners[dataset]),
            receipt_path.as_string().is_not(None),
        ).order_by(SyncStatus.id.desc()).limit(bounded_limit)
        async with async_session_maker() as session:
            records = (await session.execute(statement)).scalars().all()
        rows = []
        for record in records:
            metadata = record.additional_data
            stage = metadata["stages"][dataset]
            expected_count = metadata.get("expected_count")
            pending_count = stage.get("pending_count")
            complete = None
            if isinstance(metadata.get("expected_symbols"), list):
                expected_symbols = set(metadata["expected_symbols"])
                acquired_symbols = set(stage.get("acquired_symbols", []))
                outstanding = expected_symbols - acquired_symbols
                outstanding.update(
                    symbol for symbol in expected_symbols
                    if stage["receipts"].get(symbol, {}).get("outcome") in {"failed", "deferred", "attempted", "pending"}
                    or stage["receipts"].get(symbol, {}).get("revalidation_pending")
                )
                expected_count = len(expected_symbols)
                pending_count = len(outstanding)
                complete = pending_count == 0
            rows.append({"record_id": record.id, "sync_type": record.sync_type,
                         "status": record.status, "started_at": record.started_at,
                         "completed_at": record.completed_at,
                         "expected_count": expected_count,
                         "pending_count": pending_count, "complete": complete,
                         "receipt": stage["receipts"][normalized]})
        store = "postgres:sync_status"
    return {"symbol": normalized, "dataset": dataset, "source": store,
            "retrieved_at": datetime.now(UTC).isoformat(),
            "items": serialize_data_value(rows), "row_count": len(rows), "limit": bounded_limit,
            "data_status": "available" if rows else "empty", "provider_execution": False,
            "coverage": "Acquisition receipts do not certify historical/session completeness"}


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
    async def _request_auth_guard(request: Request, call_next):
        request.state.matrix_user = None
        if request.url.path == "/health":
            return await call_next(request)

        expected = settings.vnibb_mcp_shared_bearer_token
        received = request.headers.get("authorization", "")
        if expected and hmac.compare_digest(received.encode(), f"Bearer {expected}".encode()):
            return await call_next(request)

        if received:
            try:
                request.state.matrix_user = await require_active_user(received)
            except HTTPException as exc:
                return JSONResponse(
                    status_code=503 if exc.status_code == 503 else 401,
                    content={"error": True, "message": "Missing or invalid VNIBB MCP bearer token"},
                    headers={"WWW-Authenticate": "Bearer"},
                )
        elif expected:
            return JSONResponse(
                status_code=401,
                content={"error": True, "message": "Missing or invalid VNIBB MCP bearer token"},
                headers={"WWW-Authenticate": "Bearer"},
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
                "database": database_runtime_summary(),
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
