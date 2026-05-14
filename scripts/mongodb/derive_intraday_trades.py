"""Derive typed intraday trade rows from raw vnstock Mongo records.

Reads shared raw market data from market_vnstock_premium_records where
dataset=quote.intraday and writes only typed shared market read models to
market_intraday_trades. It does not write VNIBB app state.

Dry-run is the default; pass --apply to write.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = REPO_ROOT / "apps" / "api"
WORKSPACE_ROOT = REPO_ROOT.parent

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def to_float(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if numeric == numeric else None


def to_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def normalize_match_type(value: Any) -> str | None:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    if raw in {"buy", "b", "bu", "matched_buy"}:
        return "buy"
    if raw in {"sell", "s", "sd", "matched_sell"}:
        return "sell"
    return raw


def chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def build_trade_doc(raw_doc: dict[str, Any]) -> dict[str, Any] | None:
    raw = raw_doc.get("raw") or {}
    symbol = str(raw_doc.get("symbol") or raw.get("symbol") or "").upper().strip()
    trade_time = parse_datetime(raw.get("time") or raw_doc.get("observedAt"))
    price = to_float(raw.get("price"))
    volume = to_int(raw.get("volume"))

    if not symbol or trade_time is None or price is None or volume is None:
        return None

    source_record_key = str(raw_doc.get("recordKey") or "").strip()
    trade_id = str(raw.get("id") or source_record_key or f"{symbol}:{trade_time.isoformat()}:{price}:{volume}")
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    return {
        "symbol": symbol,
        "tradeTime": trade_time,
        "sessionDate": trade_time.date().isoformat(),
        "price": price,
        "volume": volume,
        "matchType": normalize_match_type(raw.get("match_type")),
        "tradeId": trade_id,
        "sourceRecordKey": source_record_key or None,
        "sourceCollection": "market_vnstock_premium_records",
        "providerSource": raw_doc.get("providerSource"),
        "schemaVersion": 1,
        "createdAt": now,
        "updatedAt": now,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Derive market_intraday_trades from raw quote.intraday records.")
    parser.add_argument("--symbols", default="ALL", help="Comma-separated symbols or ALL")
    parser.add_argument("--database", default=os.getenv("MONGODB_DATABASE", "frb"))
    parser.add_argument("--raw-collection", default="market_vnstock_premium_records")
    parser.add_argument("--derived-collection", default="market_intraday_trades")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--apply", action="store_true", help="Write to MongoDB. Default is dry-run.")
    parser.add_argument("--ensure-indexes", action="store_true", help="Create typed derived indexes when --apply is used.")
    return parser.parse_args()


def resolve_symbols(raw_symbols: str, raw_coll: Any) -> list[str]:
    if raw_symbols.upper() != "ALL":
        return [item.strip().upper() for item in raw_symbols.split(",") if item.strip()]
    return sorted(raw_coll.distinct("symbol", {"dataset": "quote.intraday"}))


def ensure_indexes(coll: Any) -> None:
    coll.create_index([("symbol", 1), ("tradeTime", -1)])
    coll.create_index([("symbol", 1), ("sessionDate", -1), ("tradeTime", 1)])
    coll.create_index(
        [("symbol", 1), ("tradeId", 1), ("tradeTime", 1)],
        unique=True,
        sparse=True,
        name="symbol_1_tradeId_1_tradeTime_1_unique_sparse",
    )
    coll.create_index(
        [("sourceRecordKey", 1)],
        unique=True,
        sparse=True,
        name="sourceRecordKey_1_unique_sparse",
    )


def upsert_batch(coll: Any, docs: list[dict[str, Any]]) -> tuple[int, int]:
    from pymongo import UpdateOne

    if not docs:
        return 0, 0

    operations = []
    for doc in docs:
        created_at = doc.pop("createdAt")
        operations.append(
            UpdateOne(
                {"sourceRecordKey": doc["sourceRecordKey"]},
                {"$set": doc, "$setOnInsert": {"createdAt": created_at}},
                upsert=True,
            )
        )
    result = coll.bulk_write(operations, ordered=False)
    return int(result.upserted_count), int(result.modified_count)


def main() -> int:
    load_env_file(WORKSPACE_ROOT / ".env")
    load_env_file(REPO_ROOT / ".env")
    load_env_file(API_ROOT / ".env")
    args = parse_args()

    mongodb_url = os.getenv("MONGODB_URL")
    if not mongodb_url:
        raise SystemExit("MONGODB_URL is required")

    from pymongo import MongoClient

    client = MongoClient(mongodb_url, serverSelectionTimeoutMS=10000, connectTimeoutMS=10000, socketTimeoutMS=30000)
    db = client[args.database]
    raw_coll = db[args.raw_collection]
    derived_coll = db[args.derived_collection]

    if args.apply and args.ensure_indexes:
        ensure_indexes(derived_coll)

    symbols = resolve_symbols(args.symbols, raw_coll)
    total_read = 0
    total_valid = 0
    total_upserted = 0
    total_modified = 0

    print(
        {
            "mode": "apply" if args.apply else "dry-run",
            "database": args.database,
            "raw_collection": args.raw_collection,
            "derived_collection": args.derived_collection,
            "symbol_count": len(symbols),
        }
    )

    for symbol_batch in chunked(symbols, max(1, args.batch_size)):
        cursor = raw_coll.find(
            {"dataset": "quote.intraday", "symbol": {"$in": symbol_batch}},
            {
                "_id": 0,
                "symbol": 1,
                "recordKey": 1,
                "observedAt": 1,
                "providerSource": 1,
                "raw.id": 1,
                "raw.time": 1,
                "raw.price": 1,
                "raw.volume": 1,
                "raw.match_type": 1,
                "raw.symbol": 1,
            },
        ).sort([("symbol", 1), ("observedAt", 1)])

        docs = []
        read_count = 0
        for raw_doc in cursor:
            read_count += 1
            trade_doc = build_trade_doc(raw_doc)
            if trade_doc is not None:
                docs.append(trade_doc)

        upserted = modified = 0
        if args.apply:
            upserted, modified = upsert_batch(derived_coll, docs)
        total_read += read_count
        total_valid += len(docs)
        total_upserted += upserted
        total_modified += modified
        print(
            {
                "symbols": len(symbol_batch),
                "raw_docs": read_count,
                "valid_docs": len(docs),
                "upserted": upserted,
                "modified": modified,
            }
        )

    print(
        {
            "total_read": total_read,
            "total_valid": total_valid,
            "total_upserted": total_upserted,
            "total_modified": total_modified,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
