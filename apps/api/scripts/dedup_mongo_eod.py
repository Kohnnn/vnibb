"""Per-symbol dedup of market_prices_eod.

Pass --symbols VCI,FPT,VIX,... or --all for full sweep.
Smaller batches avoid the global aggregation pipeline timeout.

Deleting is opt-in. Without ``--apply`` this script only reports what it would
remove, because the previous revision called ``delete_many`` unconditionally:
running it to see the damage caused the damage, with no archive and no
source awareness. Two rows can share a (symbol, tradeDate) and still differ in
quality -- ``market_prices_eod`` holds both ``vietcap`` and ``vnstock-data``
bars, and the survivor must be the higher-ranked one, not merely the most
recently touched.

Ranking is delegated to ``mongo_market_data_service._eod_row_rank`` so the
script and the read path agree on which duplicate wins. Keeping a second,
weaker copy of that rule here is what allowed a later-touched but
lower-precedence row to delete a better one.

Docs: ``docs/data_retention_partitioning.md``.
"""

import argparse
import asyncio
from collections import defaultdict
from datetime import datetime

from vnibb.services.mongo_market_data_service import (
    _eod_row_rank,
    get_mongo_market_data_service,
)

ARCHIVE_COLLECTION = "market_prices_eod_dedup_archive"


def dedup_symbol(coll, symbol: str, *, apply: bool) -> tuple[int, int]:
    """Returns (groups_with_dup, rows_removed_or_would_remove)."""
    by_day = defaultdict(list)
    cursor = coll.find({"symbol": symbol})
    for doc in cursor:
        td = doc.get("tradeDate")
        if isinstance(td, datetime):
            day = td.strftime("%Y-%m-%d")
        else:
            day = str(td)[:10]
        by_day[day].append(doc)

    duplicate_groups = 0
    delete_docs = []
    for docs in by_day.values():
        if len(docs) <= 1:
            continue
        duplicate_groups += 1
        # Canonical ranking: validity, then source precedence (vietcap before
        # vnstock-data), then lineage, then sourceKey. Lowest rank survives.
        docs.sort(key=_eod_row_rank)
        for d in docs[1:]:
            delete_docs.append(d)

    if not apply or not delete_docs:
        return duplicate_groups, len(delete_docs)

    archive = coll.database[ARCHIVE_COLLECTION]
    for i in range(0, len(delete_docs), 500):
        batch = delete_docs[i : i + 500]
        # Archive the exact documents first so the removal is reversible.
        stamp = datetime.utcnow()
        for d in batch:
            d["archivedAt"] = stamp
            d["archivedReason"] = "eod_dedup"
        try:
            archive.insert_many(batch, ordered=False)
        except Exception as exc:  # noqa: BLE001 - archive is best-effort
            print(f"  archive insert failed ({exc}); aborting this batch")
            continue
        coll.delete_many({"_id": {"$in": [d["_id"] for d in batch]}})
    return duplicate_groups, len(delete_docs)


def describe(day_docs: list[dict]) -> str:
    """One-line summary of which sources are competing for a day."""
    counts: dict[str, int] = defaultdict(int)
    for d in day_docs:
        counts[str(d.get("source") or "unknown")] += 1
    return ", ".join(f"{s}x{n}" for s, n in sorted(counts.items()))


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", default=None, help="Comma-separated, or omit to use --all")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete. Without this flag the run is a dry run and reports only.",
    )
    args = parser.parse_args()

    mode = "APPLY (deleting)" if args.apply else "DRY RUN (no writes)"
    print(f"Mode: {mode}")

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
    total_removed = 0
    for i, sym in enumerate(symbols, 1):
        try:
            groups, removed = dedup_symbol(coll, sym, apply=args.apply)
            if groups:
                verb = "rows deleted" if args.apply else "rows would be deleted"
                print(f"[{i}/{len(symbols)}] {sym}: {groups} dup-groups, {removed} {verb}")
            total_groups += groups
            total_removed += removed
        except Exception as exc:
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {exc}")

    verb = "rows deleted" if args.apply else "rows would be deleted"
    print(
        f"\nTotal: {total_groups} duplicate groups, {total_removed} {verb} "
        f"across {len(symbols)} symbols"
    )
    if not args.apply and total_removed:
        print("Re-run with --apply to perform the deletion.")
        print(f"Removed rows are archived to {ARCHIVE_COLLECTION} before deletion.")


asyncio.run(main())
