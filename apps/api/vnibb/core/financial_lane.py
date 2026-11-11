"""Bounded single-flight lane for financial acquisition calls.

One financial call runs at a time. Identical retries share the in-flight call, a
different request fails fast instead of queueing behind it, and a caller
deadline never cancels the underlying work. ``busy`` exposes that state to
schedulers that must stop issuing new work while the lane is occupied.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="financial-provider")
_lock = Lock()
_future = None
_key: tuple | None = None


async def run_financial(operation: Callable, timeout: float, *, key: tuple | None = None):
    """Share identical work; never queue behind a still-running financial call."""
    global _future, _key
    with _lock:
        if _future is not None and not _future.done():
            if key is None or key != _key:
                raise RuntimeError("Previous financial provider call is still running")
        else:
            _future = _executor.submit(operation)
            _key = key
            _future.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
        future = _future
    wrapped = asyncio.wrap_future(future)
    wrapped.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
    return await asyncio.wait_for(asyncio.shield(wrapped), timeout=timeout)


def financial_busy() -> bool:
    with _lock:
        return _future is not None and not _future.done()
