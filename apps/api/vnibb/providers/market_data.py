"""Synchronous market-data operations and offline source transforms.

Named exports load their adapter only when requested. Importing this port or a
DNSE transform does not initialize the legacy provider; deliberate FHSC/legacy
resolution and wildcard imports retain their normal initialization. Legacy
history preserves provider source, module and asset-type metadata separately
from frame-declared source, and the run helpers retain timeout/concurrency behavior.
Adapters enforce source policy before acquisition and never return SDK clients.
"""

from importlib import import_module

_DNSE_EXPORTS = ("dnse_history", "dnse_quote", "dnse_listing", "dnse_unavailable")
_FHSC_EXPORTS = ("fhsc_financials", "fhsc_history", "fhsc_listing", "fhsc_quote")
_VNSTOCK_EXPORTS = (
    "balance_sheet", "company_overview", "company_profile", "financial_ratios",
    "forex_rates", "history", "index_history", "intraday", "listing",
    "listing_metadata", "price_board", "raw_dataset", "run_financial",
    "run_reference", "validate_source",
)

__all__ = [*_DNSE_EXPORTS, *_FHSC_EXPORTS, *_VNSTOCK_EXPORTS]


def __getattr__(name: str):
    if name in _DNSE_EXPORTS:
        module = "vnibb.providers.dnse"
    elif name in _FHSC_EXPORTS:
        module = "vnibb.providers.fhsc"
    elif name in _VNSTOCK_EXPORTS:
        module = "vnibb.providers.vnstock.market_data"
    else:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(module), name)
    globals()[name] = value
    return value


def __dir__():
    return sorted(set(globals()) | set(__all__))
