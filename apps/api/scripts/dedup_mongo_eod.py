"""Per-symbol dedup of market_prices_eod.

Pass --symbols VCI,FPT,VIX,... or --all for full sweep.
Smaller batches avoid the global aggregation pipeline timeout.
"""

import argparse
import asyncio
from collections import defaultdict
from datetime import datetime
from vnibb.services.mongo_market_data_service import get_mongo_market_data_service


def dedup_symbol(coll, symbol: str) -> tuple[int, int]:
    """Returns (groups_with_dup, rows_deleted)."""
    by_day = defaultdict(list)
    cursor = coll.find(
        {"symbol": symbol},
        {"_id": 1, "tradeDate": 1, "updatedAt": 1, "createdAt": 1},
    )
    for doc in cursor:
        td = doc.get("tradeDate")
        if isinstance(td, datetime):
            day = td.strftime("%Y-%m-%d")
        else:
            day = str(td)[:10]
        by_day[day].append(doc)

    duplicate_groups = 0
    delete_ids = []
    for day, docs in by_day.items():
        if len(docs) <= 1:
            continue
        duplicate_groups += 1
        # Sort: keep the row with latest updatedAt then createdAt then largest _id
        def rank(doc):
            return (
                doc.get("updatedAt") or doc.get("createdAt") or datetime.min,
                str(doc.get("_id")),
            )
        docs.sort(key=rank, reverse=True)
        for d in docs[1:]:
            delete_ids.append(d["_id"])

    deleted = 0
    for i in range(0, len(delete_ids), 500):
        batch = delete_ids[i : i + 500]
        result = coll.delete_many({"_id": {"$in": batch}})
        deleted += result.deleted_count
    return duplicate_groups, deleted


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", default=None, help="Comma-separated, or omit to use --all")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    svc = get_mongo_market_data_service()
    if not svc.enabled:
        print("Mongo not enabled")
        return

    coll = svc._get_collection("market_prices_eod")

    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    elif args.all:
        symbols = sorted(coll.distinct("symbol"))
        print(f"Found {len(symbols)} distinct symbols.")
        if args.limit:
            symbols = symbols[: args.limit]
    else:
        print("Pass --symbols or --all")
        return

    total_groups = 0
    total_deleted = 0
    for i, sym in enumerate(symbols, 1):
        try:
            groups, deleted = dedup_symbol(coll, sym)
            if groups:
                print(f"[{i}/{len(symbols)}] {sym}: {groups} dup-groups, {deleted} rows deleted")
            total_groups += groups
            total_deleted += deleted
        except Exception as exc:
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {exc}")

    print(f"\nTotal: {total_groups} duplicate groups, {total_deleted} rows deleted across {len(symbols)} symbols")


asyncio.run(main())
