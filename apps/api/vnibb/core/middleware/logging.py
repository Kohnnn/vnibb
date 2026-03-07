"""
Request/Response Logging Middleware.

Provides:
- Structured request/response logging
- Performance timing
- Request ID tracking
- Automatic health check filtering
"""

import logging
import re
import time
import traceback
import uuid
from collections import deque
from datetime import datetime
from typing import Any, Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger(__name__)


RECENT_ERROR_EVENTS: deque[dict[str, Any]] = deque(maxlen=200)


def get_recent_error_events(limit: int = 50) -> list[dict[str, Any]]:
    """Return latest middleware-captured server errors (newest first)."""
    safe_limit = max(1, min(int(limit), 200))
    return list(reversed(list(RECENT_ERROR_EVENTS)[-safe_limit:]))


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware for structured request/response logging.

    Features:
    - Request timing (duration_ms)
    - Request ID generation for tracing
    - Structured JSON logging
    - Skip health check noise
    - No sensitive data logging
    """

    SKIP_PATHS = {
        "/health",
        "/live",
        "/ready",
        "/metrics",
    }

    def __init__(self, app):
        super().__init__(app)

    def _should_skip_logging(self, path: str) -> bool:
        """Check if path should skip logging."""
        return any(path.startswith(skip_path) for skip_path in self.SKIP_PATHS)

    def _get_client_info(self, request: Request) -> dict:
        """Extract client information from request."""
        # Get client IP
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()
        elif request.client:
            client_ip = request.client.host
        else:
            client_ip = "unknown"

        return {
            "ip": client_ip,
            "user_agent": request.headers.get("User-Agent", "unknown"),
        }

    def _sanitize_path(self, path: str) -> str:
        """Remove potentially sensitive data from path."""
        # Replace UUID patterns with placeholder
        path = re.sub(
            r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            "/:id",
            path,
            flags=re.IGNORECASE,
        )
        return path

    def _extract_symbol(self, path: str) -> str | None:
        """Best-effort symbol extraction for equity/quant routes."""
        patterns = [
            r"/equity/([A-Za-z0-9_.-]+)/",
            r"/quant/([A-Za-z0-9_.-]+)/",
            r"/insider/([A-Za-z0-9_.-]+)/",
            r"/technical/([A-Za-z0-9_.-]+)/",
        ]
        for pattern in patterns:
            match = re.search(pattern, path)
            if match:
                return match.group(1).upper()
        return None

    def _record_recent_error(
        self,
        *,
        request_id: str,
        method: str,
        path: str,
        request_url: str,
        duration_ms: float,
        symbol: str | None,
        status_code: int | None,
        error_type: str,
        error: str,
        stack_trace: str | None = None,
    ) -> None:
        RECENT_ERROR_EVENTS.append(
            {
                "timestamp": datetime.utcnow().isoformat(),
                "request_id": request_id,
                "method": method,
                "path": path,
                "request_url": request_url,
                "duration_ms": round(duration_ms, 2),
                "symbol": symbol,
                "status_code": status_code,
                "error_type": error_type,
                "error": error,
                "stack_trace": stack_trace,
            }
        )

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request with logging."""
        path = request.url.path
        sanitized_path = self._sanitize_path(path)
        symbol = self._extract_symbol(path)

        # Skip health checks
        if self._should_skip_logging(path):
            return await call_next(request)

        # Generate request ID
        request_id = str(uuid.uuid4())

        # Store request ID in request state for use in other parts of app
        request.state.request_id = request_id

        # Get client info
        client = self._get_client_info(request)

        # Start timing
        start_time = time.time()

        # Process request
        try:
            response = await call_next(request)
        except Exception as exc:
            # Log error
            duration_ms = (time.time() - start_time) * 1000
            now_iso = datetime.utcnow().isoformat()
            stack_trace = traceback.format_exc(limit=12)
            logger.error(
                "[%s] %s: %s: %s\nRequest: %s\nAt: %s\n%s",
                symbol or "UNKNOWN",
                sanitized_path,
                type(exc).__name__,
                str(exc),
                str(request.url),
                now_iso,
                stack_trace,
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": sanitized_path,
                    "symbol": symbol,
                    "request_url": str(request.url),
                    "timestamp": now_iso,
                    "client_ip": client["ip"],
                    "duration_ms": round(duration_ms, 2),
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                    "stack_trace": stack_trace[:2000],
                },
            )
            self._record_recent_error(
                request_id=request_id,
                method=request.method,
                path=sanitized_path,
                request_url=str(request.url),
                duration_ms=duration_ms,
                symbol=symbol,
                status_code=500,
                error_type=type(exc).__name__,
                error=str(exc),
                stack_trace=stack_trace[:4000],
            )
            raise

        # Calculate duration
        duration_ms = (time.time() - start_time) * 1000

        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id

        # Log request/response
        log_data = {
            "request_id": request_id,
            "method": request.method,
            "path": sanitized_path,
            "symbol": symbol,
            "status_code": response.status_code,
            "duration_ms": round(duration_ms, 2),
            "client_ip": client["ip"],
        }

        # Log at appropriate level based on status code and duration
        if response.status_code >= 500:
            logger.error("Request completed with server error", extra=log_data)
            self._record_recent_error(
                request_id=request_id,
                method=request.method,
                path=sanitized_path,
                request_url=str(request.url),
                duration_ms=duration_ms,
                symbol=symbol,
                status_code=response.status_code,
                error_type="HTTPServerError",
                error=f"HTTP {response.status_code}",
            )
        elif response.status_code >= 400:
            logger.warning("Request completed with client error", extra=log_data)
        elif duration_ms > 1000:  # Over 1 second
            logger.warning("Slow request completed", extra=log_data)
        elif duration_ms > 500:  # Over 500ms
            logger.info("Request completed (slow)", extra=log_data)
        else:
            logger.debug("Request completed", extra=log_data)

        return response
