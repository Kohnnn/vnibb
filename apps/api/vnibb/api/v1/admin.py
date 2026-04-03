"""Admin API endpoints for database inspection and management."""

import json
import logging
import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks, Header, Body
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.database import get_db, engine
from vnibb.core.cache import redis_client
from vnibb.core.config import settings
from vnibb.core.appwrite_client import check_appwrite_connectivity, appwrite_runtime_summary
from vnibb.core.middleware.logging import get_recent_error_events
from vnibb.models.sync_status import SyncStatus
from vnibb.services.ai_prompt_library_service import ai_prompt_library_service
from vnibb.services.ai_runtime_config_service import ai_runtime_config_service
from vnibb.services.ai_telemetry_service import ai_telemetry_service
from vnibb.services.system_layout_template_service import (
    SYSTEM_DASHBOARD_KEYS,
    SystemLayoutTemplateBundleResponse,
    SystemLayoutTemplateListResponse,
    system_layout_template_service,
)

router = APIRouter(tags=["Admin"])
logger = logging.getLogger(__name__)

TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TIMESTAMP_CANDIDATES = [
    "updated_at",
    "created_at",
    "fetched_at",
    "published_date",
    "event_date",
    "date",
    "time",
]
FRESHNESS_THRESHOLDS_HOURS = {
    "fresh": 6,
    "recent": 24,
    "stale": 72,
}
FRESHNESS_TABLES = [
    "stocks",
    "companies",
    "screener_snapshots",
    "stock_prices",
    "stock_indices",
    "income_statements",
    "balance_sheets",
    "cash_flows",
    "financial_ratios",
    "dividends",
    "company_news",
    "company_events",
]
SYNC_STATUS_STALE_HOURS = 24


def require_admin_access(
    x_admin_key: Optional[str] = Header(default=None, alias="X-Admin-Key"),
) -> None:
    """Protect sensitive admin endpoints with optional API key auth."""
    configured_key = settings.admin_api_key
    if not configured_key:
        if settings.environment.lower() == "production":
            raise HTTPException(
                status_code=503,
                detail="ADMIN_API_KEY must be configured to access this endpoint in production",
            )
        return

    if x_admin_key != configured_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.get("/ai-telemetry", dependencies=[Depends(require_admin_access)])
async def get_ai_telemetry(limit: int = Query(default=25, ge=1, le=200)) -> Dict[str, Any]:
    records = ai_telemetry_service.get_recent_records(limit=limit)
    return {
        "count": len(records),
        "data": records,
    }


@router.get("/ai-runtime", dependencies=[Depends(require_admin_access)])
async def get_ai_runtime_config() -> Dict[str, Any]:
    return await ai_runtime_config_service.get_runtime_config()


@router.put("/ai-runtime", dependencies=[Depends(require_admin_access)])
async def save_ai_runtime_config(model: str = Body(..., embed=True)) -> Dict[str, Any]:
    normalized = str(model or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Model is required")
    return await ai_runtime_config_service.save_runtime_config(model=normalized)


@router.get("/ai-prompts", dependencies=[Depends(require_admin_access)])
async def get_ai_prompt_library() -> Dict[str, Any]:
    prompts = await ai_prompt_library_service.get_shared_prompts()
    return {"count": len(prompts), "data": prompts}


@router.put("/ai-prompts", dependencies=[Depends(require_admin_access)])
async def save_ai_prompt_library(data: Any = Body(...)) -> Dict[str, Any]:
    prompts = data.get("prompts") if isinstance(data, dict) else None
    if not isinstance(prompts, list):
        raise HTTPException(status_code=400, detail="prompts array is required")
    saved = await ai_prompt_library_service.save_shared_prompts(prompts)
    return {"count": len(saved), "data": saved}


@router.get("/providers/status", dependencies=[Depends(require_admin_access)])
async def get_provider_status() -> Dict[str, Any]:
    """Return runtime provider configuration and migration connectivity status."""
    appwrite_health = await check_appwrite_connectivity(timeout_seconds=2.5)
    ai_runtime = await ai_runtime_config_service.get_runtime_config()
    return {
        "environment": settings.environment,
        "providers": {
            "data_backend_requested": settings.data_backend,
            "data_backend": settings.resolved_data_backend,
            "cache_backend": settings.resolved_cache_backend,
            "appwrite_configured": settings.is_appwrite_configured,
            "vnstock_source": settings.vnstock_source,
            "vnstock_timeout_seconds": settings.vnstock_timeout,
            "vnstock_api_key_configured": bool(settings.vnstock_api_key),
            "openrouter_configured": bool(settings.openrouter_api_key),
            "ai_runtime_provider": ai_runtime.get("provider"),
            "ai_runtime_model": ai_runtime.get("model"),
        },
        "appwrite": appwrite_health,
        "appwrite_runtime": appwrite_runtime_summary(),
    }


@router.get(
    "/system-layouts",
    response_model=SystemLayoutTemplateListResponse,
    dependencies=[Depends(require_admin_access)],
)
async def list_admin_system_layouts() -> SystemLayoutTemplateListResponse:
    records = []
    for dashboard_key in SYSTEM_DASHBOARD_KEYS:
        bundle = await system_layout_template_service.get_template_bundle(dashboard_key)
        if bundle.draft is not None:
            records.append(bundle.draft)
        if bundle.published is not None:
            records.append(bundle.published)
    return SystemLayoutTemplateListResponse(count=len(records), data=records)


@router.get(
    "/system-layouts/{dashboard_key}",
    response_model=SystemLayoutTemplateBundleResponse,
    dependencies=[Depends(require_admin_access)],
)
async def get_admin_system_layout_bundle(dashboard_key: str) -> SystemLayoutTemplateBundleResponse:
    return await system_layout_template_service.get_template_bundle(dashboard_key)


@router.put(
    "/system-layouts/{dashboard_key}",
    response_model=SystemLayoutTemplateBundleResponse,
    dependencies=[Depends(require_admin_access)],
)
async def save_admin_system_layout(
    dashboard_key: str,
    data: Any = Body(...),
    x_admin_actor: Optional[str] = Header(default=None, alias="X-Admin-Actor"),
) -> SystemLayoutTemplateBundleResponse:
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"request body string is not valid JSON: {exc}"
            ) from exc

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="request body must be a JSON object")

    dashboard_payload = data.get("dashboard")
    if isinstance(dashboard_payload, str):
        try:
            dashboard_payload = json.loads(dashboard_payload)
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"dashboard payload string is not valid JSON: {exc}"
            ) from exc

    if not isinstance(dashboard_payload, dict):
        raise HTTPException(status_code=400, detail="dashboard payload must be an object")

    notes_value = data.get("notes")
    if notes_value is not None and not isinstance(notes_value, str):
        notes_value = str(notes_value)

    publish_value = bool(data.get("publish", False))
    updated_by = (x_admin_actor or "admin").strip() or "admin"
    return await system_layout_template_service.save_dashboard_template(
        dashboard_key=dashboard_key,
        dashboard=dashboard_payload,
        notes=notes_value,
        updated_by=updated_by,
        publish=publish_value,
    )


def _quote_identifier(table_name: str) -> str:
    if not TABLE_NAME_PATTERN.fullmatch(table_name):
        raise HTTPException(status_code=400, detail="Invalid table name")
    return f'"{table_name}"'


async def _discover_tables(db: AsyncSession) -> list[str]:
    if engine.dialect.name == "postgresql":
        result = await db.execute(
            text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
        )
        return [row[0] for row in result.fetchall() if row[0]]

    result = await db.execute(
        text(
            """
            SELECT name
            FROM sqlite_master
            WHERE type='table'
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        )
    )
    return [row[0] for row in result.fetchall() if row[0]]


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    if engine.dialect.name == "postgresql":
        result = await db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = :table_name
                LIMIT 1
                """
            ),
            {"table_name": table_name},
        )
        return result.first() is not None

    result = await db.execute(
        text(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type='table'
              AND name = :table_name
            LIMIT 1
            """
        ),
        {"table_name": table_name},
    )
    return result.first() is not None


async def _discover_timestamp_column(db: AsyncSession, table_name: str) -> Optional[str]:
    if engine.dialect.name == "postgresql":
        result = await db.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = :table_name
                """
            ),
            {"table_name": table_name},
        )
        columns = {row[0] for row in result.fetchall()}
    else:
        result = await db.execute(text(f"PRAGMA table_info({_quote_identifier(table_name)})"))
        columns = {row[1] for row in result.fetchall()}

    for candidate in TIMESTAMP_CANDIDATES:
        if candidate in columns:
            return candidate

    return None


def _normalize_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            return None
    return None


def _classify_freshness(latest: Optional[datetime]) -> tuple[str, Optional[int]]:
    if not latest:
        return "unknown", None

    age_seconds = int((datetime.utcnow() - latest).total_seconds())
    if age_seconds < FRESHNESS_THRESHOLDS_HOURS["fresh"] * 3600:
        return "fresh", age_seconds
    if age_seconds < FRESHNESS_THRESHOLDS_HOURS["recent"] * 3600:
        return "recent", age_seconds
    if age_seconds < FRESHNESS_THRESHOLDS_HOURS["stale"] * 3600:
        return "stale", age_seconds
    return "critical", age_seconds


async def _select_priority_symbols(db: AsyncSession, limit: int) -> list[str]:
    """Pick top symbols for targeted recovery jobs."""
    symbols: list[str] = []
    seen: set[str] = set()

    try:
        # Pull a larger window, then de-duplicate symbols in Python.
        screener_rows = await db.execute(
            text(
                """
                SELECT symbol
                FROM screener_snapshots
                WHERE symbol IS NOT NULL
                ORDER BY snapshot_date DESC, COALESCE(market_cap, 0) DESC
                LIMIT :window
                """
            ),
            {"window": max(limit * 6, limit)},
        )

        for row in screener_rows.fetchall():
            raw_symbol = row[0]
            if not raw_symbol:
                continue
            symbol = str(raw_symbol).upper().strip()
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            symbols.append(symbol)
            if len(symbols) >= limit:
                return symbols
    except Exception:
        await db.rollback()

    if len(symbols) >= limit:
        return symbols[:limit]

    fallback_rows = await db.execute(
        text(
            """
            SELECT symbol
            FROM stocks
            WHERE symbol IS NOT NULL
            ORDER BY symbol ASC
            LIMIT :window
            """
        ),
        {"window": max(limit * 3, limit)},
    )

    for row in fallback_rows.fetchall():
        raw_symbol = row[0]
        if not raw_symbol:
            continue
        symbol = str(raw_symbol).upper().strip()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
        if len(symbols) >= limit:
            break

    return symbols[:limit]


def _append_unique_symbols(
    target: list[str],
    seen: set[str],
    raw_symbols: list[Any],
    limit: int,
) -> None:
    for value in raw_symbols:
        if value is None:
            continue
        symbol = str(value).upper().strip()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        target.append(symbol)
        if len(target) >= limit:
            return


async def _collect_reinforcement_candidates(db: AsyncSession, limit: int) -> list[str]:
    """Collect symbols with stale or incomplete key metrics for reinforcement jobs."""
    symbols: list[str] = []
    seen: set[str] = set()
    cutoff = datetime.utcnow() - timedelta(hours=24)

    try:
        if await _table_exists(db, "screener_snapshots"):
            screener_result = await db.execute(
                text(
                    """
                    SELECT symbol
                    FROM screener_snapshots
                    WHERE symbol IS NOT NULL
                      AND (
                        market_cap IS NULL
                        OR perf_1w <= -90 OR perf_1m <= -90 OR perf_ytd <= -90
                        OR ABS(COALESCE(change_1d, 0)) >= 40
                      )
                    ORDER BY snapshot_date DESC
                    LIMIT :limit
                    """
                ),
                {"limit": max(limit * 2, limit)},
            )
            _append_unique_symbols(
                symbols, seen, [row[0] for row in screener_result.fetchall()], limit
            )

        if len(symbols) < limit and await _table_exists(db, "stock_prices"):
            stale_prices_result = await db.execute(
                text(
                    """
                    SELECT symbol
                    FROM (
                        SELECT symbol, MAX(time) AS latest_time
                        FROM stock_prices
                        GROUP BY symbol
                    ) latest_prices
                    WHERE symbol IS NOT NULL
                      AND (latest_time IS NULL OR latest_time < :cutoff)
                    LIMIT :limit
                    """
                ),
                {
                    "cutoff": cutoff,
                    "limit": max(limit * 2, limit),
                },
            )
            _append_unique_symbols(
                symbols, seen, [row[0] for row in stale_prices_result.fetchall()], limit
            )

        if len(symbols) < limit and await _table_exists(db, "financial_ratios"):
            ratio_result = await db.execute(
                text(
                    """
                    SELECT symbol
                    FROM financial_ratios
                    WHERE symbol IS NOT NULL
                      AND (
                        dps IS NULL
                        OR dividend_yield IS NULL
                        OR payout_ratio IS NULL
                        OR ABS(COALESCE(dividend_yield, 0)) > 100
                        OR updated_at < :cutoff
                      )
                    ORDER BY updated_at ASC
                    LIMIT :limit
                    """
                ),
                {"cutoff": cutoff, "limit": max(limit * 2, limit)},
            )
            _append_unique_symbols(
                symbols, seen, [row[0] for row in ratio_result.fetchall()], limit
            )

        if len(symbols) < limit and await _table_exists(db, "shareholders"):
            shareholder_result = await db.execute(
                text(
                    """
                    SELECT symbol
                    FROM shareholders
                    WHERE symbol IS NOT NULL
                      AND (shares_held IS NULL OR ownership_pct IS NULL)
                    ORDER BY updated_at DESC
                    LIMIT :limit
                    """
                ),
                {"limit": max(limit * 2, limit)},
            )
            _append_unique_symbols(
                symbols, seen, [row[0] for row in shareholder_result.fetchall()], limit
            )
    except Exception:
        await db.rollback()

    if len(symbols) < limit:
        fallback = await _select_priority_symbols(db, limit)
        _append_unique_symbols(symbols, seen, fallback, limit)

    return symbols[:limit]


@router.get("/database/tables")
async def list_all_tables(db: AsyncSession = Depends(get_db)):
    """List all database tables with row counts and freshness metadata."""
    tables_info = []
    table_names = await _discover_tables(db)

    for table_name in table_names:
        try:
            quoted_table = _quote_identifier(table_name)
            count_result = await db.execute(text(f"SELECT COUNT(*) FROM {quoted_table}"))
            count = count_result.scalar() or 0
            latest = None
            updated_at_column = await _discover_timestamp_column(db, table_name)
            if updated_at_column:
                ts_result = await db.execute(
                    text(f'SELECT MAX("{updated_at_column}") FROM {quoted_table}')
                )
                latest = ts_result.scalar()

            latest_dt = _normalize_datetime(latest)
            freshness, age_seconds = _classify_freshness(latest_dt)

            tables_info.append(
                {
                    "name": table_name,
                    "count": count,
                    "updated_at_column": updated_at_column,
                    "last_updated": latest_dt.isoformat()
                    if latest_dt
                    else str(latest)
                    if latest
                    else None,
                    "freshness": freshness,
                    "age_seconds": age_seconds,
                }
            )
        except Exception as e:
            await db.rollback()
            tables_info.append(
                {"name": table_name, "count": 0, "freshness": "unknown", "error": str(e)}
            )

    tables_info.sort(key=lambda x: x["count"], reverse=True)
    return {
        "tables": tables_info,
        "total_tables": len(tables_info),
        "timestamp": datetime.utcnow().isoformat(),
        "last_checked": datetime.utcnow().isoformat(),
    }


@router.get("/errors/recent")
async def get_recent_errors(
    limit: int = Query(default=50, ge=1, le=200),
    since: Optional[str] = Query(default=None),
    _auth: None = Depends(require_admin_access),
):
    """Return recent server-side request errors captured by middleware."""
    errors = get_recent_error_events(limit=limit)
    since_dt: Optional[datetime] = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid since timestamp: {since}"
            ) from exc

    if since_dt is not None:
        filtered_errors = []
        for item in errors:
            raw_timestamp = item.get("timestamp")
            try:
                event_time = datetime.fromisoformat(
                    str(raw_timestamp).replace("Z", "+00:00")
                ).replace(tzinfo=None)
            except ValueError:
                continue
            if event_time >= since_dt:
                filtered_errors.append(item)
        errors = filtered_errors

    endpoint_counts = Counter(item.get("path") or "unknown" for item in errors)
    grouped = [
        {
            "path": path,
            "count": count,
        }
        for path, count in endpoint_counts.most_common()
    ]

    hydrated_errors = [
        {
            **item,
            "stack_trace": (item.get("stack_trace") or "")[:500] or None,
        }
        for item in errors[:limit]
    ]
    return {
        "timestamp": datetime.utcnow().isoformat(),
        "since": since_dt.isoformat() if since_dt else None,
        "count": len(hydrated_errors),
        "grouped_by_endpoint": grouped,
        "errors": hydrated_errors,
    }


@router.get("/database/freshness-summary")
async def get_freshness_summary(db: AsyncSession = Depends(get_db)):
    """
    Summarize dataset freshness for key tables with warning buckets.

    Status buckets:
    - fresh: <= 6h
    - recent: <= 24h
    - stale: <= 72h
    - critical: > 72h
    - unknown: no timestamp signal
    """
    available_tables = set(await _discover_tables(db))
    prioritized_targets = [table for table in FRESHNESS_TABLES if table in available_tables]
    remaining_targets = sorted(table for table in available_tables if table not in FRESHNESS_TABLES)
    targets = prioritized_targets + remaining_targets
    entries = []

    for table_name in targets:
        quoted_table = _quote_identifier(table_name)
        count_result = await db.execute(text(f"SELECT COUNT(*) FROM {quoted_table}"))
        row_count = int(count_result.scalar() or 0)

        updated_at_column = await _discover_timestamp_column(db, table_name)
        latest_value = None
        if updated_at_column:
            ts_result = await db.execute(
                text(f'SELECT MAX("{updated_at_column}") FROM {quoted_table}')
            )
            latest_value = ts_result.scalar()

        latest_dt = _normalize_datetime(latest_value)
        freshness, age_seconds = _classify_freshness(latest_dt)

        entries.append(
            {
                "table": table_name,
                "count": row_count,
                "updated_at_column": updated_at_column,
                "last_updated": latest_dt.isoformat()
                if latest_dt
                else str(latest_value)
                if latest_value
                else None,
                "freshness": freshness,
                "age_seconds": age_seconds,
            }
        )

    summary: dict[str, int] = {"fresh": 0, "recent": 0, "stale": 0, "critical": 0, "unknown": 0}
    for entry in entries:
        key = entry["freshness"]
        summary[key] = summary.get(key, 0) + 1

    warning_tables = [
        entry for entry in entries if entry["freshness"] in {"stale", "critical", "unknown"}
    ]

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "thresholds_hours": FRESHNESS_THRESHOLDS_HOURS,
        "summary": summary,
        "entries": entries,
        "tables": entries,
        "warning_tables": warning_tables,
    }


@router.get("/data-health")
async def get_data_health(db: AsyncSession = Depends(get_db)):
    """Compact data freshness endpoint for dashboard widgets."""
    freshness = await get_freshness_summary(db)
    entries = freshness.get("entries", [])

    tables: dict[str, dict[str, Any]] = {}
    staleness_alerts: list[dict[str, Any]] = []

    for entry in entries:
        table_name = entry.get("table")
        if not table_name:
            continue

        freshness_level = entry.get("freshness")
        age_seconds = entry.get("age_seconds")
        age_days = round((age_seconds or 0) / 86400, 2) if age_seconds is not None else None

        tables[table_name] = {
            "count": entry.get("count", 0),
            "latest": entry.get("last_updated"),
            "freshness": freshness_level,
            "age_seconds": age_seconds,
            "age_days": age_days,
        }

        if freshness_level in {"stale", "critical", "unknown"}:
            staleness_alerts.append(
                {
                    "table": table_name,
                    "freshness": freshness_level,
                    "days_stale": age_days,
                    "severity": "critical" if freshness_level == "critical" else "warning",
                }
            )

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "tables": tables,
        "staleness_alerts": staleness_alerts,
        "summary": freshness.get("summary", {}),
    }


@router.post("/data-health/auto-backfill")
async def trigger_data_health_auto_backfill(
    background_tasks: BackgroundTasks,
    days_stale: int = Query(default=7, ge=1, le=90),
    limit_symbols: int = Query(default=50, ge=5, le=200),
    dry_run: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
):
    """
    Build and optionally schedule targeted data recovery jobs for stale tables.

    - Uses `/admin/database/freshness-summary` internals as source of truth.
    - Applies a staleness threshold in days (default: 7).
    - Schedules conservative background jobs when `dry_run=false`.
    """
    freshness = await get_freshness_summary(db)
    entries = freshness.get("entries", [])
    min_age_seconds = days_stale * 24 * 60 * 60

    stale_entries = [
        entry
        for entry in entries
        if (entry.get("age_seconds") is not None)
        and int(entry.get("age_seconds") or 0) >= min_age_seconds
    ]
    stale_tables = sorted(
        {str(entry.get("table")) for entry in stale_entries if entry.get("table")}
    )

    symbols = await _select_priority_symbols(db, limit_symbols)

    from vnibb.services.data_pipeline import data_pipeline

    jobs: list[dict[str, Any]] = []
    scheduled_count = 0

    def maybe_add_job(
        key: str,
        reason: str,
        fn,
        kwargs: Optional[dict[str, Any]] = None,
    ) -> None:
        nonlocal scheduled_count
        payload = {
            "job": key,
            "reason": reason,
            "args": kwargs or {},
        }
        jobs.append(payload)
        if not dry_run:
            background_tasks.add_task(fn, **(kwargs or {}))
            scheduled_count += 1

    stale_set = set(stale_tables)

    if stale_set.intersection({"stock_prices"}):
        maybe_add_job(
            "sync_daily_prices",
            "Stock prices older than threshold",
            data_pipeline.sync_daily_prices,
            {"symbols": symbols, "days": min(days_stale + 3, 30)},
        )

    if stale_set.intersection({"screener_snapshots"}):
        maybe_add_job(
            "sync_screener_data",
            "Screener snapshots older than threshold",
            data_pipeline.sync_screener_data,
            {},
        )

    if stale_set.intersection({"income_statements", "balance_sheets", "cash_flows"}):
        maybe_add_job(
            "sync_financials_quarter",
            "Statement tables are stale",
            data_pipeline.sync_financials,
            {"symbols": symbols, "period": "quarter"},
        )

    if stale_set.intersection({"financial_ratios"}):
        maybe_add_job(
            "sync_financial_ratios_quarter",
            "Financial ratios table is stale",
            data_pipeline.sync_financial_ratios,
            {"symbols": symbols, "period": "quarter"},
        )

    if stale_set.intersection({"company_news"}):
        maybe_add_job(
            "sync_company_news",
            "Company news table is stale",
            data_pipeline.sync_company_news,
            {"symbols": symbols, "limit": 30},
        )

    if stale_set.intersection({"company_events"}):
        maybe_add_job(
            "sync_company_events",
            "Company events table is stale",
            data_pipeline.sync_company_events,
            {"symbols": symbols, "limit": 40},
        )

    if stale_set.intersection({"foreign_trading", "order_flow_daily", "intraday_trades"}):
        maybe_add_job(
            "run_daily_trading_updates",
            "Trading flow tables are stale",
            data_pipeline.run_daily_trading_updates,
            {"trade_date": None, "resume": False},
        )

    if stale_set.intersection({"shareholders"}):
        maybe_add_job(
            "sync_shareholders",
            "Shareholders table is stale",
            data_pipeline.sync_shareholders,
            {"symbols": symbols},
        )

    if stale_set.intersection({"officers"}):
        maybe_add_job(
            "sync_officers",
            "Officers table is stale",
            data_pipeline.sync_officers,
            {"symbols": symbols},
        )

    if stale_set.intersection({"market_sectors", "sector_performance", "stock_indices"}):
        maybe_add_job(
            "sync_market_sectors",
            "Market reference tables are stale",
            data_pipeline.sync_market_sectors,
            {},
        )

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "dry_run": dry_run,
        "threshold_days": days_stale,
        "stale_tables": stale_tables,
        "selected_symbol_count": len(symbols),
        "selected_symbols_preview": symbols[:10],
        "jobs": jobs,
        "jobs_scheduled": scheduled_count,
    }


async def _schedule_data_reinforcement(
    background_tasks: BackgroundTasks,
    db: AsyncSession,
    symbols: Optional[List[str]],
    domains: Optional[List[str]],
    dry_run: bool,
    max_symbols: int,
    mode: Optional[str] = None,
) -> Dict[str, Any]:
    """Schedule targeted symbol reinforcement jobs with stale/explicit selection modes."""
    from vnibb.services.data_pipeline import data_pipeline

    max_symbols = max(5, min(max_symbols, 200))
    mode_upper = str(mode or "").strip().upper()
    if mode_upper and mode_upper not in {"STALE", "SYMBOLS"}:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Unsupported mode",
                "mode": mode,
                "allowed_modes": ["STALE", "SYMBOLS"],
            },
        )

    input_symbols = [
        str(symbol).upper().strip() for symbol in (symbols or []) if symbol and str(symbol).strip()
    ]

    if mode_upper == "STALE":
        stale_requested = True
        explicit_symbols: list[str] = []
    elif mode_upper == "SYMBOLS":
        stale_requested = False
        explicit_symbols = sorted({symbol for symbol in input_symbols})
        if not explicit_symbols:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "mode=SYMBOLS requires at least one symbol",
                    "mode": "SYMBOLS",
                },
            )
    else:
        stale_requested = not input_symbols or "STALE" in input_symbols
        explicit_symbols = sorted({symbol for symbol in input_symbols if symbol != "STALE"})

    if explicit_symbols:
        normalized_symbols = explicit_symbols[:max_symbols]
    else:
        normalized_symbols = await _collect_reinforcement_candidates(db, limit=max_symbols)

    requested_domains = {
        str(domain).strip().lower()
        for domain in (domains or ["prices", "financials", "ratios", "shareholders"])
        if domain and str(domain).strip()
    }
    allowed_domains = {"prices", "financials", "ratios", "shareholders", "officers"}
    invalid_domains = sorted(requested_domains - allowed_domains)
    if invalid_domains:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Unsupported domains requested",
                "invalid_domains": invalid_domains,
                "allowed_domains": sorted(allowed_domains),
            },
        )

    request_cost_weights = {
        "prices": 2,
        "financials": 4,
        "ratios": 4,
        "shareholders": 2,
        "officers": 2,
    }
    estimated_requests = len(normalized_symbols) * sum(
        request_cost_weights.get(domain, 1) for domain in requested_domains
    )
    estimated_seconds = max(1, estimated_requests)
    estimated_minutes = round(estimated_seconds / 60, 1)

    jobs = [
        {
            "job": "run_reinforcement",
            "args": {
                "symbols": normalized_symbols,
                "domains": sorted(requested_domains),
            },
            "estimated_requests": estimated_requests,
            "estimated_minutes": estimated_minutes,
            "rate_budget": "1 req/sec reinforcement limiter",
        }
    ]

    scheduled_count = 0
    if not dry_run:
        background_tasks.add_task(
            data_pipeline.run_reinforcement,
            symbols=normalized_symbols,
            domains=sorted(requested_domains),
        )
        scheduled_count = 1

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "dry_run": dry_run,
        "selection_mode": "stale" if stale_requested and not explicit_symbols else "explicit",
        "mode": "STALE" if stale_requested and not explicit_symbols else "SYMBOLS",
        "domains": sorted(requested_domains),
        "targets": sorted(requested_domains),
        "symbols_count": len(normalized_symbols),
        "queued": len(normalized_symbols),
        "symbols_preview": normalized_symbols[:15],
        "jobs": jobs,
        "estimated_requests": estimated_requests,
        "eta_minutes": estimated_minutes,
        "estimated_completion_minutes": estimated_minutes,
        "jobs_scheduled": scheduled_count,
    }


@router.get("/reinforce")
async def trigger_data_reinforcement_get(
    background_tasks: BackgroundTasks,
    mode: str = Query(
        default="STALE",
        pattern=r"^(STALE|SYMBOLS)$",
        description="Selection mode: STALE (auto-select) or SYMBOLS",
    ),
    symbols: Optional[str] = Query(
        default=None,
        description="Comma-separated symbols when mode=SYMBOLS",
    ),
    targets: str = Query(
        default="ratios,prices,financials",
        description="Comma-separated targets: prices,financials,ratios,shareholders,officers",
    ),
    dry_run: bool = Query(default=True),
    max_symbols: int = Query(default=50, ge=5, le=200),
    db: AsyncSession = Depends(get_db),
):
    parsed_symbols = [
        value.strip().upper() for value in (symbols or "").split(",") if value and value.strip()
    ]
    parsed_targets = [
        value.strip().lower() for value in (targets or "").split(",") if value and value.strip()
    ]

    return await _schedule_data_reinforcement(
        background_tasks=background_tasks,
        db=db,
        symbols=parsed_symbols,
        domains=parsed_targets,
        dry_run=dry_run,
        max_symbols=max_symbols,
        mode=mode,
    )


@router.post("/reinforce")
@router.post("/data-health/reinforce")
async def trigger_data_reinforcement(
    background_tasks: BackgroundTasks,
    mode: Optional[str] = Body(default=None, embed=True),
    symbols: Optional[List[str]] = Body(default=None, embed=True),
    domains: Optional[List[str]] = Body(default=None, embed=True),
    targets: Optional[List[str]] = Body(default=None, embed=True),
    dry_run: bool = Body(default=True, embed=True),
    max_symbols: int = Body(default=50, embed=True),
    db: AsyncSession = Depends(get_db),
):
    """
    Schedule targeted reinforcement jobs.

    Accepted payload shapes:
    - Legacy: { symbols: [...], domains: [...] }
    - Sprint mode: { mode: "STALE"|"SYMBOLS", symbols: [...], targets: [...] }
    """
    selected_domains = domains if domains is not None else targets

    return await _schedule_data_reinforcement(
        background_tasks=background_tasks,
        db=db,
        symbols=symbols,
        domains=selected_domains,
        dry_run=dry_run,
        max_symbols=max_symbols,
        mode=mode,
    )


@router.get("/database/table/{table_name}/schema")
async def get_table_schema(table_name: str, db: AsyncSession = Depends(get_db)):
    """Get column metadata for a table."""
    _quote_identifier(table_name)
    if not await _table_exists(db, table_name):
        raise HTTPException(status_code=404, detail="Table not found")
    try:
        if engine.dialect.name == "postgresql":
            columns_result = await db.execute(
                text(
                    """
                    SELECT
                        column_name,
                        data_type,
                        is_nullable,
                        column_default
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = :table_name
                    ORDER BY ordinal_position
                    """
                ),
                {"table_name": table_name},
            )
            columns = columns_result.mappings().all()

            pk_result = await db.execute(
                text(
                    """
                    SELECT kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema = kcu.table_schema
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                      AND tc.table_schema = 'public'
                      AND tc.table_name = :table_name
                    """
                ),
                {"table_name": table_name},
            )
            pk_columns = {row["column_name"] for row in pk_result.mappings().all()}

            return {
                "table": table_name,
                "columns": [
                    {
                        "name": col["column_name"],
                        "type": col["data_type"],
                        "nullable": col["is_nullable"] == "YES",
                        "default": col["column_default"],
                        "primary_key": col["column_name"] in pk_columns,
                    }
                    for col in columns
                ],
            }

        result = await db.execute(text(f"PRAGMA table_info({_quote_identifier(table_name)})"))
        columns = result.fetchall()
        return {
            "table": table_name,
            "columns": [
                {
                    "name": col[1],
                    "type": col[2],
                    "nullable": not col[3],
                    "default": col[4],
                    "primary_key": bool(col[5]),
                }
                for col in columns
            ],
        }
    except Exception as e:
        return {"error": str(e)}


@router.get("/database/table/{table_name}/sample")
@router.get("/database/sample/{table_name}")
async def get_table_sample(
    table_name: str,
    limit: int = Query(default=10, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Get sample rows from a table with pagination and optional search."""
    _quote_identifier(table_name)
    if not await _table_exists(db, table_name):
        raise HTTPException(status_code=404, detail="Table not found")
    try:
        quoted_table = _quote_identifier(table_name)
        where_clause = ""
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if search:
            schema = await get_table_schema(table_name, db)
            text_cols = [
                c["name"]
                for c in schema.get("columns", [])
                if "TEXT" in str(c["type"]).upper() or "CHAR" in str(c["type"]).upper()
            ]
            if text_cols:
                where_clause = " WHERE " + " OR ".join(
                    [f'LOWER(CAST("{col}" AS TEXT)) LIKE :s' for col in text_cols]
                )
                params["s"] = f"%{search.lower()}%"

        query = f"SELECT * FROM {quoted_table}{where_clause} LIMIT :limit OFFSET :offset"
        result = await db.execute(text(query), params)
        rows = result.mappings().all()

        count_params = {"s": params["s"]} if "s" in params else {}
        count_res = await db.execute(
            text(f"SELECT COUNT(*) FROM {quoted_table}{where_clause}"), count_params
        )
        total = count_res.scalar()

        data = []
        for row in rows:
            rd = dict(row)
            for k, v in rd.items():
                if hasattr(v, "isoformat"):
                    rd[k] = v.isoformat()
                elif isinstance(v, bytes):
                    rd[k] = v.hex()
            data.append(rd)

        return {
            "table": table_name,
            "rows": data,
            "total": total,
            "count": len(data),
            "has_more": offset + len(data) < total,
        }
    except Exception as e:
        return {"error": str(e)}


@router.post("/database/query")
async def execute_query(query: str = Body(..., embed=True), db: AsyncSession = Depends(get_db)):
    """Execute read-only SQL query (SELECT only)."""
    if not query.strip().upper().startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT allowed")
    try:
        result = await db.execute(text(query))
        rows = result.mappings().all()
        data = []
        for row in rows:
            rd = dict(row)
            for k, v in rd.items():
                if hasattr(v, "isoformat"):
                    rd[k] = v.isoformat()
            data.append(rd)
        return {"query": query, "count": len(data), "rows": data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/sync-status")
@router.get("/database/sync-status")
@router.get("/sync/status")
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    """Get sync status for all tables."""
    status_data = {
        "timestamp": datetime.utcnow().isoformat(),
        "sync_jobs": [],
        "data_freshness": {},
    }

    stale_cutoff = datetime.utcnow() - timedelta(hours=SYNC_STATUS_STALE_HOURS)

    # 1. Auto-mark stale running jobs before returning recent sync jobs.
    try:
        result = await db.execute(
            select(SyncStatus).where(
                SyncStatus.status == "running",
                SyncStatus.started_at < stale_cutoff,
            )
        )
        stale_rows = result.scalars().all()
        for record in stale_rows:
            record.status = "failed"
            record.completed_at = record.completed_at or datetime.utcnow()
            errors = record.errors if isinstance(record.errors, dict) else {}
            errors["reason"] = "stale_timeout"
            record.errors = errors
            additional_data = (
                record.additional_data if isinstance(record.additional_data, dict) else {}
            )
            additional_data["stale_marked_at"] = datetime.utcnow().isoformat()
            record.additional_data = additional_data
        await db.commit()
    except Exception as exc:
        logger.warning("Failed to auto-mark stale sync jobs: %s", exc)
        await db.rollback()

    # 2. Load recent sync jobs even if stale-update logic fails.
    try:
        result = await db.execute(
            text(
                "SELECT * FROM sync_status ORDER BY COALESCE(completed_at, started_at) DESC LIMIT 50"
            )
        )
        rows = result.mappings().all()
        jobs = []
        for row in rows:
            rd = dict(row)
            for k, v in rd.items():
                if hasattr(v, "isoformat"):
                    rd[k] = v.isoformat()
            jobs.append(rd)
        status_data["sync_jobs"] = jobs
        status_data["sync_status"] = jobs
        status_data["count"] = len(jobs)
        completed_jobs = [job for job in jobs if job.get("status") == "completed"]
        last_successful_sync = completed_jobs[0].get("completed_at") if completed_jobs else None
        last_successful_dt = _normalize_datetime(last_successful_sync)
        status_data["last_successful_sync"] = (
            last_successful_dt.isoformat() if last_successful_dt else last_successful_sync
        )
        status_data["next_scheduled_sync"] = None
    except Exception as exc:
        logger.warning("Failed to load sync status rows: %s", exc)

    # 3. Calculate data freshness (matching old test expectation)
    tables_to_check = [
        ("stocks", "updated_at"),
        ("companies", "updated_at"),
        ("stock_prices", "time"),
        ("stock_indices", "time"),
        ("screener_snapshots", "fetched_at"),
        ("income_statements", "updated_at"),
        ("balance_sheets", "updated_at"),
        ("cash_flows", "updated_at"),
        ("financial_ratios", "updated_at"),
        ("dividends", "exercise_date"),
        ("company_events", "event_date"),
    ]
    for table, date_col in tables_to_check:
        try:
            if not await _table_exists(db, table):
                continue
            res = await db.execute(
                text(f"SELECT MAX({date_col}) as last_update, COUNT(*) as count FROM {table}")
            )
            row = res.mappings().first()
            last_update = row["last_update"] if row else None
            last_update_dt = _normalize_datetime(last_update)
            freshness_label, age_seconds = _classify_freshness(last_update_dt)
            status_data["data_freshness"][table] = {
                "last_update": last_update_dt.isoformat()
                if last_update_dt
                else str(last_update)
                if last_update
                else None,
                "count": row["count"] if row else 0,
                "freshness": freshness_label,
                "age_seconds": age_seconds,
            }
        except Exception:
            pass

    return status_data


@router.get("/database/stats")
async def get_db_stats(db: AsyncSession = Depends(get_db)):
    return await list_all_tables(db)


@router.get("/cache/stats")
async def get_cache_stats():
    if not settings.redis_url:
        return {
            "enabled": False,
            "message": "Redis not configured",
        }

    try:
        await redis_client.connect()
        info = await redis_client.client.info()
        keys = await redis_client.client.dbsize()
        hits = int(info.get("keyspace_hits", 0) or 0)
        misses = int(info.get("keyspace_misses", 0) or 0)
        total = hits + misses
        hit_rate = round((hits / total) * 100, 2) if total else None
        return {
            "enabled": True,
            "used_memory": info.get("used_memory_human"),
            "keys": keys,
            "hits": hits,
            "misses": misses,
            "hit_rate": hit_rate,
        }
    except Exception as e:
        return {
            "enabled": True,
            "error": str(e),
        }


@router.post("/database/seed/{seed_type}")
async def trigger_seed(seed_type: str, background_tasks: BackgroundTasks):
    from vnibb.services.data_pipeline import data_pipeline

    if seed_type == "full":
        background_tasks.add_task(data_pipeline.run_full_seeding)
    elif seed_type == "stocks":
        background_tasks.add_task(data_pipeline.sync_stock_list)
    elif seed_type == "screener":
        background_tasks.add_task(data_pipeline.sync_screener_data)
    else:
        raise HTTPException(status_code=400, detail="Invalid seed type")

    return {
        "status": "started",
        "seed_type": seed_type,
        "message": "Seeding task started in background",
    }
