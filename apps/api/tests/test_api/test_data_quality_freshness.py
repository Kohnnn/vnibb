"""Unit tests for the Vietcap-corpus freshness guard (2026-07-08).

Covers _vietcap_freshness_warning, the pure staleness classifier that makes a
silent primary-source freeze loud in the daily data-quality check.
"""

from datetime import date

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
