"""Populate shared MongoDB market datasets from installed vnstock APIs.

This script writes only shared market/raw data to MongoDB. It must not write
VNIBB-native app state such as dashboards, widgets, sessions, or preferences.
Dry-run is the default; pass --apply to write.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = REPO_ROOT / "apps" / "api"
WORKSPACE_ROOT = REPO_ROOT.parent

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


DATASET_SPECS: dict[str, dict[str, Any]] = {
    "quote.history": {"group": "quote", "scope": "symbol", "observed_field": "time"},
    "quote.intraday": {"group": "quote", "scope": "symbol", "observed_field": "time"},
    "quote.price_depth": {"group": "quote", "scope": "symbol", "observed_field": None},
    "trading.price_board": {"group": "trading", "scope": "symbol", "observed_field": "time"},
    "company.profile": {"group": "company", "scope": "symbol", "observed_field": None},
    "company.overview": {"group": "company", "scope": "symbol", "observed_field": None},
    "company.shareholders": {"group": "company", "scope": "symbol", "observed_field": "date"},
    "company.officers": {"group": "company", "scope": "symbol", "observed_field": None},
    "company.subsidiaries": {"group": "company", "scope": "symbol", "observed_field": None},
    "company.dividends": {"group": "company", "scope": "symbol", "observed_field": "exerciseDate"},
    "company.events": {"group": "company", "scope": "symbol", "observed_field": "date"},
    "company.news": {"group": "company", "scope": "symbol", "observed_field": "publishDate"},
    "company.insider_deals": {"group": "company", "scope": "symbol", "observed_field": "dealDate"},
    "company.trading_stats": {"group": "company", "scope": "symbol", "observed_field": None},
    "finance.income_statement": {"group": "finance", "scope": "symbol", "observed_field": "yearReport"},
    "finance.balance_sheet": {"group": "finance", "scope": "symbol", "observed_field": "yearReport"},
    "finance.cash_flow": {"group": "finance", "scope": "symbol", "observed_field": "yearReport"},
    "finance.ratio": {"group": "finance", "scope": "symbol", "observed_field": "yearReport"},
}


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


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    return str(value)


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
        pass
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw[:10], fmt)
        except ValueError:
            continue
    return None


def stable_json(value: Any) -> str:
    return json.dumps(json_safe(value), sort_keys=True, default=str, ensure_ascii=False)


def hash_text(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def resolve_observed_at(raw: dict[str, Any], spec: dict[str, Any]) -> datetime | None:
    field = spec.get("observed_field")
    if field and field in raw:
        parsed = parse_datetime(raw.get(field))
        if parsed:
            return parsed
    for fallback in ("time", "date", "tradeDate", "tradingDate", "createdAt", "updatedAt"):
        if fallback in raw:
            parsed = parse_datetime(raw.get(fallback))
            if parsed:
                return parsed
    return None


def make_raw_record(
    *,
    dataset: str,
    symbol: str,
    raw: dict[str, Any],
    source: str,
    sync_run_id: str,
) -> dict[str, Any]:
    spec = DATASET_SPECS[dataset]
    symbol_upper = symbol.upper()
    raw_safe = json_safe(raw)
    observed_at = resolve_observed_at(raw_safe, spec)
    raw_hash = hash_text(stable_json(raw_safe))
    record_basis = f"{dataset}:{symbol_upper}:{observed_at or ''}:{raw.get('id') or raw.get('symbol') or raw_hash}"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "dataset": dataset,
        "datasetGroup": spec["group"],
        "scopeType": spec["scope"],
        "scopeKey": symbol_upper,
        "symbol": symbol_upper,
        "recordKey": hash_text(record_basis),
        "contentHash": raw_hash,
        "observedAt": observed_at,
        "providerSource": source.upper(),
        "qualityFlags": ["VNSTOCK_RAW_SHARED_MARKET_DATA"],
        "raw": raw_safe,
        "schemaVersion": 1,
        "source": "vnstock",
        "syncRunId": sync_run_id,
        "createdAt": now,
        "updatedAt": now,
        "syncedAt": now,
    }


def dataframe_to_records(df: Any, limit: int | None = None) -> list[dict[str, Any]]:
    if df is None:
        return []
    try:
        if getattr(df, "empty", False):
            return []
        records = df.to_dict(orient="records")
    except AttributeError:
        if isinstance(df, list):
            records = [item for item in df if isinstance(item, dict)]
        elif isinstance(df, dict):
            records = [df]
        else:
            return []
    if limit and limit > 0:
        return records[-limit:]
    return records


def fetch_dataset(
    symbol: str,
    dataset: str,
    source: str,
    limit: int,
    history_start: str,
    history_end: str,
    intraday_page_size: int,
) -> list[dict[str, Any]]:
    from vnstock import Vnstock

    stock = Vnstock().stock(symbol=symbol.upper(), source=source.upper())
    if dataset == "quote.history":
        return dataframe_to_records(stock.quote.history(start=history_start, end=history_end, interval="1D"), limit)
    if dataset == "quote.intraday":
        return dataframe_to_records(stock.quote.intraday(page_size=max(intraday_page_size, limit, 1000)), limit)
    if dataset == "quote.price_depth":
        return dataframe_to_records(stock.quote.price_depth(), limit)
    if dataset == "trading.price_board":
        from vnstock import Trading

        trading = Trading(source=source.upper())
        return dataframe_to_records(trading.price_board(symbols_list=[symbol.upper()], flatten_columns=True, drop_levels=[0]), limit)

    company_methods = {
        "company.profile": stock.company.profile,
        "company.overview": stock.company.overview,
        "company.shareholders": stock.company.shareholders,
        "company.officers": stock.company.officers,
        "company.subsidiaries": stock.company.subsidiaries,
        "company.dividends": stock.company.dividends,
        "company.events": stock.company.events,
        "company.news": stock.company.news,
        "company.insider_deals": stock.company.insider_deals,
        "company.trading_stats": stock.company.trading_stats,
    }
    if dataset in company_methods:
        return dataframe_to_records(company_methods[dataset](), limit)

    finance_methods = {
        "finance.income_statement": stock.finance.income_statement,
        "finance.balance_sheet": stock.finance.balance_sheet,
        "finance.cash_flow": stock.finance.cash_flow,
        "finance.ratio": stock.finance.ratio,
    }
    if dataset in finance_methods:
        return dataframe_to_records(finance_methods[dataset](period="quarter", lang="en"), limit)

    raise ValueError(f"Unsupported dataset: {dataset}")


def fetch_price_board_batch(symbols: list[str], source: str, limit: int) -> dict[str, list[dict[str, Any]]]:
    from vnstock import Trading

    trading = Trading(source=source.upper())
    df = trading.price_board(symbols_list=[symbol.upper() for symbol in symbols], flatten_columns=True, drop_levels=[0])
    grouped: dict[str, list[dict[str, Any]]] = {symbol.upper(): [] for symbol in symbols}
    for row in dataframe_to_records(df, limit):
        symbol = str(row.get("symbol") or row.get("ticker") or row.get("code") or "").upper()
        if symbol in grouped:
            grouped[symbol].append(row)
    return grouped


def ensure_raw_indexes(coll: Any) -> None:
    coll.create_index([("dataset", 1), ("scopeKey", 1), ("recordKey", 1)], unique=True)
    coll.create_index([("dataset", 1), ("scopeKey", 1), ("observedAt", -1), ("syncedAt", -1), ("_id", 1)])
    coll.create_index([("dataset", 1), ("symbol", 1), ("observedAt", -1), ("syncedAt", -1), ("_id", 1)], sparse=True)


def upsert_records(coll: Any, records: list[dict[str, Any]], *, skip_unchanged: bool = True) -> tuple[int, int, int]:
    from pymongo import UpdateOne

    skipped = 0
    if skip_unchanged and records:
        keys = [
            {"dataset": record["dataset"], "scopeKey": record["scopeKey"], "recordKey": record["recordKey"]}
            for record in records
        ]
        existing = {
            (doc.get("dataset"), doc.get("scopeKey"), doc.get("recordKey")): doc.get("contentHash")
            for doc in coll.find(
                {"$or": keys},
                {"_id": 0, "dataset": 1, "scopeKey": 1, "recordKey": 1, "contentHash": 1},
            )
        }
        filtered = []
        for record in records:
            key = (record["dataset"], record["scopeKey"], record["recordKey"])
            if existing.get(key) == record["contentHash"]:
                skipped += 1
                continue
            filtered.append(record)
        records = filtered

    operations = []
    for record in records:
        created_at = record.pop("createdAt")
        operations.append(
            UpdateOne(
                {"dataset": record["dataset"], "scopeKey": record["scopeKey"], "recordKey": record["recordKey"]},
                {"$set": record, "$setOnInsert": {"createdAt": created_at}},
                upsert=True,
            )
        )
    if not operations:
        return 0, 0, skipped
    result = coll.bulk_write(operations, ordered=False)
    return int(result.upserted_count), int(result.modified_count), skipped


def chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Populate shared MongoDB market data from installed vnstock APIs.")
    parser.add_argument("--symbols", default="AAA", help="Comma-separated symbols or ALL")
    parser.add_argument("--datasets", default="quote.intraday,quote.price_depth,trading.price_board", help="Comma-separated datasets or ALL")
    parser.add_argument("--source", default=os.getenv("VNSTOCK_SOURCE", "KBS"))
    parser.add_argument("--database", default=os.getenv("MONGODB_DATABASE", "frb"))
    parser.add_argument("--collection", default="market_vnstock_premium_records")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--intraday-page-size", type=int, default=10000)
    parser.add_argument("--history-start", default="2020-01-01")
    parser.add_argument("--history-end", default=datetime.now().strftime("%Y-%m-%d"))
    parser.add_argument("--calls-per-minute", type=int, default=int(os.getenv("VNSTOCK_CALLS_PER_MINUTE", "120") or 120))
    parser.add_argument("--price-board-batch-size", type=int, default=50)
    parser.add_argument("--write-unchanged", action="store_true", help="Write identical records again. Default skips unchanged content hashes.")
    parser.add_argument("--apply", action="store_true", help="Write to MongoDB. Default is dry-run.")
    parser.add_argument("--ensure-indexes", action="store_true", help="Create minimal raw-record indexes when --apply is used.")
    return parser.parse_args()


def resolve_symbols(raw_symbols: str, source: str) -> list[str]:
    if raw_symbols.upper() != "ALL":
        return [item.strip().upper() for item in raw_symbols.split(",") if item.strip()]
    from vnstock import Listing

    listing = Listing(source=source.upper())
    df = listing.all_symbols()
    records = dataframe_to_records(df)
    symbols = [str(row.get("symbol") or row.get("ticker") or "").upper() for row in records]
    return sorted({symbol for symbol in symbols if symbol})


def main() -> int:
    load_env_file(WORKSPACE_ROOT / ".env")
    load_env_file(REPO_ROOT / ".env")
    load_env_file(API_ROOT / ".env")
    args = parse_args()

    datasets = list(DATASET_SPECS) if args.datasets.upper() == "ALL" else [item.strip() for item in args.datasets.split(",") if item.strip()]
    unknown = [dataset for dataset in datasets if dataset not in DATASET_SPECS]
    if unknown:
        raise SystemExit(f"Unsupported datasets: {', '.join(unknown)}")

    symbols = resolve_symbols(args.symbols, args.source)
    sync_run_id = f"vnstock-mongo-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    delay = 60 / max(1, args.calls_per_minute)
    total_fetched = 0
    total_upserted = 0
    total_modified = 0
    total_skipped = 0

    coll = None
    if args.apply:
        mongodb_url = os.getenv("MONGODB_URL")
        if not mongodb_url:
            raise SystemExit("MONGODB_URL is required when --apply is used")
        from pymongo import MongoClient

        client = MongoClient(mongodb_url, serverSelectionTimeoutMS=10000, connectTimeoutMS=10000, socketTimeoutMS=30000)
        coll = client[args.database][args.collection]
        if args.ensure_indexes:
            ensure_raw_indexes(coll)

    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "database": args.database,
                "collection": args.collection,
                "symbol_count": len(symbols),
                "datasets": datasets,
                "sync_run_id": sync_run_id,
            },
            indent=2,
        )
    )

    if "trading.price_board" in datasets:
        started = time.monotonic()
        for batch in chunked(symbols, max(1, args.price_board_batch_size)):
            try:
                grouped_rows = fetch_price_board_batch(batch, args.source, args.limit)
            except Exception as exc:
                print(json.dumps({"symbols": batch, "dataset": "trading.price_board", "error": str(exc)}, default=str))
                continue
            for symbol, rows in grouped_rows.items():
                records = [make_raw_record(dataset="trading.price_board", symbol=symbol, raw=row, source=args.source, sync_run_id=sync_run_id) for row in rows]
                total_fetched += len(records)
                upserted = modified = skipped = 0
                if args.apply and coll is not None and records:
                    upserted, modified, skipped = upsert_records(coll, records, skip_unchanged=not args.write_unchanged)
                    total_upserted += upserted
                    total_modified += modified
                    total_skipped += skipped
                print(json.dumps({"symbol": symbol, "dataset": "trading.price_board", "rows": len(records), "upserted": upserted, "modified": modified, "skipped": skipped}, default=str))
            elapsed = time.monotonic() - started
            if elapsed < delay:
                time.sleep(delay - elapsed)
            started = time.monotonic()

    per_symbol_datasets = [dataset for dataset in datasets if dataset != "trading.price_board"]

    for symbol in symbols:
        for dataset in per_symbol_datasets:
            started = time.monotonic()
            try:
                rows = fetch_dataset(
                    symbol,
                    dataset,
                    args.source,
                    args.limit,
                    args.history_start,
                    args.history_end,
                    args.intraday_page_size,
                )
            except Exception as exc:
                print(json.dumps({"symbol": symbol, "dataset": dataset, "error": str(exc)}, default=str))
                continue
            records = [make_raw_record(dataset=dataset, symbol=symbol, raw=row, source=args.source, sync_run_id=sync_run_id) for row in rows]
            total_fetched += len(records)
            upserted = modified = skipped = 0
            if args.apply and coll is not None and records:
                upserted, modified, skipped = upsert_records(coll, records, skip_unchanged=not args.write_unchanged)
                total_upserted += upserted
                total_modified += modified
                total_skipped += skipped
            print(json.dumps({"symbol": symbol, "dataset": dataset, "rows": len(records), "upserted": upserted, "modified": modified, "skipped": skipped}, default=str))
            elapsed = time.monotonic() - started
            if elapsed < delay:
                time.sleep(delay - elapsed)

    print(json.dumps({"total_fetched": total_fetched, "total_upserted": total_upserted, "total_modified": total_modified, "total_skipped": total_skipped}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
