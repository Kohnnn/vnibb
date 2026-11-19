import json
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

HERE: Final = Path(__file__).resolve().parent
CLI: Final = HERE.parents[1] / "scripts" / "daily_price_key_audit.py"
MANIFEST: Final = HERE / "fixtures" / "daily_price_manifest.json"
OBSERVATIONS: Final = HERE / "fixtures" / "daily_price_observations.json"


def run_cli(
    args: tuple[str, ...], *, without_iana: bool = False
) -> subprocess.CompletedProcess[str]:
    # An empty PYTHONTZPATH hides system data; -S hides the fallback tzdata package.
    flags = ["-I", "-B", "-S"] if without_iana else ["-I", "-B"]
    return subprocess.run(
        [sys.executable, *flags, str(CLI), *args],
        env={"PYTHONTZPATH": ""} if without_iana else None,
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )


def run_audit(manifest: Path, observations: Path) -> subprocess.CompletedProcess[str]:
    return run_cli((str(manifest), str(observations)))


@pytest.mark.parametrize("flag", ["-h", "--help"])
def test_help_works_without_iana_data(flag: str) -> None:
    result = run_cli((flag,), without_iana=True)

    assert (result.returncode, result.stderr) == (0, "")
    assert "MANIFEST.json" in result.stdout
    assert "OBSERVATIONS.json" in result.stdout


def test_audit_reports_missing_iana_prerequisite_without_a_report() -> None:
    result = run_cli((str(MANIFEST), str(OBSERVATIONS)), without_iana=True)

    assert (result.returncode, result.stdout) == (2, ""), result.stderr
    assert "Traceback" not in result.stderr
    assert "Asia/Ho_Chi_Minh" in result.stderr
    assert "tzdata" in result.stderr
    assert "install" in result.stderr.lower()


@pytest.mark.parametrize(
    ("completed_at", "session_date"),
    [("1975-06-11T16:30:00Z", "1975-06-12"), ("1975-06-13T16:30:00Z", "1975-06-13")],
    ids=["utc-plus-eight", "utc-plus-seven"],
)
def test_session_date_uses_historical_iana_rules(
    completed_at: str, session_date: str, tmp_path: Path
) -> None:
    # At 16:30 UTC, the local date changes only under the pre-transition UTC+08 rule.
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    observations = json.loads(OBSERVATIONS.read_text(encoding="utf-8"))
    for evidence in (manifest, observations):
        evidence["partition"]["session_date"] = session_date
        evidence["evidence"].update(effective_through=completed_at, captured_at=completed_at)
    manifest["calendar"]["completed_at"] = completed_at
    for row in observations["rows"]:
        row["time"] = session_date
    manifest_path, observations_path = tmp_path / MANIFEST.name, tmp_path / OBSERVATIONS.name
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    observations_path.write_text(json.dumps(observations), encoding="utf-8")

    result = run_audit(manifest_path, observations_path)

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["partition"]["session_date"] == session_date


def test_complete_symbol_scope_reconciles_eligible_keys_and_duplicate_rows() -> None:
    result = run_audit(MANIFEST, OBSERVATIONS)

    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert (
        report["manifest_evidence"]["captured_at"] != report["observation_evidence"]["captured_at"]
    )
    assert (
        report["manifest_evidence"]["effective_through"]
        == report["observation_evidence"]["effective_through"]
    )
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


def test_rejects_eligibility_correction_after_price_snapshot(tmp_path: Path) -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    bbb = next(member for member in manifest["members"] if member["symbol"] == "BBB")
    bbb.update(status="unknown", reason="Eligibility decision pending")
    original = tmp_path / "original.json"
    original.write_text(json.dumps(manifest), encoding="utf-8")
    baseline = run_audit(original, OBSERVATIONS)
    assert baseline.returncode == 0, baseline.stderr
    assert json.loads(baseline.stdout)["counts"]["missing_eligible_keys"] == 0

    manifest["evidence"].update(
        revision="2", effective_through="2026-11-13T09:00:00Z", captured_at="2026-11-14T09:00:00Z"
    )
    bbb.update(status="eligible", reason="First classified by the November 13 correction")
    corrected = tmp_path / "corrected.json"
    corrected.write_text(json.dumps(manifest), encoding="utf-8")

    result = run_audit(corrected, OBSERVATIONS)

    assert result.returncode == 2, result.stdout
    assert result.stdout == ""


@pytest.mark.parametrize("side", ["membership", "prices"])
def test_rejects_unknown_effective_cutoff(side: str, tmp_path: Path) -> None:
    manifest, prices = MANIFEST, OBSERVATIONS
    source = manifest if side == "membership" else prices
    payload = json.loads(source.read_text(encoding="utf-8"))
    del payload["evidence"]["effective_through"]
    changed = tmp_path / source.name
    changed.write_text(json.dumps(payload), encoding="utf-8")
    result = run_audit(changed, prices) if side == "membership" else run_audit(manifest, changed)
    assert (result.returncode, result.stdout) == (2, "")


@pytest.mark.parametrize("offset", [".000000900Z", "-00:00"])
def test_rejects_unrepresentable_or_unknown_cutoff(offset: str, tmp_path: Path) -> None:
    payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
    payload["evidence"]["effective_through"] = "2026-11-10T09:00:00" + offset
    changed = tmp_path / MANIFEST.name
    changed.write_text(json.dumps(payload), encoding="utf-8")
    result = run_audit(changed, OBSERVATIONS)
    assert (result.returncode, result.stdout) == (2, "")


def test_compares_equivalent_cutoffs_across_offsets(tmp_path: Path) -> None:
    payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
    payload["evidence"]["effective_through"] = "2026-11-10T16:00:00+07:00"
    changed = tmp_path / MANIFEST.name
    changed.write_text(json.dumps(payload), encoding="utf-8")
    result = run_audit(changed, OBSERVATIONS)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["witnesses"]["missing_eligible_symbols"] == ["BBB"]


def test_rejects_a_shared_cutoff_before_session_completion(tmp_path: Path) -> None:
    for source in (MANIFEST, OBSERVATIONS):
        payload = json.loads(source.read_text(encoding="utf-8"))
        payload["evidence"]["effective_through"] = "2026-11-10T07:59:59Z"
        (tmp_path / source.name).write_text(json.dumps(payload), encoding="utf-8")
    result = run_audit(tmp_path / MANIFEST.name, tmp_path / OBSERVATIONS.name)
    assert (result.returncode, result.stdout) == (2, "")


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
    payload["evidence"]["captured_at"] = "2026-11-10T07:59:59Z"
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
