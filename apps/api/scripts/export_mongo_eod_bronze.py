from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import quote

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from bson import json_util
from bson.json_util import CANONICAL_JSON_OPTIONS

SCHEMA = pa.schema(
    [
        pa.field("document_extjson", pa.string(), nullable=False),
        pa.field("document_id_extjson", pa.string(), nullable=False),
        pa.field("symbol", pa.string(), nullable=True),
        pa.field("source", pa.string(), nullable=False),
        pa.field("trade_date", pa.date32(), nullable=True),
        pa.field("open", pa.float64(), nullable=True),
        pa.field("high", pa.float64(), nullable=True),
        pa.field("low", pa.float64(), nullable=True),
        pa.field("close", pa.float64(), nullable=True),
        pa.field("volume", pa.int64(), nullable=True),
        pa.field("value", pa.float64(), nullable=True),
    ]
)


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    return value if isinstance(value, str) else str(value)


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        number = Decimal(str(value))
    except (ArithmeticError, ValueError):
        return None
    if not number.is_finite() or number != number.to_integral_value():
        return None
    try:
        return int(number)
    except (OverflowError, ValueError):
        return None


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None


def _row(document: dict[str, Any]) -> dict[str, Any]:
    if "_id" not in document:
        raise ValueError("Mongo document is missing _id")
    trade_date = _as_date(document.get("tradeDate"))
    source = _as_text(document.get("source")) or "unknown"
    return {
        "document_extjson": json_util.dumps(document, json_options=CANONICAL_JSON_OPTIONS),
        "document_id_extjson": json_util.dumps(
            document["_id"], json_options=CANONICAL_JSON_OPTIONS
        ),
        "symbol": _as_text(document.get("symbol")),
        "source": source,
        "trade_date": trade_date,
        "open": _as_float(document.get("open")),
        "high": _as_float(document.get("high")),
        "low": _as_float(document.get("low")),
        "close": _as_float(document.get("close")),
        "volume": _as_int(document.get("volume")),
        "value": _as_float(document.get("value")),
    }


def _partition(row: dict[str, Any]) -> tuple[str, str, str]:
    trade_date = row["trade_date"]
    return (
        quote(row["source"], safe=""),
        str(trade_date.year) if trade_date else "unknown",
        f"{trade_date.month:02d}" if trade_date else "unknown",
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temporary, path)


def inventory(collection: Any) -> dict[str, Any]:
    sources: dict[str, int] = {}
    for item in collection.aggregate(
        [
            {"$group": {"_id": {"$ifNull": ["$source", "unknown"]}, "count": {"$sum": 1}}},
            {"$sort": {"_id": 1}},
        ]
    ):
        sources[_as_text(item.get("_id")) or "unknown"] = int(item["count"])
    return {"documents": int(collection.count_documents({})), "sources": sources}


def _relative_path(partition: tuple[str, str, str], sequence: int) -> Path:
    source, year, month = partition
    return Path(f"source={source}") / f"year={year}" / f"month={month}" / f"part-{sequence:09d}.parquet"


def _validate_fragment(path: Path, item: dict[str, Any]) -> None:
    if not path.is_file() or _sha256(path) != item["sha256"]:
        raise ValueError(f"fragment checksum mismatch: {path}")
    if pq.read_schema(path) != SCHEMA:
        raise ValueError(f"schema mismatch: {path}")
    if pq.ParquetFile(path).metadata.num_rows != item["records"]:
        raise ValueError(f"fragment record count mismatch: {path}")


def _write_fragment(
    stage: Path,
    partition: tuple[str, str, str],
    sequence: int,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    relative_path = _relative_path(partition, sequence)
    path = stage / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA), temporary, compression="zstd")
    os.replace(temporary, path)
    item = {"path": relative_path.as_posix(), "records": len(rows), "sha256": _sha256(path)}
    _validate_fragment(path, item)
    return item


def _query_documents(collection: Any, query: dict[str, Any], batch_size: int) -> Iterable[dict[str, Any]]:
    cursor = collection.find(query).sort("_id", 1)
    if hasattr(cursor, "batch_size"):
        cursor = cursor.batch_size(batch_size)
    return cursor


def _discard_uncheckpointed_fragments(stage: Path, files: list[dict[str, Any]]) -> None:
    expected = {item["path"] for item in files}
    for path in stage.rglob("*.parquet"):
        if path.relative_to(stage).as_posix() not in expected:
            path.unlink()
    for path in sorted(stage.rglob("*"), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()


def _resume_checkpoint(stage: Path, run_id: str) -> dict[str, Any]:
    path = stage / "checkpoint.json"
    checkpoint = json.loads(path.read_text(encoding="utf-8"))
    if checkpoint.get("run_id") != run_id or checkpoint.get("status") not in {"extracting", "failed"}:
        raise ValueError(f"staging run cannot be resumed: {stage}")
    files = checkpoint.get("files")
    if not isinstance(files, list):
        raise ValueError(f"staging checkpoint has no files: {path}")
    for item in files:
        _validate_fragment(stage / item["path"], item)
    _discard_uncheckpointed_fragments(stage, files)
    checkpoint["status"] = "extracting"
    return checkpoint


def validate_dataset(dataset: Path, *, require_complete: bool = True) -> dict[str, Any]:
    dataset = dataset.resolve()
    manifest_path = dataset / "manifest.json"
    if require_complete and not (dataset / "COMPLETE").is_file():
        raise ValueError(f"missing COMPLETE marker: {dataset}")
    if not manifest_path.is_file():
        raise ValueError(f"missing manifest: {dataset}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("manifest has no parquet files")
    pyarrow_records = 0
    paths: list[str] = []
    for item in files:
        path = dataset / item["path"]
        _validate_fragment(path, item)
        pyarrow_records += pq.ParquetFile(path).metadata.num_rows
        paths.append(path.as_posix())
    duckdb_records = duckdb.connect(":memory:").execute(
        "SELECT count(*) FROM read_parquet(?)", [paths]
    ).fetchone()[0]
    if pyarrow_records != manifest["records"] or duckdb_records != manifest["records"]:
        raise ValueError("record count mismatch")
    if require_complete:
        complete = json.loads((dataset / "COMPLETE").read_text(encoding="utf-8"))
        if complete.get("manifest_sha256") != _sha256(manifest_path):
            raise ValueError("COMPLETE manifest checksum mismatch")
    return {"records": pyarrow_records, "files": len(files), "schema": str(SCHEMA)}


def export_collection(
    collection: Any,
    output: Path,
    *,
    run_id: str | None = None,
    checkpoint_every: int = 10_000,
) -> Path:
    if checkpoint_every < 1:
        raise ValueError("checkpoint_every must be positive")
    output = output.resolve()
    if run_id is None:
        run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    if not run_id or Path(run_id).name != run_id:
        raise ValueError("run_id must be a single path component")
    output.mkdir(parents=True, exist_ok=True)
    runs = output / "runs"
    staging_root = output / ".staging"
    runs.mkdir(exist_ok=True)
    staging_root.mkdir(exist_ok=True)
    if os.stat(runs).st_dev != os.stat(staging_root).st_dev:
        raise ValueError("runs and staging must be on the same volume")
    final = runs / run_id
    stage = staging_root / run_id
    if final.exists():
        raise FileExistsError(f"published run already exists: {final}")
    if stage.exists():
        checkpoint = _resume_checkpoint(stage, run_id)
    else:
        stage.mkdir()
        checkpoint = {
            "run_id": run_id,
            "status": "extracting",
            "started_at": _utc_now(),
            "inventory": inventory(collection),
            "records": 0,
            "files": [],
            "next_sequence": 1,
        }
        _write_json(stage / "checkpoint.json", checkpoint)
    try:
        last_id_extjson = checkpoint.get("last_id_extjson")
        query: dict[str, Any] = {}
        if last_id_extjson:
            query = {"_id": {"$gt": json_util.loads(last_id_extjson)}}
        batch: list[dict[str, Any]] = []
        for document in _query_documents(collection, query, checkpoint_every):
            batch.append(_row(document))
            if len(batch) == checkpoint_every:
                _flush_batch(stage, checkpoint, batch)
                batch = []
        if batch:
            _flush_batch(stage, checkpoint, batch)
        end_inventory = inventory(collection)
        if end_inventory != checkpoint["inventory"]:
            raise RuntimeError("Mongo inventory drift detected during export")
        manifest = {
            "format": "vnibb-n6v-bronze-eod-v2",
            "created_at": _utc_now(),
            "inventory": checkpoint["inventory"],
            "records": checkpoint["records"],
            "schema": str(SCHEMA),
            "files": checkpoint["files"],
        }
        _write_json(stage / "manifest.json", manifest)
        validation = validate_dataset(stage, require_complete=False)
        checkpoint.update({"status": "validated", "completed_at": _utc_now(), "validation": validation})
        _write_json(stage / "checkpoint.json", checkpoint)
        _write_json(stage / "COMPLETE", {"manifest_sha256": _sha256(stage / "manifest.json")})
        os.replace(stage, final)
        return final
    except Exception:
        checkpoint["status"] = "failed"
        _write_json(stage / "checkpoint.json", checkpoint)
        raise


def _flush_batch(stage: Path, checkpoint: dict[str, Any], batch: list[dict[str, Any]]) -> None:
    partitions: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in batch:
        partitions.setdefault(_partition(row), []).append(row)
    for partition, rows in sorted(partitions.items()):
        item = _write_fragment(stage, partition, checkpoint["next_sequence"], rows)
        checkpoint["files"].append(item)
        checkpoint["next_sequence"] += 1
    checkpoint["records"] += len(batch)
    checkpoint["last_id_extjson"] = batch[-1]["document_id_extjson"]
    _write_json(stage / "checkpoint.json", checkpoint)


def _collection(mongo_url: str, database: str, collection_name: str) -> Any:
    from pymongo import MongoClient
    from pymongo.read_preferences import ReadPreference

    client = MongoClient(mongo_url, read_preference=ReadPreference.SECONDARY_PREFERRED)
    return client[database][collection_name]


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only n6v Bronze EOD Parquet export")
    parser.add_argument("--mongo-url", default=os.getenv("MONGODB_URL"))
    parser.add_argument("--mongo-database", default=os.getenv("MONGODB_DATABASE", "vnibb-market"))
    parser.add_argument("--collection", default="market_prices_eod")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("inventory")
    export_parser = commands.add_parser("export")
    export_parser.add_argument("--output", required=True, type=Path)
    export_parser.add_argument("--run-id")
    export_parser.add_argument("--checkpoint-every", type=int, default=10_000)
    validate_parser = commands.add_parser("validate")
    validate_parser.add_argument("--dataset", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "validate":
        print(json.dumps(validate_dataset(args.dataset), indent=2, sort_keys=True))
        return 0
    if not args.mongo_url:
        raise SystemExit("MONGODB_URL or --mongo-url is required")
    collection = _collection(args.mongo_url, args.mongo_database, args.collection)
    if args.command == "inventory":
        print(json.dumps(inventory(collection), indent=2, sort_keys=True))
        return 0
    published = export_collection(
        collection,
        args.output,
        run_id=args.run_id,
        checkpoint_every=args.checkpoint_every,
    )
    print(json.dumps({"published": str(published), "validation": validate_dataset(published)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
