#!/usr/bin/env python3
"""Daily maintenance for the Vietcap-primary market_prices_eod corpus.

Run AFTER the vnstock daily scheduler. Two idempotent steps:

1. Rescale `vnstock-data` rows still in thousand-VND to raw VND (x1000), marking
   them so they are never double-scaled.
2. Reconcile overlaps: where a `vietcap` bar exists for a (symbol, tradeDate),
   delete the duplicate non-`vietcap` bar (archived first for rollback).

Dry-run by default; pass --apply to write. See vnibb/docs/VIETCAP_DATA_SOURCE.md.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]  # .../vnibb
WORKSPACE_ROOT = REPO_ROOT.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import vietcap_writers as w  # noqa: E402


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write changes (default dry-run)")
    args = parser.parse_args()

    load_env_file(WORKSPACE_ROOT / ".env")
    load_env_file(REPO_ROOT / ".env")
    load_env_file(REPO_ROOT / "apps" / "api" / ".env")

    mongo_url = os.getenv("MONGODB_URL")
    if not mongo_url:
        raise SystemExit("MONGODB_URL is required")

    from pymongo import MongoClient, UpdateOne

    db = MongoClient(mongo_url, serverSelectionTimeoutMS=10000)[
        os.getenv("MONGODB_DATABASE", "vnibb-market")
    ]
    eod = db["market_prices_eod"]
    now = datetime.now(UTC).replace(tzinfo=None)

    # Step 1: rescale thousand-VND vnstock rows to raw VND.
    rescale_query = {"source": "vnstock-data", "priceUnit": {"$ne": "VND"}}
    to_rescale = eod.count_documents(rescale_query)
    rescaled = 0
    if args.apply and to_rescale:
        ops = []
        for doc in eod.find(rescale_query):
            upd = {"priceUnit": "VND", "rescaledFromThousandVnd": True, "updatedAt": now}
            for field in ("open", "high", "low", "close"):
                value = doc.get(field)
                if isinstance(value, (int, float)) and value is not None:
                    upd[field] = value * 1000
            ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": upd}))
        if ops:
            rescaled = eod.bulk_write(ops, ordered=False).modified_count

    # Step 2: reconcile overlaps for all vietcap symbols.
    vietcap_syms = sorted(eod.distinct("symbol", {"source": "vietcap"}))
    removed = 0
    touched = 0
    for symbol in vietcap_syms:
        _, n = w.reconcile_eod_source(db, symbol, dry_run=not args.apply)
        if n:
            removed += n
            touched += 1

    print(
        {
            "mode": "apply" if args.apply else "dry-run",
            "rescale_candidates": to_rescale,
            "rescaled": rescaled,
            "vietcap_symbols": len(vietcap_syms),
            "overlap_removed": removed,
            "symbols_touched": touched,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
