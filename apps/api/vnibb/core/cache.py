"""In-process TTL cache used by the prediction-market estimators.

Keeps the p95 of `/estimate/*` endpoints under 200 ms by avoiding the DB /
HTTP round-trips when the result is fresh. Keys are pure string identifiers
(`predictions:estimate:cpi` etc.); values are arbitrary JSON-serialisable
dicts. The cache is intentionally process-local; coordinated invalidation
across workers is out of scope for v1.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass(slots=True)
class CacheEntry:
    value: Any
    expires_at: float


class TtlCache:
    def __init__(self, default_ttl: float = 600.0) -> None:
        self._default_ttl = default_ttl
        self._store: dict[str, CacheEntry] = {}
        self._lock = asyncio.Lock()

    async def get_or_set(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        ttl: float | None = None,
    ) -> Any:
        now = time.monotonic()
        existing = self._store.get(key)
        if existing is not None and existing.expires_at > now:
            return existing.value
        async with self._lock:
            existing = self._store.get(key)
            if existing is not None and existing.expires_at > time.monotonic():
                return existing.value
            value = await loader()
            self._store[key] = CacheEntry(
                value=value,
                expires_at=time.monotonic() + (ttl or self._default_ttl),
            )
            return value

    def invalidate(self, key: str) -> None:
        self._store.pop(key, None)


estimation_cache = TtlCache(default_ttl=600.0)
