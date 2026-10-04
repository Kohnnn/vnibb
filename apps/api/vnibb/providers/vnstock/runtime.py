"""Runtime helpers for preferring VNStock sponsor packages."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)


def import_vnstock_symbol(name: str) -> tuple[Any, str]:
    """Return a vnstock symbol, preferring sponsor `vnstock_data`."""
    try:
        module = __import__("vnstock_data", fromlist=[name])
        symbol = getattr(module, name)
        logger.debug("Using vnstock_data.%s", name)
        return symbol, "vnstock_data"
    except Exception as sponsor_error:
        module = __import__("vnstock", fromlist=[name])
        symbol = getattr(module, name)
        logger.warning(
            "Falling back to free vnstock.%s because vnstock_data import failed: %s",
            name,
            sponsor_error,
        )
        return symbol, "vnstock"


def get_vnstock_class():
    return import_vnstock_symbol("Vnstock")[0]


def get_listing_class():
    return import_vnstock_symbol("Listing")[0]


def get_trading_class():
    return import_vnstock_symbol("Trading")[0]


def get_quote_class():
    return import_vnstock_symbol("Quote")[0]


def get_finance_class():
    try:
        module = __import__("vnstock_data", fromlist=["Finance", "Fundamental"])
    except ImportError:
        return import_vnstock_symbol("Finance")[0]
    finance = getattr(module, "Finance", None)
    if finance is not None:
        return finance
    fundamental = module.Fundamental
    import inspect
    supports_constructor_source = "source" in inspect.signature(fundamental).parameters
    supports_equity_source = "source" in inspect.signature(fundamental.equity).parameters

    def create_finance(symbol: str, source: str, period: str = "year"):
        layer = fundamental(**({"source": source} if supports_constructor_source else {}))
        return layer.equity(symbol, **({"source": source} if supports_equity_source else {}))

    create_finance.supports_source = supports_constructor_source or supports_equity_source
    return create_finance


def get_company_class():
    return import_vnstock_symbol("Company")[0]


def create_finance(symbol: str, source: str, period: str):
    import inspect
    factory = get_finance_class()
    kwargs = {"symbol": symbol, "source": source}
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
