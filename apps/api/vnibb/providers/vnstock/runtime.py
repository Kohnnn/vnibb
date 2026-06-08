"""Runtime helpers for preferring VNStock sponsor packages."""

from __future__ import annotations

import logging
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
