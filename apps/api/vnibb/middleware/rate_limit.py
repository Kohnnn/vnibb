import logging
import re
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from vnibb.core.cache import redis_client
from vnibb.core.config import settings

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    _SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    ttl = ARGV[1]
end
return {count, ttl}
"""

    def __init__(self, app, redis: Any | None = None, requests_per_minute: int = 120):
        super().__init__(app)
        self.default_requests_per_minute = requests_per_minute
        self.redis = redis

    def _is_exempt_path(self, path: str) -> bool:
        return path.startswith(("/health", "/live", "/ready", "/docs", "/redoc", "/openapi.json", "/static"))

    def _get_client_ip(self, request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def _resolve_bucket(self, path: str) -> tuple[str, int]:
        if re.match(r"^/api/v1/equity/[^/]+/quote/?$", path):
            return "equity_quote", 60
        if path.startswith("/api/v1/quant/"):
            return "quant", 30
        if path.startswith("/api/v1/screener"):
            return "screener", 20
        if path.startswith("/api/v1/admin/"):
            return "admin", 60
        return "default", self.default_requests_per_minute

    def _key(self, client_ip: str, bucket: str) -> str:
        return f"{settings.rate_limit_key_prefix}:{settings.rate_limit_key_version}:{bucket}:{client_ip}"

    async def _consume(self, key: str) -> tuple[int, int]:
        client = self.redis or redis_client.client
        result = await client.eval(self._SCRIPT, 1, key, settings.rate_limit_window_seconds)
        return int(result[0]), max(1, int(result[1]))

    async def dispatch(self, request: Request, call_next):
        if settings.rate_limit_mode == "off" or request.method == "OPTIONS" or self._is_exempt_path(request.url.path):
            return await call_next(request)

        bucket, limit = self._resolve_bucket(request.url.path)
        headers = {
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Policy": bucket,
            "X-RateLimit-Window": str(settings.rate_limit_window_seconds),
        }
        try:
            count, retry_after = await self._consume(self._key(self._get_client_ip(request), bucket))
        except Exception:
            logger.exception("Redis rate limit check failed; allowing request")
            response = await call_next(request)
            response.headers.update(headers)
            response.headers["X-RateLimit-Status"] = "unavailable"
            return response

        exceeded = count > limit
        if settings.rate_limit_mode == "shadow":
            response = await call_next(request)
            response.headers.update(headers)
            response.headers["X-RateLimit-Status"] = "shadow-exceeded" if exceeded else "shadow"
            if exceeded:
                logger.warning("Rate limit shadow threshold exceeded: bucket=%s limit=%s", bucket, limit)
            return response

        if exceeded:
            logger.warning("Rate limit exceeded: bucket=%s limit=%s", bucket, limit)
            headers["Retry-After"] = str(retry_after)
            return JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limited",
                    "message": "Rate limit exceeded. Please slow down.",
                    "bucket": bucket,
                    "limit": limit,
                    "window_seconds": settings.rate_limit_window_seconds,
                },
                headers=headers,
            )

        response = await call_next(request)
        response.headers.update(headers)
        response.headers["X-RateLimit-Status"] = "enforced"
        return response
