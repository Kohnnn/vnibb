# backend/vnibb/api/v1/health.py

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from vnibb.core.database import get_db
from vnibb.core.config import settings
import redis.asyncio as redis
from datetime import datetime
import time

router = APIRouter()

_BASIC_HEALTH_CACHE: dict[str, object] = {}
_BASIC_HEALTH_TTL_SECONDS = 30


@router.get("/")
async def basic_health(db: AsyncSession = Depends(get_db)):
    """Basic health check reporting DB status."""
    from vnibb.core.cache import redis_client

    now = time.time()
    cached_data = _BASIC_HEALTH_CACHE.get("data")
    cached_at = _BASIC_HEALTH_CACHE.get("timestamp", 0)
    if cached_data and now - cached_at < _BASIC_HEALTH_TTL_SECONDS:
        return cached_data

    health = {
        "status": "ok",
        "db": "connected",
        "cache": "unavailable",
        "version": getattr(settings, 'app_version', '0.1.0'),
        "timestamp": datetime.utcnow().isoformat()
    }
    
    # Database check
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        health["db"] = "disconnected"
        # We keep status "ok" if the app is still running, 
        # but the specific component status is updated.
        # Alternatively, set status to "degraded"
        # health["status"] = "degraded"
        
    # Redis check
    try:
        if settings.redis_url:
            await redis_client.client.ping()
            health["cache"] = "connected"
        else:
            health["cache"] = "not_configured"
    except Exception:
        health["cache"] = "unavailable"
        
    _BASIC_HEALTH_CACHE["data"] = health
    _BASIC_HEALTH_CACHE["timestamp"] = now
    return health


@router.get("/detailed")
async def detailed_health(db: AsyncSession = Depends(get_db)):
    """Detailed health check with component status."""
    
    health = {
        "status": "healthy",
        "version": getattr(settings, 'app_version', '1.0.0'),
        "environment": settings.environment,
        "timestamp": datetime.utcnow().isoformat(),
        "components": {}
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
            "screener_count": screener_rows.scalar()
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
    
    return health
