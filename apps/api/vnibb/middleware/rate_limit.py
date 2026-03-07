from collections import defaultdict
from datetime import datetime, timedelta
import logging
import re

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, requests_per_minute: int = 120):
        super().__init__(app)
        self.default_requests_per_minute = requests_per_minute
        self.clients: dict[str, list[datetime]] = defaultdict(list)

    def _is_exempt_path(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in ["/health", "/live", "/ready", "/docs", "/redoc", "/openapi.json", "/static"])

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
        return request.client.host if request.client else "unknown"

    def _resolve_bucket(self, path: str) -> tuple[str, int]:
        if re.match(r"^/api/v1/equity/[^/]+/quote/?$", path):
            return "equity_quote", 60
        if path.startswith("/api/v1/quant/"):
            return "quant", 30
        if path.startswith("/api/v1/screener"):
            return "screener", 20
        if path.startswith("/api/v1/admin/"):
            return "admin", 10
        return "default", self.default_requests_per_minute

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if self._is_exempt_path(path):
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        bucket, requests_per_minute = self._resolve_bucket(path)
        rate_key = f"{client_ip}:{bucket}"
        now = datetime.now()

        # Clean old requests (older than 1 minute)
        cutoff = now - timedelta(minutes=1)
        self.clients[rate_key] = [
            t for t in self.clients[rate_key] if t > cutoff
        ]

        # Check rate limit
        if len(self.clients[rate_key]) >= requests_per_minute:
            logger.warning(
                "Rate limit exceeded for IP %s on bucket %s (%s/min)",
                client_ip,
                bucket,
                requests_per_minute,
            )
            raise HTTPException(
                status_code=429,
                detail={
                    "message": "Rate limit exceeded. Please slow down.",
                    "bucket": bucket,
                    "limit": requests_per_minute,
                    "window_seconds": 60,
                },
                headers={
                    "Retry-After": "60",
                    "X-RateLimit-Limit": str(requests_per_minute),
                    "X-RateLimit-Policy": bucket,
                },
            )

        # Record request
        self.clients[rate_key].append(now)

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(requests_per_minute)
        response.headers["X-RateLimit-Policy"] = bucket
        return response
