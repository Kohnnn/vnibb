"""The off-box index gate must accept every state the API itself publishes.

`check_index_coherence` re-derives level/base/change/percentage from a deployed
payload, so a status label it does not know becomes a false failure after a
redeploy. These cases pin the labels `_reconcile_index_change_pct` emits and the
field each one is allowed to withhold.
"""

import json
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
SCRIPT = ROOT / "scripts" / "oracle" / "runtime_verify.sh"
FUNCTION = re.compile(r"^check_index_coherence\(\) \{.*?^PY\n\}\n", re.MULTILINE | re.DOTALL)
LEVEL_TOLERANCE = "0.011"
PCT_TOLERANCE = "0.011"


def _row(**fields):
    row = {"index_name": "VNINDEX", "time": "2026-11-03"}
    row.update(fields)
    return row


def _run(tmp_path, rows):
    body = FUNCTION.search(SCRIPT.read_text(encoding="utf-8"))
    assert body, "check_index_coherence() moved; update this test"
    function_file = tmp_path / "coherence.sh"
    function_file.write_text(body.group(0), encoding="utf-8")
    payload = tmp_path / "payload.json"
    payload.write_text(json.dumps({"data": rows}), encoding="utf-8")
    return subprocess.run(
        [
            "bash",
            "-c",
            f'source "{function_file}"; '
            f'check_index_coherence "{payload}" {LEVEL_TOLERANCE} {PCT_TOLERANCE}',
        ],
        capture_output=True,
        text=True,
        env={"PYTHON_BIN": "python3", "PATH": "/usr/bin:/bin"},
    )


@pytest.mark.parametrize(
    ("label", "row"),
    [
        ("an admitted adjacent base", _row(
            current_value=1340.0, change=6.0, change_pct=6.0 / 1334.0 * 100,
            previous_close=1334.0, previous_close_status="observed",
        )),
        # close - change implies 250.55, so the published change anchors the
        # percentage even though no base is published.
        ("a base contradicting the retained change", _row(
            current_value=251.42, change=0.87, change_pct=0.87 / 250.55 * 100,
            previous_close_status="inconsistent_with_retained_change",
        )),
        ("a base from before a session gap", _row(
            current_value=1340.0, previous_close_status="previous_session_not_retained",
        )),
        ("a base from an unconfirmed session", _row(
            current_value=1400.0, previous_close_status="previous_session_unconfirmed",
        )),
        ("a retained percentage contradicting the change", _row(
            current_value=1340.0, change=4.0, previous_close=1336.0,
            previous_close_status="observed",
            change_pct_status="inconsistent_with_retained_change",
        )),
    ],
)
def test_checker_accepts_every_published_withholding_state(tmp_path, label, row):
    result = _run(tmp_path, [row])

    assert result.returncode == 0, f"{label}: {result.stdout}{result.stderr}"


@pytest.mark.parametrize(
    ("label", "row", "expected"),
    [
        ("a withheld percentage still published", _row(
            current_value=1340.0, change=4.0, change_pct=0.9, previous_close=1336.0,
            previous_close_status="observed",
            change_pct_status="inconsistent_with_retained_change",
        ), "still publishes"),
        ("a status the API cannot emit", _row(
            current_value=1340.0, change=4.0, change_pct=0.3, previous_close=1336.0,
            previous_close_status="contradicts_recorded_change",
        ), "unknown previous_close_unavailable_reason"),
        ("an implied base with no percentage", _row(
            current_value=251.42, change=0.87,
            previous_close_status="inconsistent_with_retained_change",
        ), "change_pct withheld although the change anchors it"),
    ],
)
def test_checker_still_fails_a_genuinely_incoherent_row(tmp_path, label, row, expected):
    result = _run(tmp_path, [row])

    assert result.returncode == 1, f"{label}: {result.stdout}{result.stderr}"
    assert expected in result.stdout
