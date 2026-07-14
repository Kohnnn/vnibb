"""Unit tests for the Vietcap-corpus freshness guard (2026-07-08).

Covers _vietcap_freshness_warning, the pure staleness classifier that makes a
silent primary-source freeze loud in the daily data-quality check.
"""

from argparse import Namespace
from datetime import date

import pytest

from scripts import data_quality_check
from vnibb.services.data_quality import _vietcap_freshness_warning


def test_none_latest_flags_empty_corpus():
    assert _vietcap_freshness_warning(None, 5) == "vietcap_eod corpus empty or unreadable"


def test_fresh_within_threshold_returns_none():
    today = date(2026, 7, 8)
    assert _vietcap_freshness_warning(date(2026, 7, 5), 5, today=today) is None


def test_exactly_at_threshold_returns_none():
    today = date(2026, 7, 8)
    assert _vietcap_freshness_warning(date(2026, 7, 3), 5, today=today) is None


def test_stale_beyond_threshold_warns():
    today = date(2026, 7, 8)
    warning = _vietcap_freshness_warning(date(2026, 6, 12), 5, today=today)
    assert warning is not None
    assert "2026-06-12" in warning
    assert "exceeded 5 days" in warning


def test_cli_accepts_vietcap_calendar_day_threshold(monkeypatch):
    monkeypatch.setattr(
        "sys.argv", ["data_quality_check.py", "--vietcap-max-stale-days", "3"]
    )

    args = data_quality_check.parse_args()

    assert args.vietcap_max_stale_days == 3


@pytest.mark.asyncio
async def test_cli_passes_vietcap_calendar_day_threshold(monkeypatch, tmp_path):
    captured = {}

    async def fake_run_data_quality_check(**kwargs):
        captured.update(kwargs)
        return {
            "generated_at": "2026-07-08T00:00:00",
            "status": "ok",
            "metrics": {},
            "targets": {},
            "warnings": [],
        }

    monkeypatch.setattr(
        data_quality_check,
        "parse_args",
        lambda: Namespace(
            top_limit=200,
            max_stale_days=7,
            vietcap_max_stale_days=3,
            output_json=str(tmp_path / "report.json"),
        ),
    )
    monkeypatch.setattr(data_quality_check, "run_data_quality_check", fake_run_data_quality_check)

    assert await data_quality_check._main() == 0
    assert captured["vietcap_max_stale_days"] == 3
