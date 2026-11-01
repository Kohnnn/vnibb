"""Runtime helpers for the VNStock VCI provider."""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from importlib.util import find_spec
from threading import Lock
from typing import Any

from vnibb.core.config import settings


def validate_free_runtime() -> None:
    """Fail before VNAI can authenticate a discovered paid runtime package."""
    paid_modules = ("vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii")
    present = [name for name in paid_modules if name in sys.modules or find_spec(name) is not None]
    if present:
        raise RuntimeError(
            f"Free runtime contains forbidden paid modules: {','.join(present)}. "
            "Use a clean community environment or rebuild the credential-free image "
            "without historical premium runtime mounts."
        )
    _refuse_persisted_paid_account()


def _refuse_persisted_paid_account() -> None:
    """Refuse acquisition when the installed SDK already holds a paid credential.

    A Golden/Diamond credential persisted by the SDK stays active for later
    provider calls even under a free-tier runtime, so the free runtime must fail
    closed instead of silently acquiring on someone else's entitlement. The SDK
    is imported here when absent: a fresh process (scheduler/CLI, no lifespan)
    must be checked on its first import, not only after a later one.
    """
    module = sys.modules.get("vnstock")
    if module is None:
        try:
            module = __import__("vnstock")
        except Exception:
            # The SDK is genuinely absent: nothing can be persisted, and a later
            # provider import fails on its own. Proceed without provider access.
            return
    status = getattr(module, "status", None)
    if not callable(status):
        raise RuntimeError(
            "Free runtime cannot verify the installed vnstock credential state; "
            "refusing to acquire without a credential status check."
        )
    try:
        state = status()
    except Exception as exc:
        raise RuntimeError(
            "Free runtime could not read the installed vnstock credential state; "
            "refusing to acquire."
        ) from exc
    if not isinstance(state, dict):
        raise RuntimeError(
            "Installed vnstock credential status is malformed; refusing to acquire."
        )
    authenticated = state.get("authenticated")
    if authenticated is None:
        authenticated = state.get("has_api_key")
    if authenticated is not True:
        return
    tier = str(state.get("tier") or "").strip().lower()
    if tier in {"guest", "free"}:
        return
    if not tier:
        # An authenticated credential that reports no tier is an unverifiable
        # state: fail closed rather than acquire on an unknown plan.
        raise RuntimeError(
            "Installed vnstock reports an authenticated credential with no "
            "verifiable paid tier; refusing to acquire."
        )
    raise RuntimeError(
        f"Free runtime cannot use an authenticated {tier} credential; "
        "authenticate as a free or guest account."
    )


def validate_runtime() -> None:
    """Enforce the configured tier and VCI policy before importing the SDK."""
    tier = os.getenv("VNSTOCK_RUNTIME_TIER", settings.vnstock_runtime_tier).strip().lower()
    if tier not in {"free", "golden"}:
        raise ValueError("VNSTOCK_RUNTIME_TIER must be 'free' or 'golden'")
    if tier != settings.vnstock_runtime_tier:
        raise ValueError("VNSTOCK_RUNTIME_TIER differs from configured runtime tier")
    validate_source(settings.vnstock_source)
    validate_source(os.getenv("VNSTOCK_SOURCE", settings.vnstock_source))
    if tier == "free":
        validate_free_runtime()


def import_vnstock_symbol(name: str) -> tuple[Any, str]:
    validate_runtime()
    tier = os.getenv("VNSTOCK_RUNTIME_TIER", settings.vnstock_runtime_tier).strip().lower()
    if tier == "free":
        # Enforce the free-tier guard here too: callers that stub validate_runtime
        # must not be able to bypass the persisted-paid-credential refusal.
        _refuse_persisted_paid_account()
    module = __import__("vnstock", fromlist=[name])
    return getattr(module, name), "vnstock"


def get_listing_class():
    return import_vnstock_symbol("Listing")[0]


def get_trading_class():
    return import_vnstock_symbol("Trading")[0]


def get_quote_class():
    return import_vnstock_symbol("Quote")[0]


def get_finance_class():
    return import_vnstock_symbol("Finance")[0]


def get_company_class():
    return import_vnstock_symbol("Company")[0]


def create_reference_company(symbol: str, source: str):
    source = validate_source(source)
    return get_company_class()(symbol=symbol, source=source)


def validate_source(source: str | None = None) -> str:
    """Reject alternate providers before constructing a vnstock client."""
    normalized = (source or "VCI").strip().upper()
    if normalized != "VCI":
        raise ValueError(f"Unsupported vnstock source '{source}'; only free VCI is enabled")
    return normalized


def create_finance(symbol: str, source: str, period: str):
    import inspect
    factory = get_finance_class()
    kwargs = {"symbol": symbol, "source": validate_source(source)}
    parameters = inspect.signature(factory).parameters
    if "period" in parameters or any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()):
        kwargs["period"] = period
    return factory(**kwargs)


def finance_method_kwargs(method, period: str) -> dict:
    import inspect
    parameters = inspect.signature(method).parameters
    accepts_kwargs = any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters.values())
    kwargs = {}
    if "period" in parameters or accepts_kwargs:
        kwargs["period"] = period
    if "lang" in parameters or accepts_kwargs:
        kwargs["lang"] = "en"
    return kwargs


_financial_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vnstock-financial")
_financial_lock = Lock()
_financial_future = None
_financial_key: tuple | None = None
_reference_jobs: dict[tuple, asyncio.Future] = {}


async def run_reference_provider(operation: Callable, timeout: float | None, *, key: tuple):
    """Share occupied executor work even after a caller deadline expires."""
    loop = asyncio.get_running_loop()
    job_key = (loop, key)
    future = _reference_jobs.get(job_key)
    if future is None:
        if len(_reference_jobs) >= 32:
            raise RuntimeError("Reference provider acquisition capacity reached")
        future = loop.run_in_executor(None, operation)
        _reference_jobs[job_key] = future

        def finished(done):
            if _reference_jobs.get(job_key) is done:
                _reference_jobs.pop(job_key, None)
            if not done.cancelled():
                done.exception()

        future.add_done_callback(finished)
    return await asyncio.wait_for(asyncio.shield(future), timeout=timeout)


async def run_financial_provider(operation: Callable, timeout: float, *, key: tuple | None = None):
    """Share identical work; never queue behind a still-running financial call."""
    global _financial_future, _financial_key
    with _financial_lock:
        if _financial_future is not None and not _financial_future.done():
            if key is None or key != _financial_key:
                raise RuntimeError("Previous financial provider call is still running")
        else:
            _financial_future = _financial_executor.submit(operation)
            _financial_key = key
            _financial_future.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
        future = _financial_future
    wrapped = asyncio.wrap_future(future)
    wrapped.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
    return await asyncio.wait_for(asyncio.shield(wrapped), timeout=timeout)


def financial_provider_busy() -> bool:
    with _financial_lock:
        return _financial_future is not None and not _financial_future.done()
