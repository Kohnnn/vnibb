"""The off-box drill's own gate: does it accept only a byte-exact paired set?

The 2026-11-08 drill restored from a producer set whose manifest stores
artifacts as a dict. That branch skips the public-table expectation, so the
size/SHA checks are the only thing standing between a truncated copy and
"RECOVERY OK". These tests drive `load_set` over that exact manifest shape.
"""

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "oracle" / "restore-offbox.py"
STAMP = "20261108T033001Z"


def _load_module():
    spec = importlib.util.spec_from_file_location("restore_offbox", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def drill():
    return _load_module()


def _write_set(root: Path, *, pg_bytes: bytes = b"pg-dump", mongo_bytes: bytes = b"mongo-archive"):
    artifacts = {
        f"postgres-{STAMP}.dump": pg_bytes,
        f"mongo-vnibb-market-{STAMP}.archive.gz": mongo_bytes,
    }
    for name, payload in artifacts.items():
        (root / name).write_bytes(payload)
    manifest = {
        "stamp": STAMP,
        "postgres": {"database": "vnibb", "tables": 90},
        "mongo": {"database": "vnibb-market", "included": True},
        "artifacts": {
            name: {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
            for name, payload in artifacts.items()
        },
    }
    (root / "manifest.json").write_text(json.dumps(manifest))
    return manifest


def test_accepts_a_byte_exact_paired_set(drill, tmp_path):
    _write_set(tmp_path)
    stamp, selected, pg_tables, mongo_collections = drill.load_set(tmp_path, STAMP)
    assert stamp == STAMP
    assert set(selected) == {"postgres", "mongo"}
    # dict-shape producer manifest carries a TOC count, not a public-table count
    assert pg_tables is None
    assert mongo_collections is None


def test_rejects_a_size_mismatch(drill, tmp_path):
    _write_set(tmp_path)
    (tmp_path / f"postgres-{STAMP}.dump").write_bytes(b"truncated")
    with pytest.raises(Exception, match="size mismatch"):
        drill.load_set(tmp_path, STAMP)


def test_rejects_a_digest_mismatch(drill, tmp_path):
    # Same byte length, different content: only SHA-256 can catch this, so the
    # case cannot pass on the size check.
    _write_set(tmp_path)
    (tmp_path / f"mongo-vnibb-market-{STAMP}.archive.gz").write_bytes(b"mongo-archivE")
    with pytest.raises(Exception, match="SHA256 mismatch"):
        drill.load_set(tmp_path, STAMP)


def test_rejects_a_postgres_only_set(drill, tmp_path):
    _write_set(tmp_path)
    (tmp_path / f"mongo-vnibb-market-{STAMP}.archive.gz").unlink()
    with pytest.raises(Exception, match="missing or linked artifact"):
        drill.load_set(tmp_path, STAMP)


def test_rejects_a_stamp_that_differs_from_the_request(drill, tmp_path):
    _write_set(tmp_path)
    with pytest.raises(Exception, match="requested stamp differs"):
        drill.load_set(tmp_path, "20250101T000000Z")
