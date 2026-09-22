# backend/vnibb/api/v1/health.py

import asyncio
import time
from datetime import date, datetime

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.appwrite_client import check_appwrite_connectivity
from vnibb.core.cache import redis_client
from vnibb.core.config import settings
from vnibb.core.database import get_db

router = APIRouter()

_BASIC_HEALTH_CACHE: dict[str, object] = {}
_BASIC_HEALTH_TTL_SECONDS = 30


# Headers used by intermediate proxies and Next.js ISR cache. They are
# documented in DEF-06/07 so the smoke verify step doesn't need to read
# code to know the expected behavior.
HEALTH_CACHE_HEADERS = {
    "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60",
}

# Calendar days after which the newest Screener Snapshot is reported as a
# freshness breach. Three days clears a weekend plus a Vietnamese market
# holiday, so this flags a genuinely stalled feed rather than a long weekend.
_SCREENER_FRESHNESS_BREACH_DAYS = 3


def _coerce_snapshot_date(value: object) -> date | None:
    """Normalize a `MAX(snapshot_date)` result to a `date`.

    PostgreSQL hands back a `date` for a Date column; SQLite hands back the
    stored ISO text. Accepting both keeps the probe portable across the test
    and production drivers instead of raising on whichever one it did not
    anticipate.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


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
        "appwrite": "not_configured",
        "providers": {
            "data_backend_requested": settings.data_backend,
            "data_backend": settings.resolved_data_backend,
            "cache_backend": settings.resolved_cache_backend,
            "vnstock_runtime_tier": settings.vnstock_runtime_tier,
            "vnstock_source": settings.vnstock_source,
            "vietcap_primary_eod": True,
            "premium_realtime_streaming": settings.vnstock_runtime_tier == "premium",
            "premium_news_crawler": settings.vnstock_runtime_tier == "premium",
            "appwrite_write_enabled": settings.appwrite_write_enabled,
            "appwrite_writes_active": settings.appwrite_writes_active,
            "appwrite_configured": settings.is_appwrite_configured,
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

    # Appwrite check (optional and bounded)
    try:
        appwrite_health = await asyncio.wait_for(
            check_appwrite_connectivity(timeout_seconds=1.5),
            timeout=2.0,
        )
        health["appwrite"] = appwrite_health.get("status", "error")
    except Exception:
        health["appwrite"] = "error"

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

        # Get counts, and the age of the newest snapshot. A row count alone
        # cannot distinguish a healthy corpus from one that is being
        # faithfully rewritten every day with the same stale provider
        # response, so the trade date has to travel with the count. The
        # scheduled data-quality job already detects this and records a
        # `freshness_breach`, but that verdict lived only in
        # `data_quality_runs`, where no operator watching `/health` would
        # ever see it. Report the breach here so a degraded feed is visible
        # from the endpoint operators actually poll.
        db_rows = await db.execute(text("SELECT COUNT(*) FROM stocks"))
        screener_rows = await db.execute(text("SELECT COUNT(*) FROM screener_snapshots"))
        # `MAX()` over a Date column is driver-dependent: PostgreSQL returns a
        # `date`, SQLite returns the stored text. Coerce through `fromisoformat`
        # so the probe cannot fail on the backend it happens to run against --
        # a health check that throws is worse than one that omits a field.
        raw_snapshot_date = (
            await db.execute(text("SELECT MAX(snapshot_date) FROM screener_snapshots"))
        ).scalar()
        raw_trade_date = (
            await db.execute(text("SELECT MAX(trade_date) FROM screener_snapshots"))
        ).scalar()
        snapshot_date = _coerce_snapshot_date(raw_snapshot_date)
        trade_date = _coerce_snapshot_date(raw_trade_date)
        freshness_date = trade_date or snapshot_date
        snapshot_age_days = (
            (datetime.utcnow().date() - freshness_date).days
            if freshness_date is not None
            else None
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
            "screener_freshness_basis": "trade_date" if trade_date else "snapshot_date",
        }
        if snapshot_age_days is not None and snapshot_age_days > _SCREENER_FRESHNESS_BREACH_DAYS:
            database_component["freshness_breach"] = True
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

    # Appwrite check
    appwrite_health = await check_appwrite_connectivity(timeout_seconds=2.5)
    health["components"]["appwrite"] = appwrite_health

    if settings.resolved_data_backend == "appwrite" and appwrite_health.get("status") != "connected":
        health["status"] = "degraded"

    return health
