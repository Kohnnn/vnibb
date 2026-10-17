"""Runtime helpers for the free VNStock VCI provider."""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from importlib.util import find_spec
from threading import Lock
from typing import Any


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


def import_vnstock_symbol(name: str) -> tuple[Any, str]:
    """Validate the free VCI policy before community import can authenticate VNAI."""
    tier = os.getenv("VNSTOCK_RUNTIME_TIER", "free").strip().lower()
    if tier != "free":
        raise ValueError("VNSTOCK_RUNTIME_TIER must be 'free'; paid runtimes are disabled")
    validate_source(os.getenv("VNSTOCK_SOURCE", "VCI"))
    validate_free_runtime()
    module = __import__("vnstock", fromlist=[name])
    return getattr(module, name), "vnstock"


def get_vnstock_class():
    return import_vnstock_symbol("Vnstock")[0]


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
    validate_source(source)
    import_vnstock_symbol("Company")
    from vnstock.explorer.vci import Company

    return Company(symbol=symbol)


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


async def run_financial_provider(operation: Callable, timeout: float):
    """Do not enqueue more calls behind a timed-out, still-running provider thread."""
    global _financial_future
    with _financial_lock:
        if _financial_future is not None and not _financial_future.done():
            raise RuntimeError("Previous financial provider call is still running")
        _financial_future = _financial_executor.submit(operation)
        future = _financial_future
    return await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(future)), timeout=timeout)


def financial_provider_busy() -> bool:
    with _financial_lock:
        return _financial_future is not None and not _financial_future.done()
