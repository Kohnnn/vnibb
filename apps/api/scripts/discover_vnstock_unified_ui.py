#!/usr/bin/env python3
"""Catalog VNStock premium Unified UI surfaces for Mongo ingestion planning."""

from __future__ import annotations

import argparse
import inspect
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


def _jsonable(value: Any) -> Any:
    if value is inspect.Signature.empty:
        return None
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _method_signature(method: Any) -> dict[str, Any]:
    try:
        signature = inspect.signature(method)
    except (TypeError, ValueError):
        return {"text": None, "parameters": []}

    parameters = []
    for name, param in signature.parameters.items():
        parameters.append(
            {
                "name": name,
                "kind": str(param.kind),
                "default": _jsonable(param.default),
                "annotation": _jsonable(param.annotation),
            }
        )
    return {"text": str(signature), "parameters": parameters}


def _public_methods(obj: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name in dir(obj):
        if name.startswith("_"):
            continue
        try:
            member = getattr(obj, name)
        except Exception as exc:  # noqa: BLE001
            rows.append(
                {
                    "method": name,
                    "status": "attribute_error",
                    "error": str(exc),
                    "callable": False,
                }
            )
            continue
        if not callable(member):
            continue
        rows.append(
            {
                "method": name,
                "status": "cataloged",
                "callable": True,
                "signature": _method_signature(member),
                "doc": inspect.getdoc(member),
            }
        )
    return rows


def _catalog_vnstock_data(sample_symbol: str) -> list[dict[str, Any]]:
    import vnstock_data

    cataloged_at = _now()
    rows: list[dict[str, Any]] = []
    class_names = [
        "Market",
        "Fundamental",
        "Reference",
        "Insights",
        "Analytics",
        "Macro",
        "News",
        "Company",
        "Finance",
        "Listing",
        "Quote",
        "Trading",
        "Vnstock",
    ]

    for class_name in class_names:
        cls = getattr(vnstock_data, class_name, None)
        if cls is None:
            rows.append(
                {
                    "provider": "vnstock_data",
                    "layer": class_name.lower(),
                    "object": class_name,
                    "method": None,
                    "status": "missing_class",
                    "lastCheckedAt": cataloged_at,
                }
            )
            continue

        try:
            instance = cls()
        except Exception as exc:  # noqa: BLE001
            rows.append(
                {
                    "provider": "vnstock_data",
                    "layer": class_name.lower(),
                    "object": class_name,
                    "method": None,
                    "status": "instantiate_error",
                    "error": str(exc),
                    "lastCheckedAt": cataloged_at,
                }
            )
            continue

        for method_row in _public_methods(instance):
            row = {
                "provider": "vnstock_data",
                "layer": class_name.lower(),
                "object": class_name,
                "sampleSymbol": sample_symbol,
                "lastCheckedAt": cataloged_at,
                **method_row,
            }
            rows.append(row)

        for factory_name in ("equity", "company"):
            factory = getattr(instance, factory_name, None)
            if not callable(factory):
                continue
            try:
                child = factory(sample_symbol)
            except Exception as exc:  # noqa: BLE001
                rows.append(
                    {
                        "provider": "vnstock_data",
                        "layer": class_name.lower(),
                        "object": f"{class_name}.{factory_name}",
                        "method": None,
                        "status": "factory_error",
                        "error": str(exc),
                        "sampleSymbol": sample_symbol,
                        "lastCheckedAt": cataloged_at,
                    }
                )
                continue
            for method_row in _public_methods(child):
                rows.append(
                    {
                        "provider": "vnstock_data",
                        "layer": class_name.lower(),
                        "object": f"{class_name}.{factory_name}",
                        "sampleSymbol": sample_symbol,
                        "lastCheckedAt": cataloged_at,
                        **method_row,
                    }
                )

    return rows


def _write_catalog(rows: list[dict[str, Any]]) -> int:
    from pymongo import MongoClient, UpdateOne

    mongo_url = os.getenv("MONGODB_URL")
    mongo_db = os.getenv("MONGODB_DATABASE", "vnibb-market")
    if not mongo_url:
        raise SystemExit("MONGODB_URL is required with --write-mongo")

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=10000)
    db = client[mongo_db]
    coll = db.vnstock_api_catalog
    coll.create_index([("layer", 1), ("object", 1), ("method", 1)], unique=True)
    coll.create_index([("status", 1), ("lastCheckedAt", -1)])

    ops = []
    for row in rows:
        key = {
            "layer": row.get("layer"),
            "object": row.get("object"),
            "method": row.get("method"),
        }
        ops.append(
            UpdateOne(
                key,
                {"$set": row, "$setOnInsert": {"createdAt": _now()}},
                upsert=True,
            )
        )
    if ops:
        coll.bulk_write(ops, ordered=False)
    return len(ops)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample-symbol", default="VCI")
    parser.add_argument("--write-mongo", action="store_true")
    parser.add_argument("--output", help="Optional JSON output path")
    args = parser.parse_args()

    rows = _catalog_vnstock_data(args.sample_symbol.upper())
    payload = {"count": len(rows), "rows": rows}

    if args.output:
        Path(args.output).write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))

    written = _write_catalog(rows) if args.write_mongo else 0
    if args.write_mongo:
        print(json.dumps({"written": written}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
