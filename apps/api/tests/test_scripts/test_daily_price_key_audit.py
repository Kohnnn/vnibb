import json
import subprocess
import sys
from pathlib import Path
from typing import Final

HERE: Final = Path(__file__).resolve().parent
CLI: Final = HERE.parents[1] / "scripts" / "daily_price_key_audit.py"
MANIFEST: Final = HERE / "fixtures" / "daily_price_manifest.json"
OBSERVATIONS: Final = HERE / "fixtures" / "daily_price_observations.json"


def run_audit(manifest: Path, observations: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-B", str(CLI), str(manifest), str(observations)],
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )


def test_complete_symbol_scope_reconciles_eligible_keys_and_duplicate_rows() -> None:
    result = run_audit(MANIFEST, OBSERVATIONS)

    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["counts"] == {
        "eligible_keys": 4,
        "observed_distinct_eligible_keys": 2,
        "missing_eligible_keys": 1,
        "unscanned_eligible_keys": 1,
        "unknown_status_keys": 1,
        "excluded_keys": 1,
        "unsupported_keys": 1,
        "observed_unknown_status_keys": 1,
        "observed_excluded_keys": 1,
        "observed_unsupported_keys": 0,
        "observation_rows": 7,
        "extra_keys_outside_manifest": 1,
        "duplicate_keys": 2,
        "duplicate_rows": 2,
        "zero_volume_rows": 1,
    }
    assert report["witnesses"] == {
        "missing_eligible_symbols": ["BBB"],
        "unscanned_eligible_symbols": ["DDD"],
        "unknown_status_symbols": ["EEE"],
        "extra_symbols_outside_manifest": ["ZZZ"],
        "duplicate_symbols": ["CCC", "ZZZ"],
    }


def test_partial_scope_does_not_claim_missing_eligible_keys(tmp_path: Path) -> None:
    payload = json.loads(OBSERVATIONS.read_text(encoding="utf-8"))
    payload["scope"]["completeness"] = "partial"
    partial = tmp_path / "partial.json"
    partial.write_text(json.dumps(payload), encoding="utf-8")

    result = run_audit(MANIFEST, partial)

    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["observation_scope"]["completeness"] == "partial"
    assert report["counts"]["observed_distinct_eligible_keys"] == 2
    assert report["counts"]["missing_eligible_keys"] == 0
    assert report["counts"]["unscanned_eligible_keys"] == 2
    assert report["witnesses"]["unscanned_eligible_symbols"] == ["BBB", "DDD"]


def test_rejects_observations_for_another_exchange(tmp_path: Path) -> None:
    payload = json.loads(OBSERVATIONS.read_text(encoding="utf-8"))
    payload["partition"]["exchange"] = "HNX"
    mismatched = tmp_path / "mismatched.json"
    mismatched.write_text(json.dumps(payload), encoding="utf-8")

    result = run_audit(MANIFEST, mismatched)

    assert (result.returncode, result.stdout) == (2, "")


def test_rejects_an_extract_captured_before_session_completion(tmp_path: Path) -> None:
    payload = json.loads(OBSERVATIONS.read_text(encoding="utf-8"))
    payload["evidence"]["as_of"] = "2026-11-10T07:59:59Z"
    early = tmp_path / "early.json"
    early.write_text(json.dumps(payload), encoding="utf-8")

    result = run_audit(MANIFEST, early)

    assert (result.returncode, result.stdout) == (2, "")


def test_rejects_row_limit_instead_of_reporting_a_truncated_extract(tmp_path: Path) -> None:
    payload = json.loads(OBSERVATIONS.read_text(encoding="utf-8"))
    payload["rows"] = [payload["rows"][0]] * 101
    oversized = tmp_path / "oversized.json"
    oversized.write_text(json.dumps(payload), encoding="utf-8")

    result = run_audit(MANIFEST, oversized)

    assert (result.returncode, result.stdout) == (2, "")
