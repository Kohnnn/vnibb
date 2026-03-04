"""Async token bucket rate limiter utilities."""

from __future__ import annotations

import asyncio
import logging
import time

from vnibb.core.config import settings

logger = logging.getLogger(__name__)


class TokenBucketRateLimiter:
    def __init__(self, rps: float, name: str = "main"):
        self.rps = max(float(rps or 0), 0.0)
        self.name = name
        self.tokens = self.rps
        self.last_refill = time.monotonic()
        self.lock = asyncio.Lock()
        self.total_requests = 0
        self.window_start = time.time()

    async def acquire(self) -> None:
        if self.rps <= 0:
            return

        async with self.lock:
            now = time.monotonic()
            elapsed = now - self.last_refill
            self.tokens = min(self.rps, self.tokens + elapsed * self.rps)
            self.last_refill = now

            if self.tokens < 1:
                await asyncio.sleep((1 - self.tokens) / self.rps)
                self.tokens = 0
            else:
                self.tokens -= 1

            self.total_requests += 1
            if time.time() - self.window_start > 60:
                logger.info("[RateLimit:%s] %d req/60s", self.name, self.total_requests)
                self.total_requests = 0
                self.window_start = time.time()

    async def wait(self) -> None:
        await self.acquire()


main_limiter = TokenBucketRateLimiter(
    rps=getattr(settings, "vnstock_rate_limit_rps", 500 / 60),
    name="main",
)
reinforce_limiter = TokenBucketRateLimiter(
    rps=getattr(settings, "vnstock_reinforcement_rps", 50 / 60),
    name="reinforce",
)
