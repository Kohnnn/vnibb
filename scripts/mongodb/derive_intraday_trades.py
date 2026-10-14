"""Derive typed intraday trade rows from raw vnstock Mongo records.

Reads current equity.intraday and legacy quote.intraday records from shared
market_vnstock_premium_records and writes typed retained trade rows to
market_intraday_trades. It does not write VNIBB app state.

Dry-run is the default; pass --apply to write.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from math import isfinite
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
    if value is None:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc)
    return parsed.replace(tzinfo=None)


def to_float(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if isfinite(numeric) else None


def to_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError, OverflowError):
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
    if raw_doc.get("batchReceipt") is True:
        return None
    raw = raw_doc.get("raw")
    if not isinstance(raw, dict):
        return None
    symbol = str(raw_doc.get("symbol") or raw.get("symbol") or raw.get("ticker") or "").upper().strip()
    source_time = raw.get("time") or raw_doc.get("observedAt")
    trade_time = parse_datetime(source_time)
    price = to_float(raw.get("price"))
    volume = to_int(raw.get("volume"))
    if not symbol or trade_time is None or price is None or volume is None:
        return None

    source_record_key = str(raw_doc.get("recordKey") or "").strip()
    raw_id = raw.get("id")
    trade_id = str(raw_id if raw_id is not None else source_record_key or f"{symbol}:{trade_time.isoformat()}:{price}:{volume}")
    session_date = raw_doc.get("sessionDate") or raw_doc.get("sourceDate") or raw.get("sessionDate")
    if session_date is None:
        session_date = source_time.date().isoformat() if isinstance(source_time, datetime) else str(source_time)[:10]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    doc = {
        "symbol": symbol,
        "tradeTime": trade_time,
        "observedAt": parse_datetime(raw_doc.get("observedAt")),
        "sessionDate": str(session_date)[:10],
        "price": price,
        "volume": volume,
        "matchType": normalize_match_type(raw.get("match_type")),
        "tradeId": trade_id,
        "sourceDataset": raw_doc.get("dataset"),
        "sourceCollection": raw_doc.get("sourceCollection", "market_vnstock_premium_records"),
        "coverage": "historical_retained_window",
        "latestSessionStatus": raw_doc.get("latestSessionStatus", "unknown"),
        "schemaVersion": 2,
        "createdAt": now,
        "updatedAt": now,
        "storedAt": now,
    }
    if source_record_key:
        doc["sourceRecordKey"] = source_record_key
    if "coverage" in raw_doc:
        doc["sourceCoverage"] = raw_doc["coverage"]
    for key in ("source", "providerSource", "unit", "priceUnit", "volumeUnit", "timestampMeaning", "sourceDate", "requestedSessionDate", "syncRunId"):
        if key in raw_doc:
            doc[key] = raw_doc[key]
    for key in ("updatedAt", "syncedAt"):
        if key in raw_doc:
            doc[f"source{key[0].upper()}{key[1:]}"] = raw_doc[key]
    return doc


def derive_symbol_records(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    dataset = "equity.intraday" if any(row.get("dataset") == "equity.intraday" for row in records) else "quote.intraday"
    selected = [row for row in records if row.get("dataset") == dataset]
    batches = [(row, parse_datetime(row.get("updatedAt") or row.get("syncedAt"))) for row in selected]
    newest = max((stamp for _, stamp in batches if stamp is not None), default=None)
    latest = [row for row, stamp in batches if stamp == newest] if newest is not None else []
    normalized = [(build_trade_doc(row), stamp) for row, stamp in batches]
    docs = [doc for doc, _ in normalized if doc is not None]
    latest_valid = sum(doc is not None and stamp == newest for doc, stamp in normalized) if newest is not None else 0
    explicit_empty = any(row.get("rowCount") == 0 for row in latest)
    status = "unknown" if newest is None else "empty" if explicit_empty else "available" if latest_valid else "no_valid_trades"
    session_status = next((row["latestSessionStatus"] for row in latest if row.get("latestSessionStatus") is not None), "unknown")
    for doc in docs:
        doc.update(latestBatchUpdatedAt=newest, latestBatchStatus=status, latestSessionStatus=session_status)
    return docs, {
        "source_dataset": dataset if selected else None,
        "latest_batch_updated_at": newest,
        "latest_batch_status": status,
        "latest_session_status": session_status,
        "latest_batch_valid_rows": latest_valid,
        "retained_valid_rows": len(docs),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Derive retained intraday trades without inventing session freshness.")
    parser.add_argument("--symbols", default="ALL", help="Comma-separated symbols or ALL")
    parser.add_argument("--database", default=os.getenv("MONGODB_DATABASE", "vnibb-market"))
    parser.add_argument("--raw-collection", default="market_vnstock_premium_records")
    parser.add_argument("--derived-collection", default="market_intraday_trades")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--apply", action="store_true", help="Write to MongoDB. Default is dry-run.")
    parser.add_argument("--ensure-indexes", action="store_true", help="Create typed derived indexes when --apply is used.")
    return parser.parse_args()


def resolve_symbols(raw_symbols: str, raw_coll: Any) -> list[str]:
    if raw_symbols.upper() != "ALL":
        return [item.strip().upper() for item in raw_symbols.split(",") if item.strip()]
    return sorted(raw_coll.distinct("symbol", {"dataset": {"$in": ["equity.intraday", "quote.intraday"]}}))


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
        values = {key: value for key, value in doc.items() if key != "createdAt"}
        identity = {"sourceRecordKey": doc["sourceRecordKey"]} if doc.get("sourceRecordKey") else {
            "symbol": doc["symbol"], "tradeId": doc["tradeId"], "tradeTime": doc["tradeTime"],
        }
        operations.append(
            UpdateOne(
                identity,
                {"$set": values, "$setOnInsert": {"createdAt": doc["createdAt"]}},
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
        records_by_symbol: dict[str, list[dict[str, Any]]] = {symbol: [] for symbol in symbol_batch}
        read_count = 0
        cursor = raw_coll.find(
            {"dataset": {"$in": ["equity.intraday", "quote.intraday"]}, "symbol": {"$in": symbol_batch}},
            {"_id": 0},
        )
        for raw_doc in cursor:
            read_count += 1
            records_by_symbol[raw_doc["symbol"]].append({**raw_doc, "sourceCollection": args.raw_collection})
        docs = []
        for symbol, records in records_by_symbol.items():
            symbol_docs, report = derive_symbol_records(records)
            docs.extend(symbol_docs)
            print({"symbol": symbol, **report})

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
