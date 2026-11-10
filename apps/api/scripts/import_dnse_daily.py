#!/usr/bin/env python
"""Import DNSE daily bars for named symbols (bounded, additive).

Usage:
  python scripts/import_dnse_daily.py --symbols VNM,FPT --start 2026-10-01 --end 2026-11-10

Requires DNSE_ENABLED=true plus DNSE_API_KEY/DNSE_API_SECRET. Nothing runs on
startup, no scheduler hook is enabled, and existing price rows are never
overwritten: this is the operator-scoped entrypoint, not an acquisition service.
DNSE's data-use rights are recorded as unknown (#232); the operator decides.
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.providers.dnse import DNSEConfigError
from vnibb.services.dnse_sync import sync_daily_prices


def _day(value: str) -> date:
    return date.fromisoformat(value)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--symbols", required=True, help="Comma-separated tickers")
    parser.add_argument("--start", required=True, type=_day)
    parser.add_argument("--end", required=True, type=_day)
    args = parser.parse_args()
    if args.start > args.end:
        parser.error("--start must not be after --end")
    try:
        receipt = await sync_daily_prices(
            [symbol for symbol in args.symbols.split(",") if symbol.strip()], args.start, args.end
        )
    except DNSEConfigError as exc:
        print(json.dumps({"status": "refused", "error": str(exc)}, indent=2), file=sys.stderr)
        return 2
    print(json.dumps(receipt, indent=2, ensure_ascii=False))
    return 0 if receipt["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
