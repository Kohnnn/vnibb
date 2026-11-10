"""Synchronous market-data operations returning provider-native frames or rows.

The active adapter binding below is the replacement seam: another adapter must
implement the same signatures, preserve frame metadata and unavailable/error
semantics, and enforce its source policy before acquisition. ``history`` carries
``provider_source``, ``provider_module`` and ``asset_type`` metadata separately
from frame-declared source. ``run_reference`` and ``run_financial`` retain the
active adapter's timeout and concurrency behavior. Structured fetches continue
to use :class:`BaseFetcher`; this port never returns an SDK client or class.
"""

from vnibb.providers.vnstock.market_data import (
    balance_sheet,
    company_overview,
    company_profile,
    financial_ratios,
    forex_rates,
    history,
    index_history,
    intraday,
    listing,
    listing_metadata,
    price_board,
    raw_dataset,
    run_financial,
    run_reference,
    validate_source,
)

__all__ = [
    "balance_sheet", "company_overview", "company_profile", "financial_ratios",
    "forex_rates", "history", "index_history", "intraday", "listing",
    "listing_metadata", "price_board", "raw_dataset", "run_financial",
    "run_reference", "validate_source",
]
