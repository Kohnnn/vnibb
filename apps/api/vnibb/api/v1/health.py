# backend/vnibb/api/v1/health.py

import asyncio
import time
from datetime import datetime

import redis.asyncio as redis
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.core.appwrite_client import check_appwrite_connectivity
from vnibb.core.config import settings
from vnibb.core.database import get_db

router = APIRouter()

_BASIC_HEALTH_CACHE: dict[str, object] = {}
_BASIC_HEALTH_TTL_SECONDS = 30


@router.get("/")
@router.get("")
async def basic_health():
    """Basic health check reporting DB status."""
    from vnibb.core.cache import redis_client
    from vnibb.core.database import check_database_connection

    now = time.time()
    cached_data = _BASIC_HEALTH_CACHE.get("data")
    cached_at = _BASIC_HEALTH_CACHE.get("timestamp", 0)
    if cached_data and now - cached_at < _BASIC_HEALTH_TTL_SECONDS:
        return cached_data

    health = {
        "status": "ok",
        "db": "connected",
        "cache": "unavailable",
        "appwrite": "not_configured",
        "providers": {
            "data_backend_requested": settings.data_backend,
            "data_backend": settings.resolved_data_backend,
            "cache_backend": settings.resolved_cache_backend,
            "appwrite_write_enabled": settings.appwrite_write_enabled,
            "allow_anonymous_dashboard_writes": settings.allow_anonymous_dashboard_writes,
        },
        "version": getattr(settings, "app_version", "0.1.0"),
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
    return health


@router.get("/detailed")
async def detailed_health(db: AsyncSession = Depends(get_db)):
    """Detailed health check with component status."""

    health = {
        "status": "healthy",
        "version": getattr(settings, "app_version", "1.0.0"),
        "environment": settings.environment,
        "timestamp": datetime.utcnow().isoformat(),
        "components": {},
    }

    # Database check
    try:
        # Check basic connectivity
        await db.execute(text("SELECT 1"))

        # Get counts
        db_rows = await db.execute(text("SELECT COUNT(*) FROM stocks"))
        screener_rows = await db.execute(text("SELECT COUNT(*) FROM screener_snapshots"))

        health["components"]["database"] = {
            "status": "healthy",
            "stocks_count": db_rows.scalar(),
            "screener_count": screener_rows.scalar(),
        }
    except Exception as e:
        health["components"]["database"] = {"status": "unhealthy", "error": str(e)}
        health["status"] = "degraded"

    # Redis check (if configured)
    if settings.redis_url:
        try:
            r = redis.from_url(settings.redis_url)
            await r.ping()
            # Try to get some info
            info = await r.info("stats")
            health["components"]["redis"] = {
                "status": "healthy",
                "hits": info.get("keyspace_hits", 0),
                "misses": info.get("keyspace_misses", 0),
            }
            total = info.get("keyspace_hits", 0) + info.get("keyspace_misses", 0)
            hit_rate = info.get("keyspace_hits", 0) / max(1, total)
            health["components"]["redis"]["hit_rate"] = f"{hit_rate:.1%}"
            await r.close()
        except Exception as e:
            health["components"]["redis"] = {"status": "unhealthy", "error": str(e)}
    else:
        health["components"]["redis"] = {"status": "not_configured"}

    # Appwrite check
    appwrite_health = await check_appwrite_connectivity(timeout_seconds=2.5)
    health["components"]["appwrite"] = appwrite_health

    if settings.data_backend == "appwrite" and appwrite_health.get("status") != "connected":
        health["status"] = "degraded"

    return health
