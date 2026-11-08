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
from vnibb.api.v1.market import _reconcile_index_change_pct

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
    "reason", ["previous_session_not_retained", "previous_session_unconfirmed"]
)
def test_checker_accepts_api_percentage_with_withheld_previous_close(tmp_path, reason):
    row = _reconcile_index_change_pct(_row(
        current_value=1250.0, change=10.0, previous_close_status=reason,
    ))

    assert "previous_close" not in row
    assert row["previous_close_status"] == reason
    assert row["change_pct"] == pytest.approx(10.0 / 1240.0 * 100)
    result = _run(tmp_path, [row])
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize(
    "reason", ["inconsistent_with_retained_change", "previous_session_not_retained",
               "previous_session_unconfirmed"]
)
def test_checker_accepts_api_withholding_both_base_and_percentage(tmp_path, reason):
    fields = {"previous_close": 259.86} if reason == "inconsistent_with_retained_change" else {
        "previous_close_status": reason,
    }
    row = _reconcile_index_change_pct(_row(
        current_value=252.74, change=-3.87, change_pct=42.0, **fields,
    ))

    assert "previous_close" not in row
    assert row["previous_close_status"] == reason
    assert row["change_pct"] is None
    assert row["change_pct_status"] == "inconsistent_with_retained_change"
    result = _run(tmp_path, [row])
    assert result.returncode == 0, result.stdout + result.stderr


def test_checker_rejects_an_incorrect_api_derived_percentage(tmp_path):
    row = _reconcile_index_change_pct(_row(
        current_value=1250.0, change=10.0,
        previous_close_status="previous_session_not_retained",
    ))
    row["change_pct"] += 1.0

    result = _run(tmp_path, [row])
    assert result.returncode == 1, result.stdout + result.stderr
    assert "change_pct" in result.stdout


@pytest.mark.parametrize(
    ("label", "row", "expected"),
    [
        ("a withheld percentage still published", _row(
            current_value=1340.0, change=4.0, change_pct=0.9, previous_close=1336.0,
            previous_close_status="observed",
            change_pct_status="inconsistent_with_retained_change",
        ), "withheld change_pct"),
        ("a status the API cannot emit", _row(
            current_value=1340.0, change=4.0, change_pct=0.3, previous_close=1336.0,
            previous_close_status="contradicts_recorded_change",
        ), "unknown previous_close_unavailable_reason"),
        ("a percentage status on a row with no base", _row(
            current_value=251.42, change=0.87, change_pct=0.87 / 250.55 * 100,
            previous_close_status="inconsistent_with_retained_change",
            change_pct_status="observed",
        ), "unknown change_pct_status"),
    ],
)
def test_checker_still_fails_a_genuinely_incoherent_row(tmp_path, label, row, expected):
    result = _run(tmp_path, [row])

    assert result.returncode == 1, f"{label}: {result.stdout}{result.stderr}"
    assert expected in result.stdout


@pytest.mark.parametrize(
    ("label", "row"),
    [
        # The API anchors the percentage on close - change whenever no base is
        # admitted, whatever withhold reason the base carries (#206).
        ("no base across a session gap", _row(
            current_value=1250.0, change=0.0, change_pct=0.0,
            previous_close_status="previous_session_not_retained",
        )),
        ("no base from an unconfirmed session", _row(
            current_value=1250.0, change=10.0, change_pct=0.8,
            previous_close_status="previous_session_unconfirmed",
        )),
        # Only an admitted base anchors the percentage; that base then admits it.
        ("zero change against a retained base", _row(
            current_value=1250.0, change=0.0, change_pct=0.0, previous_close=1250.0,
            previous_close_status="observed",
        )),
        # A withheld base does not suppress a withheld percentage.
        ("no base and a withheld percentage", _row(
            current_value=791.5, change=-0.51,
            previous_close_status="previous_session_not_retained",
            change_pct_status="inconsistent_with_retained_change",
        )),
    ],
)
def test_checker_accepts_other_api_published_states(tmp_path, label, row):
    result = _run(tmp_path, [row])

    assert result.returncode == 0, f"{label}: {result.stdout}{result.stderr}"


@pytest.mark.parametrize(
    ("label", "row", "expected"),
    [
        ("a percentage the change cannot anchor", _row(
            current_value=1250.0, change=10.0, change_pct=0.9,
            previous_close_status="previous_session_not_retained",
        ), "change_pct 0.9 !="),
        ("a withheld percentage with no stated reason", _row(
            current_value=1250.0, change=10.0, previous_close=1240.0,
            previous_close_status="observed",
        ), "change_pct missing although"),
        ("a percentage with nothing to anchor it", _row(
            current_value=1250.0, change_pct=0.8,
            previous_close_status="previous_session_not_retained",
        ), "no change to anchor"),
        ("a base from a session nobody observed", _row(
            current_value=1250.0, change=10.0, change_pct=0.8, previous_close=1240.0,
            previous_close_status="previous_session_not_retained",
        ), "still publishes previous_close=1240.0"),
        ("a percentage withheld with nothing to anchor it", _row(
            current_value=1250.0, change_pct=0.9,
            previous_close_status="previous_session_unconfirmed",
            change_pct_status="inconsistent_with_retained_change",
        ), "no change to anchor"),
        ("a percentage status the API cannot emit", _row(
            current_value=1250.0, change=10.0,
            previous_close_status="previous_session_not_retained",
            change_pct_status="observed",
        ), "unknown change_pct_status"),
    ],
)
def test_checker_still_fails_incoherent_status_combinations(tmp_path, label, row, expected):
    result = _run(tmp_path, [row])

    assert result.returncode == 1, f"{label}: {result.stdout}{result.stderr}"
    assert expected in result.stdout

