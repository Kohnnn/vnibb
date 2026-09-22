from __future__ import annotations

import argparse
import asyncio
from datetime import date, datetime

from vnibb.core.config import settings
from vnibb.services.data_pipeline import data_pipeline
from vnibb.services.sync_all_data import FullMarketSync


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill stock price history to 2019."
    )
    parser.add_argument(
        "--start-date",
        default=settings.price_backfill_start_date or "2019-01-01",
    )
    parser.add_argument("--end-date", default=date.today().isoformat())
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--symbols", default="")
    parser.add_argument("--source", default=settings.vnstock_source)
    return parser.parse_args()


def parse_iso_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def chunk_symbols(symbols: list[str], batch_size: int) -> list[list[str]]:
    size = max(1, batch_size)
    return [symbols[index : index + size] for index in range(0, len(symbols), size)]


async def resolve_symbols(symbol_arg: str) -> list[str]:
    requested = [item.strip().upper() for item in symbol_arg.split(",") if item.strip()]
    all_symbols = await FullMarketSync()._get_seeded_symbols()
    if not requested:
        return all_symbols

    requested_set = set(requested)
    return [symbol for symbol in all_symbols if symbol in requested_set]


async def main() -> None:
    args = parse_args()
    start_date = parse_iso_date(args.start_date)
    end_date = parse_iso_date(args.end_date)
    symbols = await resolve_symbols(args.symbols)

    batches = chunk_symbols(symbols, args.batch_size)

    print(
        f"Backfilling {len(symbols)} symbols from {start_date.isoformat()} to {end_date.isoformat()} "
        f"in {len(batches)} batches of up to {max(1, args.batch_size)}",
        flush=True,
    )

    total_rows = 0
    for index, batch in enumerate(batches, start=1):
        synced_rows = await data_pipeline.sync_daily_prices(
            symbols=batch,
            start_date=start_date,
            end_date=end_date,
            fill_missing_gaps=True,
            cache_recent=False,
        )
        total_rows += synced_rows
        print(
            f"[{index}/{len(batches)}] symbols={len(batch)} rows_synced={synced_rows} cumulative_rows={total_rows}",
            flush=True,
        )

    print(f"Backfill complete. Total rows synced: {total_rows}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
