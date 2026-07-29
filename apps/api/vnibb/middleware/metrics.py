import logging
import threading
import time
from collections import defaultdict
from math import inf

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from vnibb.core.cache_constants import REDIS_CACHE_TTLS

logger = logging.getLogger(__name__)


class ProcessMetrics:
    DURATION_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, inf)
    METHODS = {"DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"}
    CACHE_OUTCOMES = {"hit", "miss", "waiter", "store_error", "bypass"}
    CACHE_PREFIXES = frozenset(REDIS_CACHE_TTLS)
    MAX_ROUTES = 512

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active_requests = 0
        self._routes: set[str] = set()
        self._request_counts: defaultdict[tuple[str, str, str], int] = defaultdict(int)
        self._duration_counts: defaultdict[tuple[str, str], list[int]] = defaultdict(
            lambda: [0] * len(self.DURATION_BUCKETS)
        )
        self._duration_sums: defaultdict[tuple[str, str], float] = defaultdict(float)
        self._cache_outcomes: defaultdict[tuple[str, str], int] = defaultdict(int)

    def cache_outcome(self, key_prefix: str, outcome: str) -> None:
        if outcome not in self.CACHE_OUTCOMES:
            return
        normalized_prefix = key_prefix if key_prefix in self.CACHE_PREFIXES else "__unknown__"
        with self._lock:
            self._cache_outcomes[(normalized_prefix, outcome)] += 1

    def request_started(self) -> None:
        with self._lock:
            self._active_requests += 1

    def request_finished(
        self,
        method: str,
        route: str,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        normalized_method = method if method in self.METHODS else "OTHER"
        with self._lock:
            self._active_requests = max(0, self._active_requests - 1)
            normalized_route = self._bounded_route(route)
            self._request_counts[(normalized_method, normalized_route, str(status_code))] += 1
            duration_key = (normalized_method, normalized_route)
            for index, boundary in enumerate(self.DURATION_BUCKETS):
                if duration_seconds <= boundary:
                    self._duration_counts[duration_key][index] += 1
            self._duration_sums[duration_key] += duration_seconds

    def _bounded_route(self, route: str) -> str:
        if route in self._routes:
            return route
        if len(self._routes) >= self.MAX_ROUTES:
            return "__overflow__"
        self._routes.add(route)
        return route

    @staticmethod
    def _escape_label(value: str) -> str:
        return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')

    def render(self) -> str:
        with self._lock:
            active_requests = self._active_requests
            request_counts = dict(self._request_counts)
            duration_counts = {key: list(counts) for key, counts in self._duration_counts.items()}
            duration_sums = dict(self._duration_sums)
            cache_outcomes = dict(self._cache_outcomes)

        lines = [
            "# HELP vnibb_http_active_requests Current HTTP requests handled by this process.",
            "# TYPE vnibb_http_active_requests gauge",
            f"vnibb_http_active_requests {active_requests}",
            "# HELP vnibb_http_requests_total HTTP responses handled by this process.",
            "# TYPE vnibb_http_requests_total counter",
        ]
        for (method, route, status), count in sorted(request_counts.items()):
            labels = (
                f'method="{self._escape_label(method)}",'
                f'route="{self._escape_label(route)}",'
                f'status="{self._escape_label(status)}"'
            )
            lines.append(f"vnibb_http_requests_total{{{labels}}} {count}")

        lines.extend(
            [
                "# HELP vnibb_http_request_duration_seconds HTTP request duration by route.",
                "# TYPE vnibb_http_request_duration_seconds histogram",
            ]
        )
        for (method, route), counts in sorted(duration_counts.items()):
            labels = f'method="{self._escape_label(method)}",route="{self._escape_label(route)}"'
            for boundary, count in zip(self.DURATION_BUCKETS, counts, strict=True):
                upper_bound = "+Inf" if boundary == inf else f"{boundary:g}"
                lines.append(
                    f'vnibb_http_request_duration_seconds_bucket{{{labels},le="{upper_bound}"}} '
                    f"{count}"
                )
            count = counts[-1]
            lines.append(
                f"vnibb_http_request_duration_seconds_sum{{{labels}}} "
                f"{duration_sums[(method, route)]:.6f}"
            )
            lines.append(f"vnibb_http_request_duration_seconds_count{{{labels}}} {count}")

        lines.extend(
            [
                "# HELP vnibb_cache_outcomes_total Cache outcomes handled by this process.",
                "# TYPE vnibb_cache_outcomes_total counter",
            ]
        )
        for (key_prefix, outcome), count in sorted(cache_outcomes.items()):
            labels = (
                f'key_prefix="{self._escape_label(key_prefix)}",'
                f'outcome="{self._escape_label(outcome)}"'
            )
            lines.append(f"vnibb_cache_outcomes_total{{{labels}}} {count}")
        return "\n".join(lines) + "\n"


metrics_registry = ProcessMetrics()


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

    @staticmethod
    def _route_template(request: Request) -> str:
        route = request.scope.get("route")
        route_path = getattr(route, "path", None)
        return route_path if isinstance(route_path, str) else "__unmatched__"

    async def dispatch(self, request: Request, call_next):
        start_time = time.perf_counter()
        metrics_registry.request_started()
        try:
            response = await call_next(request)
        except BaseException:
            duration_seconds = time.perf_counter() - start_time
            metrics_registry.request_finished(
                request.method,
                self._route_template(request),
                500,
                duration_seconds,
            )
            raise

        duration_seconds = time.perf_counter() - start_time
        duration_ms = duration_seconds * 1000
        route_template = self._route_template(request)
        metrics_registry.request_finished(
            request.method,
            route_template,
            response.status_code,
            duration_seconds,
        )
        slow_threshold_ms = self._slow_threshold_ms(request.url.path)

        if duration_ms > slow_threshold_ms:
            route_key = f"{request.method}:{route_template}"
            now = time.monotonic()
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

        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"
        return response
