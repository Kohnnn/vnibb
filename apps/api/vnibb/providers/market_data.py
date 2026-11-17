"""Synchronous market-data operations and offline source transforms.

Named exports load their adapter only when requested. Importing this port or a
DNSE transform does not initialize the legacy provider; deliberate FHSC/legacy
resolution and wildcard imports retain their normal initialization. Legacy
history preserves provider source, module and asset-type metadata separately
from frame-declared source, and the run helpers retain timeout/concurrency behavior.
Adapters enforce source policy before acquisition and never return SDK clients.
"""

from importlib import import_module
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from vnibb.providers.dnse import dnse_history as dnse_history
    from vnibb.providers.dnse import dnse_listing as dnse_listing
    from vnibb.providers.dnse import dnse_quote as dnse_quote
    from vnibb.providers.dnse import dnse_unavailable as dnse_unavailable
    from vnibb.providers.fhsc import fhsc_financials as fhsc_financials
    from vnibb.providers.fhsc import fhsc_history as fhsc_history
    from vnibb.providers.fhsc import fhsc_listing as fhsc_listing
    from vnibb.providers.fhsc import fhsc_quote as fhsc_quote
    from vnibb.providers.vnstock.market_data import balance_sheet as balance_sheet
    from vnibb.providers.vnstock.market_data import company_overview as company_overview
    from vnibb.providers.vnstock.market_data import company_profile as company_profile
    from vnibb.providers.vnstock.market_data import financial_ratios as financial_ratios
    from vnibb.providers.vnstock.market_data import forex_rates as forex_rates
    from vnibb.providers.vnstock.market_data import history as history
    from vnibb.providers.vnstock.market_data import index_history as index_history
    from vnibb.providers.vnstock.market_data import intraday as intraday
    from vnibb.providers.vnstock.market_data import listing as listing
    from vnibb.providers.vnstock.market_data import listing_metadata as listing_metadata
    from vnibb.providers.vnstock.market_data import price_board as price_board
    from vnibb.providers.vnstock.market_data import raw_dataset as raw_dataset
    from vnibb.providers.vnstock.market_data import run_financial as run_financial
    from vnibb.providers.vnstock.market_data import run_reference as run_reference
    from vnibb.providers.vnstock.market_data import validate_source as validate_source

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
