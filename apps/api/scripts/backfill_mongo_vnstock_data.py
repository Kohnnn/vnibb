#!/usr/bin/env python3
"""Backfill shared Mongo market datasets from sponsored vnstock_data.

This script is intentionally narrow and explicit: it writes only the shared
read-model collections used by VNIBB widgets and requires symbols to be passed
on the command line.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _clean_value(value: Any) -> Any:
    if hasattr(value, "item"):
        value = value.item()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    try:
        import pandas as pd

        if pd.isna(value):
            return None
    except Exception:
        pass
    return value


def _frame_rows(frame: Any) -> list[dict[str, Any]]:
    if frame is None or getattr(frame, "empty", True):
        return []
    rows: list[dict[str, Any]] = []
    for row in frame.to_dict(orient="records"):
        rows.append({str(key): _clean_value(value) for key, value in row.items()})
    return rows


def _period_key(raw: dict[str, Any]) -> str:
    period = raw.get("period") or raw.get("year_period") or raw.get("yearReport") or raw.get("year")
    quarter = raw.get("quarter") or raw.get("fiscalQuarter")
    if period is None:
        return "unknown"
    if quarter not in (None, ""):
        try:
            quarter_value = int(float(quarter))
        except (TypeError, ValueError):
            quarter_value = 0
        if 1 <= quarter_value <= 4 and "Q" not in str(period).upper():
            return f"{period}-Q{quarter_value}"
    return str(period)


def _record_key(dataset: str, symbol: str, raw: dict[str, Any]) -> str:
    period = _period_key(raw)
    if period != "unknown":
        return f"vnstock-data:{dataset}:{symbol}:{period}"
    raw_key = json.dumps(raw, sort_keys=True, ensure_ascii=False, default=str)
    digest = hashlib.sha1(raw_key.encode("utf-8")).hexdigest()[:16]
    return f"vnstock-data:{dataset}:{symbol}:{digest}"


def _period_observed_at(raw: dict[str, Any]) -> datetime:
    period = _period_key(raw)
    year_text = period[:4]
    try:
        year = int(year_text)
    except ValueError:
        year = datetime.now(UTC).year
    return datetime(year, 1, 1)


def _trade_date(raw: dict[str, Any]) -> datetime | None:
    value = raw.get("time") or raw.get("date") or raw.get("tradeDate")
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _float_value(raw: dict[str, Any], key: str) -> float | None:
    value = raw.get(key)
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int_value(raw: dict[str, Any], key: str) -> int | None:
    value = raw.get(key)
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _upsert_price_rows(db: Any, symbol: str, rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    from pymongo import UpdateOne

    coll = db.market_prices_eod
    synced_at = _now()
    count = 0
    ops: list[Any] = []
    for raw in rows:
        trade_date = _trade_date(raw)
        if trade_date is None:
            continue
        doc = {
            "symbol": symbol,
            "tradeDate": trade_date,
            "interval": "1D",
            "source": "vnstock-data",
            "sourceKey": f"vnstock-data:{symbol}:eod:{trade_date.date().isoformat()}",
            "open": _float_value(raw, "open"),
            "high": _float_value(raw, "high"),
            "low": _float_value(raw, "low"),
            "close": _float_value(raw, "close"),
            "volume": _int_value(raw, "volume"),
            "updatedAt": synced_at,
            "syncedAt": synced_at,
            "schemaVersion": 1,
        }
        if dry_run:
            count += 1
            continue
        ops.append(
            UpdateOne(
                {"symbol": symbol, "tradeDate": trade_date, "source": "vnstock-data"},
                {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                upsert=True,
            )
        )
        count += 1
    if ops:
        coll.bulk_write(ops, ordered=False)
    return count


def _upsert_raw_rows(
    db: Any,
    symbol: str,
    dataset: str,
    rows: list[dict[str, Any]],
    *,
    dry_run: bool,
) -> int:
    from pymongo import UpdateOne

    coll = db.market_vnstock_premium_records
    synced_at = _now()
    count = 0
    ops: list[Any] = []
    for raw in rows:
        record_key = _record_key(dataset, symbol, raw)
        doc = {
            "dataset": dataset,
            "datasetGroup": dataset.split(".", 1)[0],
            "symbol": symbol,
            "scopeKey": symbol,
            "scopeType": "symbol",
            "source": "vnstock-data",
            "providerSource": "vnstock_data",
            "recordKey": record_key,
            "observedAt": _period_observed_at(raw),
            "raw": {**raw, "symbol": symbol, "ticker": raw.get("ticker") or symbol},
            "updatedAt": synced_at,
            "syncedAt": synced_at,
            "schemaVersion": 1,
        }
        if dry_run:
            count += 1
            continue
        ops.append(
            UpdateOne(
                {"dataset": dataset, "symbol": symbol, "recordKey": record_key},
                {"$set": doc, "$setOnInsert": {"createdAt": synced_at}},
                upsert=True,
            )
        )
        count += 1
    if ops:
        coll.bulk_write(ops, ordered=False)
    return count


def _wants(selected: set[str], key: str) -> bool:
    base_key = key.rsplit(".", 1)[0] if key.endswith((".year", ".quarter")) else key
    return "all" in selected or key in selected or base_key in selected


def _fetch_symbol(symbol: str, *, start: str, end: str, selected: set[str]) -> dict[str, list[dict[str, Any]]]:
    from vnstock_data import Fundamental, Market, Reference

    datasets: dict[str, list[dict[str, Any]]] = {}
    if _wants(selected, "market_prices_eod"):
        datasets["market_prices_eod"] = _frame_rows(Market().equity(symbol).history(start=start, end=end))

    finance_keys = [
        "finance.income_statement.year",
        "finance.income_statement.quarter",
        "finance.balance_sheet.year",
        "finance.balance_sheet.quarter",
        "finance.cash_flow.year",
        "finance.cash_flow.quarter",
        "finance.ratio.year",
        "finance.ratio.quarter",
    ]
    wanted_finance = [key for key in finance_keys if _wants(selected, key)]
    if wanted_finance:
        fundamental = Fundamental().equity(symbol)
        fetchers = {
            "finance.income_statement.year": lambda: fundamental.income_statement(period="year"),
            "finance.income_statement.quarter": lambda: fundamental.income_statement(period="quarter"),
            "finance.balance_sheet.year": lambda: fundamental.balance_sheet(period="year"),
            "finance.balance_sheet.quarter": lambda: fundamental.balance_sheet(period="quarter"),
            "finance.cash_flow.year": lambda: fundamental.cash_flow(period="year"),
            "finance.cash_flow.quarter": lambda: fundamental.cash_flow(period="quarter"),
            "finance.ratio.year": lambda: fundamental.ratio(period="year"),
            "finance.ratio.quarter": lambda: fundamental.ratio(period="quarter"),
        }
        for key in wanted_finance:
            datasets[key] = _frame_rows(fetchers[key]())

    if _wants(selected, "reference.shareholders"):
        datasets["reference.shareholders"] = _frame_rows(Reference().company(symbol).shareholders())
    return datasets


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", required=True, help="Comma-separated symbols, e.g. VCI,SSI")
    parser.add_argument(
        "--datasets",
        default="all",
        help="Comma-separated datasets or groups, e.g. market_prices_eod,finance.ratio,all",
    )
    parser.add_argument("--start", default="2000-01-01")
    parser.add_argument("--end", default=datetime.now(UTC).date().isoformat())
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    mongo_url = os.getenv("MONGODB_URL")
    mongo_db = os.getenv("MONGODB_DATABASE", "frb")
    if not mongo_url:
        raise SystemExit("MONGODB_URL is required")

    from pymongo import MongoClient

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=10000)
    db = client[mongo_db]
    summary: dict[str, dict[str, int]] = {}

    for raw_symbol in args.symbols.split(","):
        symbol = raw_symbol.strip().upper()
        if not symbol:
            continue
        selected = {item.strip() for item in args.datasets.split(",") if item.strip()}
        datasets = _fetch_symbol(symbol, start=args.start, end=args.end, selected=selected)
        result: dict[str, int] = {}
        if "market_prices_eod" in datasets:
            result["market_prices_eod"] = _upsert_price_rows(
                db, symbol, datasets["market_prices_eod"], dry_run=args.dry_run
            )
        for dataset, rows in datasets.items():
            if dataset == "market_prices_eod":
                continue
            mongo_dataset = dataset.rsplit(".", 1)[0] if dataset.endswith((".year", ".quarter")) else dataset
            result[dataset] = _upsert_raw_rows(db, symbol, mongo_dataset, rows, dry_run=args.dry_run)
        summary[symbol] = result

    print(json.dumps({"dry_run": args.dry_run, "summary": summary}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
