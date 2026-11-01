"""Retain raw shared market datasets through the vnstock 5 VCI interface.

Dry-run is the default; pass --apply to write. Frame provenance and SDK
column names are retained without asserting monetary or percentage units.
Financial datasets are refused: this collection feeds admitted financial
consumers, so raw-only flags cannot replace their financial admission pipeline.
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
from typing import Any, Iterable, NamedTuple


REPO_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = REPO_ROOT / "apps" / "api"
WORKSPACE_ROOT = REPO_ROOT.parent

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


DATASET_SPECS: dict[str, dict[str, Any]] = {
    "quote.history": {"group": "quote", "scope": "symbol", "observed_field": "time", "route": "market.equity.ohlcv"},
    "quote.intraday": {"group": "quote", "scope": "symbol", "observed_field": "time", "route": "market.equity.trades"},
    "quote.price_depth": {"group": "quote", "scope": "symbol", "observed_field": None, "route": "market.equity.volume_profile"},
    "trading.price_board": {"group": "trading", "scope": "symbol", "observed_field": "time", "route": "market.equity.quote"},
    "company.profile": {"group": "company", "scope": "symbol", "observed_field": None, "route": "fundamental.company.info", "method": "info"},
    "company.overview": {"group": "company", "scope": "symbol", "observed_field": None, "route": "fundamental.company.overview"},
    "company.shareholders": {"group": "company", "scope": "symbol", "observed_field": "date", "route": "fundamental.company.shareholders", "method": "shareholders"},
    "company.officers": {"group": "company", "scope": "symbol", "observed_field": None, "route": "fundamental.company.officers", "method": "officers"},
    "company.subsidiaries": {"group": "company", "scope": "symbol", "observed_field": None, "route": "fundamental.company.subsidiaries", "method": "subsidiaries"},
    "company.dividends": {"group": "company", "scope": "symbol", "observed_field": "exerciseDate"},
    "company.events": {"group": "company", "scope": "symbol", "observed_field": "public_date", "route": "fundamental.company.events", "method": "events"},
    "company.news": {"group": "company", "scope": "symbol", "observed_field": "publishDate"},
    "company.insider_deals": {"group": "company", "scope": "symbol", "observed_field": "dealDate"},
    "company.trading_stats": {"group": "company", "scope": "symbol", "observed_field": "time", "route": "market.equity.session_stats"},
    "finance.income_statement": {"group": "finance", "scope": "symbol", "observed_field": "yearReport"},
    "finance.balance_sheet": {"group": "finance", "scope": "symbol", "observed_field": "yearReport"},
    "finance.cash_flow": {"group": "finance", "scope": "symbol", "observed_field": "yearReport"},
    "finance.ratio": {"group": "finance", "scope": "symbol", "observed_field": "yearReport"},
}

DATASET_GAPS = {
    "company.dividends": "SDK 5.2.1 has no company.dividends route; event disclosures are not a certified dividend table",
    "company.news": "SDK 5.2.1 removed company.news (VNSTOCK_FEATURE_REMOVED)",
    "company.insider_deals": "VCI insider_trading output schema and units are not certified for insider_deals",
}


class DatasetRows(NamedTuple):
    rows: list[dict[str, Any]]
    metadata: dict[str, Any]


def require_supported_dataset(dataset: str) -> dict[str, Any]:
    if dataset not in DATASET_SPECS:
        raise ValueError(f"Unsupported dataset: {dataset}")
    if dataset.startswith("finance."):
        raise ValueError(f"{dataset}: use the financial admission pipeline; raw SDK financial persistence is disabled")
    if dataset in DATASET_GAPS:
        raise ValueError(f"{dataset}: {DATASET_GAPS[dataset]}")
    return DATASET_SPECS[dataset]


def validate_metadata(metadata: dict[str, Any], source: str | None, route: str) -> None:
    from vnibb.providers.vnstock.runtime import validate_source

    source = validate_source(source)
    if str(metadata.get("source") or "").upper() != source:
        raise ValueError("Missing or conflicting SDK provider source provenance")
    if metadata.get("route") != route or parse_datetime(metadata.get("requested_at")) is None:
        raise ValueError(f"Missing or conflicting SDK route/request provenance: {route}")


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
    metadata: dict[str, Any],
    batch_time: datetime | None = None,
) -> dict[str, Any]:
    spec = require_supported_dataset(dataset)
    validate_metadata(metadata, source, spec["route"])
    symbol_upper = symbol.upper()
    raw_safe = json_safe(raw)
    metadata_safe = json_safe(metadata)
    lineage = {key: value for key, value in metadata_safe.items() if key not in {"requested_at", "retrieved_at", "latency_ms", "request_count", "length"}}
    observed_at = resolve_observed_at(raw_safe, spec)
    raw_hash = hash_text(stable_json(raw_safe))
    record_basis = f"{dataset}:{symbol_upper}:{observed_at or ''}:{raw.get('id') or raw_hash}"
    now = batch_time or datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "dataset": dataset,
        "datasetGroup": spec["group"],
        "scopeType": spec["scope"],
        "scopeKey": symbol_upper,
        "symbol": symbol_upper,
        "recordKey": hash_text(record_basis),
        "contentHash": hash_text(stable_json({"raw": raw_safe, "lineage": lineage})),
        "observedAt": observed_at,
        "providerSource": str(metadata["source"]).upper(),
        "providerMetadata": metadata_safe,
        "sdkGeneration": 5,
        "normalizationStatus": "raw_unadmitted",
        "price_unit": "unknown",
        "qualityFlags": ["VNSTOCK_RAW_SHARED_MARKET_DATA", "UNADMITTED_SDK_VALUES"],
        "raw": raw_safe,
        "schemaVersion": 2,
        "source": "vnstock",
        "syncRunId": sync_run_id,
        "createdAt": now,
        "updatedAt": now,
        "syncedAt": now,
    }


def read_sdk_frame(frame: Any, *, source: str, route: str, limit: int | None = None) -> DatasetRows:
    import pandas as pd

    if (
        not isinstance(frame, pd.DataFrame)
        or isinstance(frame.columns, pd.MultiIndex)
        or not frame.columns.is_unique
        or any(not isinstance(column, str) for column in frame.columns)
    ):
        raise ValueError(f"Unsupported SDK result shape: {route}")
    metadata = dict(frame.attrs)
    validate_metadata(metadata, source, route)
    rows = frame.to_dict(orient="records")
    return DatasetRows(rows[-limit:] if limit and limit > 0 else rows, metadata)


def fetch_dataset(
    symbol: str,
    dataset: str,
    source: str,
    limit: int,
    history_start: str,
    history_end: str,
    intraday_page_size: int,
) -> DatasetRows:
    from vnibb.providers.vnstock.runtime import import_vnstock_symbol, validate_source

    source = validate_source(source)
    spec = require_supported_dataset(dataset)
    symbol = symbol.upper()
    if dataset == "trading.price_board":
        return fetch_price_board_batch([symbol], source, limit)[symbol]
    if dataset == "company.overview":
        Company, _ = import_vnstock_symbol("Company")
        frame = Company(symbol=symbol, source=source).overview()
    elif "method" in spec:
        Reference, _ = import_vnstock_symbol("Reference")
        company = Reference().company(symbol)
        frame = getattr(company, spec["method"])(source=source)
    else:
        Market, _ = import_vnstock_symbol("Market")
        market = Market().equity(symbol)
        if dataset == "quote.history":
            frame = market.ohlcv(start=history_start, end=history_end, interval="1D", source=source, floating=None)
        elif dataset == "quote.intraday":
            frame = market.trades(limit=max(intraday_page_size, limit, 1000), source=source)
        elif dataset == "quote.price_depth":
            frame = market.volume_profile(source=source)
        else:
            frame = market.session_stats(source=source)
    return read_sdk_frame(frame, source=source, route=spec["route"], limit=limit)


def fetch_price_board_batch(symbols: list[str], source: str, limit: int) -> dict[str, DatasetRows]:
    from vnibb.providers.vnstock.runtime import import_vnstock_symbol, validate_source

    source = validate_source(source)
    Market, _ = import_vnstock_symbol("Market")
    symbols = [symbol.upper() for symbol in symbols]
    frame = Market().equity(symbols).quote(source=source)
    result = read_sdk_frame(frame, source=source, route=DATASET_SPECS["trading.price_board"]["route"])
    grouped: dict[str, list[dict[str, Any]]] = {symbol: [] for symbol in symbols}
    for row in result.rows:
        symbol = str(row.get("symbol") or "").upper()
        if symbol not in grouped:
            raise ValueError("Price board row is missing a requested symbol identity")
        if limit <= 0 or len(grouped[symbol]) < limit:
            grouped[symbol].append(row)
    return {symbol: DatasetRows(rows, result.metadata) for symbol, rows in grouped.items()}


def ensure_raw_indexes(coll: Any) -> None:
    coll.create_index([("dataset", 1), ("scopeKey", 1), ("recordKey", 1)], unique=True)
    coll.create_index([("dataset", 1), ("scopeKey", 1), ("observedAt", -1), ("syncedAt", -1), ("_id", 1)])
    coll.create_index([("dataset", 1), ("symbol", 1), ("observedAt", -1), ("syncedAt", -1), ("_id", 1)], sparse=True)


def upsert_records(coll: Any, records: list[dict[str, Any]], *, skip_unchanged: bool = True) -> tuple[int, int, int]:
    for record in records:
        spec = require_supported_dataset(record["dataset"])
        validate_metadata(record.get("providerMetadata", {}), record.get("providerSource"), spec["route"])
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
    parser.add_argument("--source", default=os.getenv("VNSTOCK_SOURCE", "VCI"), help="VCI only; alternate SDK defaults are refused.")
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
    from vnibb.providers.vnstock.runtime import import_vnstock_symbol, validate_source

    source = validate_source(source)
    if raw_symbols.upper() != "ALL":
        return [item.strip().upper() for item in raw_symbols.split(",") if item.strip()]
    Listing, _ = import_vnstock_symbol("Listing")
    frame = Listing(source=source).all_symbols()
    result = read_sdk_frame(frame, source=source, route="reference.equity.list")
    symbols = [str(row.get("symbol") or "").upper() for row in result.rows]
    if any(not symbol for symbol in symbols):
        raise ValueError("Equity listing row is missing a symbol identity")
    return sorted(set(symbols))


def main() -> int:
    load_env_file(WORKSPACE_ROOT / ".env")
    load_env_file(REPO_ROOT / ".env")
    load_env_file(API_ROOT / ".env")
    args = parse_args()

    datasets = list(DATASET_SPECS) if args.datasets.upper() == "ALL" else [item.strip() for item in args.datasets.split(",") if item.strip()]
    from vnibb.providers.vnstock.runtime import validate_runtime, validate_source

    try:
        args.source = validate_source(args.source)
        for dataset in datasets:
            require_supported_dataset(dataset)
        validate_runtime()
    except ValueError as exc:
        raise SystemExit(str(exc)) from None

    symbols = resolve_symbols(args.symbols, args.source)
    sync_run_id = f"vnstock-mongo-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    delay = 60 / max(1, args.calls_per_minute)
    total_fetched = 0
    total_upserted = 0
    total_modified = 0
    total_skipped = 0
    total_errors = 0

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
                total_errors += 1
                print(json.dumps({"symbols": batch, "dataset": "trading.price_board", "error": str(exc)}, default=str))
                continue
            batch_time = datetime.now(timezone.utc).replace(tzinfo=None)
            for symbol, result in grouped_rows.items():
                records = [make_raw_record(dataset="trading.price_board", symbol=symbol, raw=row, source=args.source, sync_run_id=sync_run_id, metadata=result.metadata, batch_time=batch_time) for row in result.rows]
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
                result = fetch_dataset(
                    symbol,
                    dataset,
                    args.source,
                    args.limit,
                    args.history_start,
                    args.history_end,
                    args.intraday_page_size,
                )
            except Exception as exc:
                total_errors += 1
                print(json.dumps({"symbol": symbol, "dataset": dataset, "error": str(exc)}, default=str))
                continue
            batch_time = datetime.now(timezone.utc).replace(tzinfo=None)
            records = [make_raw_record(dataset=dataset, symbol=symbol, raw=row, source=args.source, sync_run_id=sync_run_id, metadata=result.metadata, batch_time=batch_time) for row in result.rows]
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

    print(json.dumps({"total_fetched": total_fetched, "total_upserted": total_upserted, "total_modified": total_modified, "total_skipped": total_skipped, "total_errors": total_errors}, indent=2))
    return 1 if total_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
