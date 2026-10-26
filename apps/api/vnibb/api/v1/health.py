# backend/vnibb/api/v1/health.py

import asyncio
import math
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.cache import redis_client
from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.core.market_calendar import market_calendar_metadata
from vnibb.core.price_units import screener_price_record
from vnibb.services.cache_manager import CacheManager
from vnibb.services.market_session import expected_market_session

router = APIRouter()

_BASIC_HEALTH_CACHE: dict[str, object] = {}
_BASIC_HEALTH_TTL_SECONDS = 30


# Headers used by intermediate proxies and Next.js ISR cache. They are
# documented in DEF-06/07 so the smoke verify step doesn't need to read
# code to know the expected behavior.
HEALTH_CACHE_HEADERS = {
    "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
}

# Retained calendar-age breach threshold; session coverage is reported separately.
_SCREENER_FRESHNESS_BREACH_DAYS = 3




@router.get("/", response_class=Response)
@router.get("", response_class=Response)
async def basic_health():
    """Basic health check reporting DB status."""
    from vnibb.core.database import check_database_connection

    now = time.time()
    cached_data = _BASIC_HEALTH_CACHE.get("data")
    cached_at = _BASIC_HEALTH_CACHE.get("timestamp", 0)
    if cached_data and now - cached_at < _BASIC_HEALTH_TTL_SECONDS:
        return _serialised_json(cached_data, HEALTH_CACHE_HEADERS)

    health = {
        "status": "ok",
        "db": "connected",
        "cache": "unavailable",
        "providers": {
            "data_backend_requested": settings.data_backend,
            "data_backend": settings.resolved_data_backend,
            "cache_backend": settings.resolved_cache_backend,
            "vnstock_runtime_tier": settings.vnstock_runtime_tier,
            "vnstock_source": settings.vnstock_source,
            "vietcap_primary_eod": True,
            "premium_realtime_streaming": settings.vnstock_runtime_tier == "premium",
            "premium_news_crawler": settings.vnstock_runtime_tier == "premium",
            "allow_anonymous_dashboard_writes": settings.allow_anonymous_dashboard_writes,
            "scheduler_role": settings.scheduler_role,
            "scheduler_lock_enabled": settings.scheduler_lock_enabled,
            "scheduler_lock_mode": settings.scheduler_lock_mode,
        },
        "version": getattr(settings, "app_version", "0.1.0"),
        "revision": settings.release_revision,
        "timestamp": datetime.utcnow().isoformat(),
    }

    # Database check (bounded by timeout to avoid gateway timeouts)
    try:
        db_ok = await asyncio.wait_for(check_database_connection(max_retries=1), timeout=2.0)
        if not db_ok:
            health["db"] = "disconnected"
    except Exception:
        health["db"] = "disconnected"

    # Redis check (optional and bounded)
    try:
        if settings.redis_url:
            await asyncio.wait_for(redis_client.connect(), timeout=1.0)
            if redis_client.client:
                await asyncio.wait_for(redis_client.client.ping(), timeout=1.0)
                health["cache"] = "connected"
            else:
                health["cache"] = "unavailable"
        else:
            health["cache"] = "not_configured"
    except Exception:
        health["cache"] = "unavailable"

    _BASIC_HEALTH_CACHE["data"] = health
    _BASIC_HEALTH_CACHE["timestamp"] = now
    return _serialised_json(health, HEALTH_CACHE_HEADERS)


@router.get("/live")
async def liveness():
    """Liveness probe: returns 200 as long as the Python process is alive.

    Deliberately cheap. Used by orchestrators (k8s, ECS) to decide whether
    the process should be restarted; do NOT add DB or remote calls here.
    """
    return Response(
        content='{"status":"alive"}',
        media_type="application/json",
        headers=HEALTH_CACHE_HEADERS,
    )


@router.get("/ready")
async def readiness(db: AsyncSession = Depends(get_db)):
    """Readiness probe: 200 once the DB connection succeeds, 503 otherwise.

    Reports liveness/readiness to the orchestrator and to the VniAgent
    preflight. Caches for 5 seconds to keep the cost negligible.
    """
    try:
        await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=2.0)
    except Exception as exc:  # pragma: no cover - orchestrator path
        return Response(
            content=f'{{"status":"not_ready","reason":"{exc.__class__.__name__}"}}',
            media_type="application/json",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            headers=HEALTH_CACHE_HEADERS,
        )
    return Response(
        content='{"status":"ready"}',
        media_type="application/json",
        headers=HEALTH_CACHE_HEADERS,
    )


def _serialised_json(payload: object, headers: dict[str, str]) -> Response:
    """Serialize a Python dict into a Response with explicit headers."""
    import json

    return Response(
        content=json.dumps(payload, default=str),
        media_type="application/json",
        headers=headers,
    )


@router.get("/detailed")
async def detailed_health(db: AsyncSession = Depends(get_db)):
    """Detailed health check with component status."""

    health = {
        "status": "healthy",
        "version": getattr(settings, "app_version", "1.0.0"),
        "revision": settings.release_revision,
        "environment": settings.environment,
        "timestamp": datetime.utcnow().isoformat(),
        "components": {},
    }

    # Database check
    try:
        # Check basic connectivity
        await db.execute(text("SELECT 1"))

        # Freshness follows the same certified partition served to consumers.
        # Global maxima can mix unrelated partial partitions and hide stale rows.
        db_rows = await db.execute(text("SELECT COUNT(*) FROM stocks"))
        screener_rows = await db.execute(text("SELECT COUNT(*) FROM screener_snapshots"))
        verified = await CacheManager(db=db).get_screener_data(source=None)
        snapshots = verified.data if verified.hit else []
        snapshot_date = snapshots[0].snapshot_date if snapshots else None
        actual_dates = [row.trade_date for row in snapshots if row.trade_date is not None]
        trade_date = min(actual_dates) if actual_dates else None
        missing_trade_dates = len(snapshots) - len(actual_dates)
        now_ict = datetime.now(ZoneInfo(settings.vn_timezone))
        expected_session = expected_market_session(now=now_ict)
        calendar = market_calendar_metadata(expected_session)
        session_counts = verified.market_session_counts
        typed_session = session_counts is not None
        missing_prices = sum(
            row.price is None or not math.isfinite(row.price) or row.price <= 0
            for row in snapshots
        )
        unknown_price_units = sum(
            row.price is not None and screener_price_record(row)["price_unit"] != "VND"
            for row in snapshots
        )
        snapshot_age_days = (
            (now_ict.date() - trade_date).days if trade_date is not None else None
        )

        database_component = {
            "status": "healthy",
            "stocks_count": db_rows.scalar(),
            "screener_count": screener_rows.scalar(),
            "screener_snapshot_date": (
                snapshot_date.isoformat() if snapshot_date is not None else None
            ),
            "screener_trade_date": (
                trade_date.isoformat() if trade_date is not None else None
            ),
            "screener_snapshot_age_days": snapshot_age_days,
            "screener_freshness_basis": (
                verified.freshness_basis or "verified_universe_oldest_trade_date"
            ),
            "screener_verified_universe": bool(snapshots),
            "screener_verified_count": len(snapshots),
            "screener_missing_trade_dates": missing_trade_dates,
            "screener_missing_actual_prices": missing_prices,
            "screener_stale_actual_trade_dates": sum(
                actual_date < expected_session for actual_date in actual_dates
            ),
            "screener_future_trade_dates": sum(
                actual_date > expected_session for actual_date in actual_dates
            ),
            "screener_unknown_price_units": unknown_price_units,
            "screener_qualified_session_count": (session_counts or {}).get("qualified", 0),
            "screener_session_counts": {
                state: (session_counts or {}).get(state, 0)
                for state in ("traded", "no_trade", "suspended")
            },
            "screener_missing_session_coverage": (
                len(snapshots) - session_counts["qualified"] if typed_session else None
            ),
            "provider_session_coverage": ({
                "source": "vietcap", "scope": "vietcap_board",
                "session_date": expected_session.isoformat(),
                "verified": bool(snapshots) and not verified.is_stale,
                "qualified_count": session_counts["qualified"],
                "expected_count": len(snapshots),
            } if typed_session else None),
            "market_data_coverage_verified": False,
            "market_data_coverage_limitation": (
                "Vietcap board sessions do not certify whole-market coverage, including "
                "odd-lot and put-through trades; no_trade means no matched volume on this provider board."
                if typed_session else
                "Legacy quote dates do not certify whole-market session coverage."
            ),
            "screener_expected_session": expected_session.isoformat(),
            "screener_calendar": {
                **calendar,
                "exchange_calendar_verified": calendar["verified"],
            },
        }
        if not snapshots:
            database_component["screener_freshness_reason"] = "verified_universe_unavailable"
        elif typed_session:
            if verified.is_stale:
                database_component["screener_freshness_reason"] = "completed_session_not_covered"
        elif missing_trade_dates:
            database_component["screener_freshness_reason"] = "missing_constituent_trade_dates"
        elif trade_date != expected_session:
            database_component["screener_freshness_reason"] = "completed_session_not_covered"
        if (
            "screener_freshness_reason" in database_component
            or (
                not typed_session and snapshot_age_days is not None
                and snapshot_age_days > _SCREENER_FRESHNESS_BREACH_DAYS
            )
        ):
            database_component["freshness_breach"] = True
            health["status"] = "degraded"
        if typed_session:
            database_component["market_data_coverage_reason"] = "provider_scope_only"
            health["status"] = "degraded"
        health["components"]["database"] = database_component
    except Exception as e:
        health["components"]["database"] = {"status": "unhealthy", "error": str(e)}
        health["status"] = "degraded"

    # Redis check (if configured) — reuse the shared client to avoid per-request
    # connection churn and ensure async lifecycle is consistent with the rest
    # of the application.
    if settings.redis_url:
        try:
            await asyncio.wait_for(redis_client.connect(), timeout=2.0)
            if redis_client._client is None:
                health["components"]["redis"] = {"status": "unavailable"}
            else:
                await asyncio.wait_for(
                    redis_client._client.ping(), timeout=2.0
                )
                info = await asyncio.wait_for(
                    redis_client._client.info("stats"), timeout=2.0
                )
                hits = info.get("keyspace_hits", 0) or 0
                misses = info.get("keyspace_misses", 0) or 0
                total = hits + misses
                hit_rate = hits / max(1, total)
                health["components"]["redis"] = {
                    "status": "healthy",
                    "hits": hits,
                    "misses": misses,
                    "hit_rate": f"{hit_rate:.1%}",
                }
        except Exception as e:
            health["components"]["redis"] = {"status": "unhealthy", "error": str(e)}
    else:
        health["components"]["redis"] = {"status": "not_configured"}

    return health
