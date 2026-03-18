from __future__ import annotations

import argparse
import asyncio
from datetime import date, datetime

from vnibb.core.config import settings
from vnibb.services.appwrite_price_service import AppwritePriceService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill Appwrite stock_prices history to 2019."
    )
    parser.add_argument("--symbols", default="", help="Comma-separated ticker symbols")
    parser.add_argument(
        "--all-active",
        action="store_true",
        help="Backfill all active Appwrite stock documents when --symbols is omitted",
    )
    parser.add_argument("--max-symbols", type=int, default=None)
    parser.add_argument(
        "--start-date",
        default=settings.price_backfill_start_date or "2019-01-01",
    )
    parser.add_argument("--end-date", default="2021-03-09")
    parser.add_argument("--source", default="KBS")
    parser.add_argument("--symbol-concurrency", type=int, default=2)
    parser.add_argument("--appwrite-concurrency", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=150)
    parser.add_argument(
        "--no-cache-recent",
        action="store_true",
        help="Skip Redis recent/latest cache refresh after Appwrite writes",
    )
    parser.add_argument(
        "--no-gap-fill",
        action="store_true",
        help="Disable head/tail Appwrite coverage checks and re-upsert the full requested range",
    )
    return parser.parse_args()


def parse_iso_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def parse_symbols(value: str) -> list[str] | None:
    symbols = [item.strip().upper() for item in value.split(",") if item.strip()]
    return symbols or None


async def main() -> None:
    args = parse_args()
    if not args.all_active and not args.symbols:
        raise SystemExit("Provide --symbols or pass --all-active")

    service = AppwritePriceService(source=args.source)
    stats = await service.sync_prices_from_provider(
        symbols=parse_symbols(args.symbols),
        start_date=parse_iso_date(args.start_date),
        end_date=parse_iso_date(args.end_date),
        max_symbols=args.max_symbols,
        fill_missing_gaps=not args.no_gap_fill,
        cache_recent=not args.no_cache_recent,
        symbol_concurrency=args.symbol_concurrency,
        appwrite_concurrency=args.appwrite_concurrency,
        appwrite_batch_size=args.batch_size,
    )

    print(
        (
            "Appwrite price backfill complete: "
            f"symbols_requested={stats.symbols_requested} "
            f"processed={stats.symbols_processed} skipped={stats.symbols_skipped} "
            f"failed={stats.symbols_failed} created={stats.rows_created} "
            f"updated={stats.rows_updated} row_failures={stats.rows_failed}"
        ),
        flush=True,
    )


if __name__ == "__main__":
    asyncio.run(main())
