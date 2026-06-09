"""APScheduler hook: nightly retry for the price-sync stage.

This curated-universe backfill keeps next-day data hot for the most-watched
tickers as a cheap safety net layered on top of the broad Postgres daily sync.
It targets Postgres `StockPrice`; the canonical Mongo `market_prices_eod` corpus
is advanced separately by `mongo_eod_sync` (see `core/scheduler.py`).

Note: an earlier revision of this file claimed the upstream price stage had been
"silently writing only a handful of symbols since Tet 2026". Live verification on
2026-06-09 showed the broad Postgres daily sync is in fact current across the
universe (non-curated symbols updating same-day), so that note was stale and has
been removed. This job remains as a low-cost redundancy for the priority list.

Triggered after HOSE close (set in `core/scheduler.py`).
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from vnibb.services.data_pipeline import data_pipeline

logger = logging.getLogger(__name__)


# Curated universe: blue-chip + index constituents + brokers.
# Mirrors the operator-run backfill script so behaviour is identical.
ACTIVE_TIER_1 = [
    "HPG", "VNM", "VCI", "VCB", "VHM", "FPT", "SSI", "VIC", "VRE", "VPB",
    "TCB", "MBB", "CTG", "BID", "STB", "MWG", "GAS", "POW", "GVR", "REE",
    "DGC", "VND", "HCM", "SHS", "MBS", "BSI", "VPS", "DSE", "BCM", "ACB",
    "SAB", "PLX", "HDB", "TPB", "VJC", "VNS", "NLG", "KBC", "HAG", "HSG",
    "NVL", "DXG", "DCM", "DPM", "BVH", "TCH", "BMP", "CTR", "KDH", "PDR",
    "HHV", "CII", "MSN", "PNJ", "HUT", "CMG", "SBT", "DGW", "FRT", "DBC",
    "ANV", "BFC", "DIG", "TLG", "BAF", "TNG", "KOS", "BWE", "NT2", "VHC",
    "SCS", "ELC", "HVN", "TIP", "TCD", "DBD", "FCN", "KHG", "CTS", "FTS",
    "VIB", "OCB", "EIB", "MSB", "LPB", "EVF", "VTP", "VEA", "MCH", "VPI",
    "VGC", "VEF", "VDS", "TVB", "TVS", "TCM", "TPB", "TRA", "VHC", "DSE",
]


async def run_nightly_price_backfill() -> int:
    """Backfill prices for the curated universe over the last 5 trading days.

    Five days is enough overlap to recover from any single provider hiccup
    without re-fetching the full quarter every night.
    """

    end = date.today()
    start = end - timedelta(days=5)
    symbols = list(dict.fromkeys(ACTIVE_TIER_1))
    logger.info(
        "Nightly price backfill: %d symbols, %s -> %s",
        len(symbols),
        start,
        end,
    )
    rows = await data_pipeline.sync_daily_prices(
        symbols=symbols,
        start_date=start,
        end_date=end,
        fill_missing_gaps=False,
        cache_recent=True,
    )
    logger.info("Nightly price backfill wrote %d rows", rows)
    return rows
