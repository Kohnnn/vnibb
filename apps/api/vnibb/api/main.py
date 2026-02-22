"""
FastAPI Application Factory

Creates and configures the VNIBB API server with:
- CORS middleware
- Lifespan events (startup/shutdown)
- Exception handlers
- API router mounting
- Structured logging (JSON for production)
- Startup configuration validation
"""

import logging
import re
import asyncio
import sys
import io

# Ensure stdout handles emojis even on windows consoles with limited encoding
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="ignore")
    except Exception:
        pass
elif hasattr(sys.stdout, "detach"):
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="ignore")
    except Exception:
        pass

from contextlib import asynccontextmanager
from typing import AsyncGenerator
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException, RequestValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from vnibb.core.config import settings
from vnibb.core.cache import redis_client
from vnibb.core.exceptions import VniBBException
from vnibb.core.logging_config import setup_logging
from vnibb.core.monitoring import init_monitoring
from vnibb.api.v1.router import api_router
from vnibb.models.api_errors import (
    APIError,
    RateLimitError,
    ValidationErrorResponse,
    ValidationError,
)

# Configure structured logging
setup_logging()
logger = logging.getLogger(__name__)

# Initialize rate limiter (using Redis as storage backend)
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["1000/hour"],  # Default: 1000 requests per hour per IP
    storage_uri=settings.redis_url if settings.redis_url else None,
    headers_enabled=True,  # Add X-RateLimit-* headers to responses
)


def get_cors_headers(request: Request) -> dict[str, str]:
    """
    Generate CORS headers based on request origin.

    Returns appropriate headers if origin is in allowed list.
    """
    origin = request.headers.get("origin", "")

    localhost_pattern = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    vercel_preview_pattern = r"^https://[a-z0-9-]+\.vercel\.app$"
    configured_pattern = settings.cors_origin_regex
    is_localhost_origin = bool(origin and re.match(localhost_pattern, origin))
    is_vercel_preview_origin = bool(origin and re.match(vercel_preview_pattern, origin))
    is_configured_regex_origin = bool(
        origin and configured_pattern and re.match(configured_pattern, origin)
    )

    # Check if origin is allowed
    if (
        origin in settings.cors_origins
        or "*" in settings.cors_origins
        or is_localhost_origin
        or is_vercel_preview_origin
        or is_configured_regex_origin
    ):
        return {
            "Access-Control-Allow-Origin": origin or settings.cors_origins[0],
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        }

    # Default to first allowed origin if no match
    if settings.cors_origins:
        return {
            "Access-Control-Allow-Origin": settings.cors_origins[0],
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        }

    return {}


class CORSErrorMiddleware(BaseHTTPMiddleware):
    """
    Middleware to ensure CORS headers are added to error responses.

    FastAPI's CORSMiddleware may not add headers when exceptions occur
    before the response is fully processed. This middleware catches
    any unhandled exceptions and ensures CORS headers are present.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # Handle preflight OPTIONS requests
        if request.method == "OPTIONS":
            headers = get_cors_headers(request)
            return Response(status_code=200, headers=headers)

        try:
            response = await call_next(request)
            return response
        except Exception as exc:
            # Log the exception
            logger.exception(f"Unhandled exception in middleware: {exc}")

            # Return error response with CORS headers
            headers = get_cors_headers(request)
            return JSONResponse(
                status_code=500,
                content={
                    "error": True,
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected error occurred" if not settings.debug else str(exc),
                },
                headers=headers,
            )


class PerformanceLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware to log response times for all API requests.

    Helps identify slow endpoints and monitor performance improvements.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        start_time = datetime.utcnow()
        response = await call_next(request)
        process_time = (datetime.utcnow() - start_time).total_seconds()

        # Add server-timing header
        response.headers["X-Process-Time"] = f"{process_time:.4f}s"

        # Log slow requests
        if process_time > 0.5:  # Over 500ms
            logger.warning(
                f"Slow Request: {request.method} {request.url.path} "
                f"status={response.status_code} took {process_time:.4f}s"
            )
        else:
            logger.debug(
                f"Request: {request.method} {request.url.path} "
                f"status={response.status_code} took {process_time:.4f}s"
            )

        return response


class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    """Enforce a global timeout for non-health HTTP requests."""

    BYPASS_PATHS = ("/live", "/ready", "/health", "/docs", "/openapi.json", "/redoc")

    async def dispatch(self, request: Request, call_next) -> Response:
        timeout_seconds = settings.api_request_timeout_seconds
        if timeout_seconds <= 0:
            return await call_next(request)

        if request.url.path.startswith(self.BYPASS_PATHS):
            return await call_next(request)

        try:
            return await asyncio.wait_for(call_next(request), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            logger.warning(
                "Request timed out after %ss: %s %s",
                timeout_seconds,
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=504,
                content={
                    "error": True,
                    "code": "REQUEST_TIMEOUT",
                    "message": "Request timed out. Please try again.",
                },
                headers=get_cors_headers(request),
            )


class ResponseCacheControlMiddleware(BaseHTTPMiddleware):
    """
    Apply consistent cache headers by endpoint class for GET/HEAD responses.

    Classes:
    - real_time: never cached
    - near_real_time: short caching with stale-while-revalidate
    - staticish: longer caching with stale-while-revalidate
    """

    REAL_TIME_PATTERNS = (
        re.compile(r"^/health(/|$)"),
        re.compile(r"^/live/?$"),
        re.compile(r"^/ready/?$"),
        re.compile(r"^/api/v1/equity/[^/]+/quote/?$"),
        re.compile(r"^/api/v1/ws(/|$)"),
    )

    NEAR_REAL_TIME_PATTERNS = (
        re.compile(r"^/api/v1/screener(/|$)"),
        re.compile(r"^/api/v1/alerts(/|$)"),
        re.compile(r"^/api/v1/sectors(/|$)"),
        re.compile(r"^/api/v1/equity/[^/]+/(historical|intraday|metrics/history)(/|$)"),
    )

    STATICISH_PATTERNS = (
        re.compile(
            r"^/api/v1/equity/[^/]+/"
            r"(profile|ratios|income-statement|balance-sheet|cash-flow|dividends|"
            r"events|shareholders|officers|ownership|rating|news)(/|$)"
        ),
        re.compile(r"^/api/v1/listings?(/|$)"),
        re.compile(r"^/api/v1/comparison(/|$)"),
        re.compile(r"^/api/v1/compare(/|$)"),
    )

    CACHE_HEADERS = {
        "real_time": "no-store, max-age=0",
        "near_real_time": "public, max-age=30, stale-while-revalidate=90",
        "staticish": "public, max-age=300, stale-while-revalidate=1800",
    }

    @classmethod
    def _resolve_policy(cls, path: str) -> str | None:
        if any(pattern.match(path) for pattern in cls.REAL_TIME_PATTERNS):
            return "real_time"

        if any(pattern.match(path) for pattern in cls.NEAR_REAL_TIME_PATTERNS):
            return "near_real_time"

        if any(pattern.match(path) for pattern in cls.STATICISH_PATTERNS):
            return "staticish"

        return None

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        if request.method not in {"GET", "HEAD"}:
            return response

        if response.status_code < 200 or response.status_code >= 300:
            return response

        if response.headers.get("Cache-Control"):
            return response

        policy = self._resolve_policy(request.url.path)
        if policy is None:
            return response

        response.headers["Cache-Control"] = self.CACHE_HEADERS[policy]

        if policy != "real_time":
            existing_vary = response.headers.get("Vary")
            response.headers["Vary"] = (
                "Accept-Encoding" if not existing_vary else f"{existing_vary}, Accept-Encoding"
            )

        return response


async def _safe_warmup():
    """Fire-and-forget warmup with delay."""
    await asyncio.sleep(5)  # Wait for server ready
    try:
        from vnibb.services.warmup_service import warmup_cache

        await warmup_cache()
    except Exception as e:
        logger.warning(f"Background warmup failed: {e}")


def _warmup_vnstock_sync():
    """
    Synchronous warmup of vnstock to avoid module lock deadlocks.
    Imports and initializes vnstock in the main thread during startup.
    """
    try:
        from vnibb.providers.vnstock import get_vnstock

        logger.info("Pre-initializing vnstock instance...")
        # This will trigger Vnstock() initialization which is protected by our lock
        get_vnstock()

        # Pre-import key modules to avoid _ModuleLock deadlocks in threads
        from vnstock import Listing, Company, Finance

        logger.info("vnstock modules pre-loaded successfully.")
    except Exception as e:
        logger.warning(f"vnstock pre-initialization failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan handler.

    Startup: Validate config, initialize Redis, start scheduler
    Shutdown: Close Redis connection pool and scheduler
    """
    from vnibb.core.scheduler import start_scheduler, shutdown_scheduler
    from vnibb.core.database import check_database_connection

    # Pre-initialize vnstock in main thread to prevent deadlocks
    # Non-blocking with timeout for robustness
    if settings.environment != "test":
        import os
        import threading

        skip_warmup_default = "true" if settings.environment == "production" else "false"
        skip_warmup = os.getenv("SKIP_WARMUP", skip_warmup_default).lower() == "true"
        if skip_warmup:
            logger.info("Warmup skipped (SKIP_WARMUP=true)")
        else:

            def warmup_with_timeout():
                try:
                    _warmup_vnstock_sync()
                except Exception as e:
                    logger.warning(f"vnstock pre-init failed (non-fatal): {e}")

            # Run in thread with 5s timeout to avoid blocking event loop startup
            t = threading.Thread(target=warmup_with_timeout)
            t.daemon = True
            t.start()
            t.join(timeout=5.0)
            if t.is_alive():
                logger.warning("vnstock pre-init timed out (continuing anyway)")

            # Startup - schedule async warmup but don't wait
            asyncio.create_task(_safe_warmup())
            logger.info("Server ready. Warmup scheduled (5s delay).")

    # Log startup
    logger.info(
        f"Starting {settings.app_name} v{settings.app_version} (environment={settings.environment})"
    )

    # In test environment, skip heavy startup tasks
    if settings.environment == "test":
        logger.info("Test environment detected - skipping full startup sequence")
        yield
        logger.info("Test shutdown complete")
        return

    # Validate database connection
    logger.info("Checking database connection...")
    db_ok = await check_database_connection()
    if not db_ok:
        # Log critical but don't crash - allows health endpoints to work for debugging
        logger.critical("Database connection failed - running in degraded mode")
        logger.warning(
            "Some features requiring database will not work until DB connection is restored"
        )
    else:
        logger.info("Database connection verified")

    # Check database status and warn if empty
    if db_ok:
        try:
            from vnibb.services.health_service import get_health_service

            health = await get_health_service().get_database_health()

            if health["status"] == "needs_seed":
                logger.warning("=" * 60)
                logger.warning("DATABASE IS EMPTY!")
                logger.warning("Run 'python -m vnibb.cli.seed' to populate stock data")
                logger.warning("Or call POST /api/v1/data/seed/stocks")
                logger.warning("=" * 60)
            elif health["warnings"]:
                for warning in health["warnings"]:
                    logger.warning(f"Database warning: {warning}")
            else:
                logger.info(f"Database healthy: {health['database']['stock_count']} stocks")
        except Exception as e:
            logger.warning(f"Database health check failed (non-fatal): {e}")

    # Initialize Redis
    try:
        if settings.redis_url:
            await redis_client.connect()
            logger.info("Redis connected")
        else:
            logger.warning("Redis URL not configured - caching disabled")
    except Exception as e:
        if settings.is_production:
            logger.warning(f"Redis connection failed (non-fatal): {e}")
        else:
            logger.warning(f"Redis connection failed (non-fatal): {e}")

    # Register VNStock API key once per deployment
    try:
        if settings.vnstock_api_key:
            from vnibb.services.vnstock_registration import ensure_vnstock_registration

            result = await ensure_vnstock_registration()
            if result.registered:
                logger.info(
                    f"VNStock registration status: {result.reason} (source={result.source})"
                )
            elif result.reason in {"lock_busy", "no_api_key", "cached_local", "cached_persistent"}:
                logger.info(f"VNStock registration skipped: {result.reason}")
            else:
                logger.warning(f"VNStock registration skipped: {result.reason}")
    except Exception as e:
        logger.warning(f"VNStock registration failed (non-fatal): {e}")

    # Start scheduler for background data sync jobs
    try:
        start_scheduler()
        logger.info("Scheduler started with data sync jobs")
    except Exception as e:
        logger.warning(f"Scheduler start failed (non-fatal): {e}")

    # Start WebSocket price broadcaster for real-time updates

    try:
        from vnibb.api.v1.websocket import start_background_fetcher

        await start_background_fetcher()
        logger.info("WebSocket price broadcaster started")
    except Exception as e:
        logger.warning(f"WebSocket broadcaster start failed (non-fatal): {e}")

    # Log startup complete
    logger.info(
        f"{settings.app_name} started successfully - "
        f"listening on {settings.api_host}:{settings.api_port}"
    )

    yield

    # Shutdown
    logger.info("Shutting down...")

    # Stop WebSocket background task
    try:
        from vnibb.api.v1.websocket import stop_background_fetcher

        await stop_background_fetcher()
        logger.info("WebSocket broadcaster stopped")
    except Exception as e:
        logger.warning(f"WebSocket broadcaster shutdown error: {e}")

    # Stop scheduler
    try:
        shutdown_scheduler()
        logger.info("Scheduler stopped")
    except Exception as e:
        logger.warning(f"Scheduler shutdown error: {e}")

    if settings.redis_url:
        await redis_client.disconnect()

    logger.info("Shutdown complete")


from vnibb.middleware.rate_limit import RateLimitMiddleware
from vnibb.middleware.metrics import MetricsMiddleware


def create_app() -> FastAPI:
    """
    Application factory pattern.

    Creates a configured FastAPI instance with all middleware,
    exception handlers, and routers.
    """
    app = FastAPI(
        title=settings.app_name,
        description=(
            "Vietnam-First OpenBB Distribution - "
            "A headless, API-first financial analytics platform for the Vietnam Stock Market."
        ),
        version=settings.app_version,
        lifespan=lifespan,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
    )

    # Initialize monitoring (Sentry) - must be done early
    init_monitoring(app)

    # Add Performance Metrics Middleware
    app.add_middleware(MetricsMiddleware)

    # Add Rate Limiting Middleware
    app.add_middleware(RateLimitMiddleware, requests_per_minute=120)

    # CORS Middleware (must be added AFTER CORSErrorMiddleware for proper order)

    logger.info(
        "CORS configuration loaded: origins=%s regex=%s",
        settings.cors_origins,
        settings.cors_origin_regex,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Add Performance Logging Middleware
    app.add_middleware(PerformanceLoggingMiddleware)

    # Protect API workers from hanging requests
    app.add_middleware(RequestTimeoutMiddleware)

    # Add response cache policy middleware for GET/HEAD endpoints
    app.add_middleware(ResponseCacheControlMiddleware)

    # Add CORS Error Middleware to catch exceptions before CORS middleware
    # Middleware order: Request -> CORSErrorMiddleware -> CORSMiddleware -> Route
    # Response order: Route -> CORSMiddleware -> CORSErrorMiddleware -> Client
    app.add_middleware(CORSErrorMiddleware)

    # Exception Handlers with explicit CORS headers and standardized error format

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
        """Handle rate limit exceeded (429)."""
        headers = get_cors_headers(request)
        error = RateLimitError(
            message="Too many requests. Please try again later.",
            retry_after=60,  # Default retry after 60 seconds
        )
        headers["Retry-After"] = "60"
        return JSONResponse(
            status_code=429,
            content=jsonable_encoder(error.model_dump()),
            headers=headers,
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        """Handle FastAPI HTTPException with standardized format."""
        headers = get_cors_headers(request)

        # If detail is already a dict (from validators), use it
        if isinstance(exc.detail, dict):
            return JSONResponse(
                status_code=exc.status_code,
                content=exc.detail,
                headers=headers,
            )

        # Otherwise, wrap in APIError
        error = APIError(
            error="http_error", message=str(exc.detail), details={"status_code": exc.status_code}
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=jsonable_encoder(error.model_dump()),
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """Handle request validation errors (422) with standardized format."""
        headers = get_cors_headers(request)

        # Convert Pydantic validation errors to our format
        validation_errors = []
        for error in exc.errors():
            validation_errors.append(
                ValidationError(loc=error["loc"], msg=error["msg"], type=error["type"])
            )

        response = ValidationErrorResponse(
            message="Request validation failed", details=validation_errors
        )

        return JSONResponse(
            status_code=422,
            content=jsonable_encoder(response.model_dump()),
            headers=headers,
        )

    @app.exception_handler(VniBBException)
    async def vnibb_exception_handler(request: Request, exc: VniBBException):
        """Handle custom VNIBB exceptions with CORS headers."""
        headers = get_cors_headers(request)

        # Convert to APIError format
        error = APIError(error=exc.code.lower(), message=exc.message, details=exc.details)

        return JSONResponse(
            status_code=500,
            content=jsonable_encoder(error.model_dump()),
            headers=headers,
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception):
        """Handle uncaught exceptions with CORS headers."""
        logger.exception(f"Unhandled exception: {exc}")
        headers = get_cors_headers(request)

        error = APIError(
            error="internal_error",
            message="An unexpected error occurred" if not settings.debug else str(exc),
            details={"type": type(exc).__name__} if settings.debug else None,
        )

        return JSONResponse(
            status_code=500,
            content=jsonable_encoder(error.model_dump()),
            headers=headers,
        )

    # Health Check (root level)
    from vnibb.api.v1.health import router as health_router

    app.include_router(health_router, prefix="/health", tags=["Health"])

    @app.get("/debug", tags=["Debug"])
    async def debug_status():
        """Lightweight debug endpoint for sync and dependency status."""
        from vnibb.core.database import check_database_connection, async_session_maker
        from vnibb.models.sync_status import SyncStatus
        from vnibb.services.data_pipeline import (
            SYNC_PROGRESS_KEY,
            DAILY_TRADING_PROGRESS_KEY,
        )
        from sqlalchemy import select

        db_ok = await check_database_connection()
        cache_ok = False
        cache_error = None
        progress = {
            "full_seed": None,
            "daily_trading": None,
        }

        if settings.redis_url:
            try:
                await redis_client.connect()
                cache_ok = True
                progress["full_seed"] = await redis_client.get_json(SYNC_PROGRESS_KEY)
                progress["daily_trading"] = await redis_client.get_json(DAILY_TRADING_PROGRESS_KEY)
            except Exception as exc:
                cache_error = str(exc)

        history = []
        history_error = None
        try:
            async with async_session_maker() as session:
                result = await session.execute(
                    select(SyncStatus).order_by(SyncStatus.started_at.desc()).limit(5)
                )
                for row in result.scalars().all():
                    history.append(
                        {
                            "id": row.id,
                            "sync_type": row.sync_type,
                            "status": row.status,
                            "started_at": row.started_at.isoformat() if row.started_at else None,
                            "completed_at": row.completed_at.isoformat()
                            if row.completed_at
                            else None,
                            "success_count": row.success_count,
                            "error_count": row.error_count,
                        }
                    )
        except Exception as exc:
            history_error = str(exc)

        return {
            "status": "ok",
            "db": "connected" if db_ok else "disconnected",
            "cache": "connected" if cache_ok else "disconnected",
            "cache_error": cache_error,
            "sync_history": history,
            "sync_history_error": history_error,
            "sync_progress": progress,
            "timestamp": datetime.utcnow().isoformat(),
        }

    # Readiness probe (for Kubernetes)

    @app.get("/ready", tags=["Health"])
    async def readiness_check():
        """
        Readiness probe for Kubernetes/container orchestration.

        Returns 200 if the service is ready to accept traffic.
        Returns 503 if critical dependencies are unavailable.
        """
        from vnibb.core.database import check_database_connection

        try:
            db_ok = await asyncio.wait_for(check_database_connection(max_retries=1), timeout=5.0)
        except asyncio.TimeoutError:
            return JSONResponse(
                status_code=503,
                content={"ready": False, "reason": "Database readiness check timed out"},
            )
        except Exception as e:
            logger.warning(f"Readiness check failed: {e}")
            return JSONResponse(
                status_code=503,
                content={"ready": False, "reason": f"Health check error: {type(e).__name__}"},
            )

        if not db_ok:
            return JSONResponse(
                status_code=503, content={"ready": False, "reason": "Database unavailable"}
            )

        return {"ready": True}

    # Liveness probe (for Kubernetes)
    @app.get("/live", tags=["Health"])
    async def liveness_check():
        """
        Liveness probe for Kubernetes/container orchestration.

        Returns 200 if the service is alive.
        This should be a lightweight check.
        """
        return {"alive": True}

    # Attach rate limiter to app state
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Mount API Router
    app.include_router(api_router, prefix=settings.api_prefix)

    return app


# Default app instance
app = create_app()
