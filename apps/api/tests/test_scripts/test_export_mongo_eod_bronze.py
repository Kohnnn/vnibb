from __future__ import annotations

import importlib.util
import json
from datetime import datetime
from pathlib import Path

import pytest
from bson import ObjectId

MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "export_mongo_eod_bronze.py"
SPEC = importlib.util.spec_from_file_location("export_mongo_eod_bronze", MODULE_PATH)
assert SPEC and SPEC.loader
bronze = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bronze)


class FakeCursor:
    def __init__(self, documents, fail_after=None):
        self.documents = documents
        self.fail_after = fail_after

    def sort(self, field, direction):
        assert (field, direction) == ("_id", 1)
        self.documents = sorted(self.documents, key=lambda document: document["_id"])
        return self

    def batch_size(self, size):
        assert size > 0
        return self

    def __iter__(self):
        for index, document in enumerate(self.documents):
            if self.fail_after is not None and index == self.fail_after:
                raise RuntimeError("simulated extraction interruption")
            yield document


class FakeCollection:
    def __init__(self, documents, inventories=None, fail_after=None):
        self.documents = documents
        self.inventories = inventories or []
        self.fail_after = fail_after
        self.inventory_calls = 0

    def find(self, query):
        if query == {}:
            documents = self.documents
        else:
            last_id = query["_id"]["$gt"]
            documents = [document for document in self.documents if document["_id"] > last_id]
        fail_after = self.fail_after if query == {} else None
        return FakeCursor(documents, fail_after)

    def count_documents(self, query):
        assert query == {}
        return len(self.documents)

    def aggregate(self, pipeline):
        self.inventory_calls += 1
        if self.inventories:
            return self.inventories.pop(0)
        counts = {}
        for document in self.documents:
            source = document.get("source") or "unknown"
            counts[source] = counts.get(source, 0) + 1
        return [{"_id": source, "count": count} for source, count in sorted(counts.items())]


def _documents(count):
    return [
        {
            "_id": ObjectId(f"64b64c6f7b6f4b2d6e8a{index:04x}"),
            "symbol": "VCI",
            "source": "vietcap" if index % 2 else "kbs",
            "tradeDate": datetime(2026, 6 + (index % 2), 5, 7),
            "close": 25000 + index,
        }
        for index in range(count)
    ]


def _rows(published):
    files = list(published.glob("source=*/year=*/month=*/part-*.parquet"))
    return files, [row for path in files for row in bronze.pq.ParquetFile(path).read().to_pylist()]


def test_export_preserves_duplicate_and_malformed_documents(tmp_path):
    duplicate_id = ObjectId("64b64c6f7b6f4b2d6e8a1111")
    documents = [
        {
            "_id": duplicate_id,
            "symbol": "VCI",
            "source": "vietcap",
            "tradeDate": datetime(2026, 6, 5, 7),
            "open": "25000",
            "close": 25500,
            "volume": "100",
        },
        {
            "_id": ObjectId("64b64c6f7b6f4b2d6e8a2222"),
            "symbol": "VCI",
            "source": "vietcap",
            "tradeDate": datetime(2026, 6, 5, 7),
            "close": "bad",
            "volume": "not-an-int",
            "nested": {"kept": True},
        },
        {
            "_id": ObjectId("64b64c6f7b6f4b2d6e8a3333"),
            "source": "odd source/value",
            "tradeDate": "not-a-date",
            "close": float("nan"),
        },
    ]
    published = bronze.export_collection(
        FakeCollection(documents), tmp_path, run_id="pilot", checkpoint_every=1
    )

    assert (published / "COMPLETE").is_file()
    manifest = json.loads((published / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["records"] == 3
    assert bronze.validate_dataset(published)["records"] == 3
    files, rows = _rows(published)
    assert len(files) == 3
    assert len(rows) == 3
    assert sum(row["symbol"] == "VCI" for row in rows) == 2
    malformed = next(row for row in rows if row["symbol"] is None)
    assert malformed["trade_date"] is None
    assert malformed["close"] is None
    assert any('"$oid": "64b64c6f7b6f4b2d6e8a1111"' in row["document_extjson"] for row in rows)
    assert any('"nested": {"kept": true}' in row["document_extjson"] for row in rows)


def test_export_streams_bounded_fragments(tmp_path):
    documents = _documents(7)
    published = bronze.export_collection(
        FakeCollection(documents), tmp_path, run_id="bounded", checkpoint_every=2
    )
    manifest = json.loads((published / "manifest.json").read_text(encoding="utf-8"))
    files, rows = _rows(published)

    assert len(files) == len(manifest["files"])
    assert len(files) >= 4
    assert all(item["records"] <= 2 for item in manifest["files"])
    assert len(rows) == len(documents)
    assert bronze.validate_dataset(published)["files"] == len(files)


def test_export_resumes_from_validated_checkpoint_without_duplicates(tmp_path):
    documents = _documents(6)
    with pytest.raises(RuntimeError, match="interruption"):
        bronze.export_collection(
            FakeCollection(documents, fail_after=3),
            tmp_path,
            run_id="resume",
            checkpoint_every=2,
        )

    published = bronze.export_collection(
        FakeCollection(documents), tmp_path, run_id="resume", checkpoint_every=2
    )
    _, rows = _rows(published)
    ids = [row["document_id_extjson"] for row in rows]

    assert len(rows) == len(documents)
    assert len(ids) == len(set(ids))
    assert bronze.validate_dataset(published)["records"] == len(documents)


def test_export_fails_before_publish_on_inventory_drift(tmp_path):
    documents = [{"_id": ObjectId(), "source": "vietcap", "tradeDate": datetime(2026, 6, 5)}]
    inventories = [
        [{"_id": "vietcap", "count": 1}],
        [{"_id": "vietcap", "count": 2}],
    ]
    with pytest.raises(RuntimeError, match="inventory drift"):
        bronze.export_collection(FakeCollection(documents, inventories), tmp_path, run_id="drift")
    assert not (tmp_path / "runs" / "drift").exists()
    checkpoint = tmp_path / ".staging" / "drift" / "checkpoint.json"
    assert json.loads(checkpoint.read_text(encoding="utf-8"))["status"] == "failed"


def test_validate_rejects_tampered_parquet(tmp_path):
    published = bronze.export_collection(
        FakeCollection([{"_id": ObjectId(), "source": "vietcap", "tradeDate": datetime(2026, 6, 5)}]),
        tmp_path,
        run_id="tampered",
    )
    parquet = next(published.glob("source=*/year=*/month=*/part-*.parquet"))
    parquet.write_bytes(b"not parquet")
    with pytest.raises(ValueError, match="checksum mismatch"):
        bronze.validate_dataset(published)
