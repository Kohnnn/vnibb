"""One-off backfill to recover stock_prices coverage after the daily sync stopped writing post-Tết 2026.

Run inside vnibb-api container:
    docker exec vnibb-api python /tmp/backfill.py
"""
from __future__ import annotations

import asyncio
from datetime import date


SYMBOLS = [
    # Blue-chip + index constituents + brokers
    "HPG", "VNM", "VCI", "VCB", "VHM", "FPT", "SSI", "VIC", "VRE", "VPB",
    "TCB", "MBB", "CTG", "BID", "STB", "MWG", "GAS", "POW", "GVR", "REE",
    "DGC", "VND", "HCM", "SHS", "MBS", "BSI", "VPS", "DSE", "BCM", "ACB",
    "SAB", "PLX", "HDB", "TPB", "VJC", "VNS", "NLG", "KBC", "HAG", "HSG",
    "NVL", "DXG", "DCM", "DPM", "BVH", "TCH", "BMP", "CTR", "KDH", "PDR",
    "HHV", "CII", "MSN", "PNJ", "HUT", "CMG", "SBT", "DGW", "FRT", "DBC",
    "ANV", "BFC", "DIG", "TLG", "BAF", "TNG", "KOS", "BWE", "NT2", "VHC",
    "SCS", "ELC", "HVN", "TIP", "TCD", "DBD", "FCN", "KHG", "CTS", "FTS",
    "VIB", "OCB", "EIB", "MSB", "LPB", "EVF", "VTP", "POW", "VEA", "MCH",
    "VND", "VPS", "VPI", "VPB", "VHC", "VGC", "VGS", "VGI", "VEF", "VDS",
    "VCB", "VBC", "VAB", "VBH", "TVB", "TVS", "TVT", "TV2", "TV6", "TTC",
    "TCM", "TLH", "TIG", "THP", "THV", "TIN", "TIS", "TIA", "TID", "TIE",
    "TJC", "TKC", "TLD", "TLG", "TLI", "TLT", "TMB", "TMP", "TNB", "TNC",
    "TNI", "TNT", "TNW", "TOP", "TOS", "TOT", "TPB", "TPC", "TPP", "TR1",
    "TRA", "TRC", "TRP", "TRS", "TRT", "TS3", "TS4", "TSA", "TSB", "TSC",
    "TSD", "TSG", "TSJ", "TST", "TT6", "TTA", "TTB", "TTC", "TTE", "TTF",
    "TTH", "TTL", "TTN", "TTP", "TTS", "TTT", "TTZ", "TUG", "TV1", "TV2",
    "TV3", "TV4", "TV6", "TVB", "TVC", "TVD", "TVG", "TVH", "TVM", "TVN",
    "TVP", "TVS", "TVT", "TVW", "TW3", "TXM", "TYA",
]


async def main():
    from vnibb.services.data_pipeline import data_pipeline

    symbols = list(dict.fromkeys(SYMBOLS))
    end = date(2026, 5, 19)
    start = date(2026, 2, 1)
    print(f"Backfilling {len(symbols)} symbols from {start} to {end}")
    rows = await data_pipeline.sync_daily_prices(
        symbols=symbols,
        start_date=start,
        end_date=end,
        fill_missing_gaps=False,
        cache_recent=True,
    )
    print(f"Synced rows: {rows}")


if __name__ == "__main__":
    asyncio.run(main())
