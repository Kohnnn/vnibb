import time
import logging
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class MetricsMiddleware(BaseHTTPMiddleware):
    SLOW_MS_DEFAULT = 1500.0
    SLOW_LOG_COOLDOWN_SECONDS = 30.0

    def __init__(self, app):
        super().__init__(app)
        self._last_slow_log: dict[str, float] = {}

    @staticmethod
    def _slow_threshold_ms(path: str) -> float:
        if path.startswith("/api/v1/screener"):
            return 2500.0
        if path.startswith("/api/v1/market/top-movers"):
            return 2200.0
        return MetricsMiddleware.SLOW_MS_DEFAULT

    async def dispatch(self, request: Request, call_next):
        start_time = time.time()

        response = await call_next(request)

        duration_ms = (time.time() - start_time) * 1000

        slow_threshold_ms = self._slow_threshold_ms(request.url.path)

        # Log slow requests with lightweight per-route cooldown to reduce noise.
        if duration_ms > slow_threshold_ms:
            route_key = f"{request.method}:{request.url.path}"
            now = time.time()
            last_logged = self._last_slow_log.get(route_key, 0.0)
            should_log = (now - last_logged) >= self.SLOW_LOG_COOLDOWN_SECONDS

            if should_log:
                self._last_slow_log[route_key] = now
                logger.warning(
                    "SLOW REQUEST: %s %s status=%s took %.2fms (threshold=%.0fms)",
                    request.method,
                    request.url.path,
                    response.status_code,
                    duration_ms,
                    slow_threshold_ms,
                )
        else:
            logger.debug(
                "REQUEST: %s %s status=%s took %.2fms",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )

        # Add timing header to response
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"

        return response
