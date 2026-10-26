"""The census report is observational: stored rows never imply admission."""
from datetime import UTC, date, datetime

from scripts.readiness_census import reconcile_census


def test_census_keeps_durable_null_prices_separate_from_admission():
    session = date(2026, 10, 26)
    rows = [
        {"symbol": "AAA", "exchange": "HOSE", "price_row": {"time": "2026-10-23", "close": 10000, "source": "vietcap_vnd"},
         "snapshot_row": {"symbol": "AAA", "snapshot_date": "2026-10-26", "trade_date": "2026-10-23", "price": 10000, "volume": 0, "extended_metrics": {"price_unit": "VND", "price_source": "vietcap_vnd"}}},
        {"symbol": "BBB", "exchange": "HNX", "price_row": None,
         "snapshot_row": {"symbol": "BBB", "snapshot_date": "2026-10-26", "trade_date": None, "price": None, "volume": 0, "extended_metrics": {}}},
    ]
    raw = {symbol: {"board_count": 0, "board": None, "eod": None} for symbol in ("AAA", "BBB")}
    report = reconcile_census(rows, raw, {}, [], {"count": 0, "hit": False}, session, datetime(2026, 10, 26, 10, tzinfo=UTC))

    assert report["active_count"] == 2
    assert report["durable"]["symbols_with_snapshot"] == 2
    assert report["durable"]["null_actual_snapshot_prices"] == 1
    assert report["admitted"]["count"] == 0
    assert report["rows"][0]["reasons"] == ["mongo_received_envelope_missing", "mongo_board_missing", "sql_session_missing", "mongo_eod_missing", "sql_price_stale:2026-10-23", "sql_snapshot_actual_trade_date_stale:2026-10-23", "completion_receipt_missing", "redis_screener_missing", "redis_price_missing", "not_in_admitted_universe"]
    assert "sql_price_missing" in report["rows"][1]["reasons"]
    assert "sql_snapshot_actual_price_null" in report["rows"][1]["reasons"]
    assert rows[1]["snapshot_row"]["price"] is None


def test_census_rejects_duplicate_raw_identity_and_reports_cache_mismatch():
    rows = [{"symbol": "AAA", "exchange": "HOSE", "price_row": None, "snapshot_row": {"symbol": "AAA", "snapshot_date": "2026-10-26", "trade_date": None, "price": None, "extended_metrics": {}}}]
    raw = {"AAA": {"board_count": 2, "board": None, "eod": None}}
    cache = {"AAA": {"screener": {"symbol": "WRONG"}, "price": None}}
    report = reconcile_census(rows, raw, cache, [], {"count": 0, "hit": False}, date(2026, 10, 26), datetime(2026, 10, 26, 10, tzinfo=UTC))

    assert "mongo_board_duplicate:2" in report["rows"][0]["reasons"]
    assert "redis_screener_symbol_mismatch" in report["rows"][0]["reasons"]
    assert report["reason_counts"]["mongo_board_duplicate:2"] == 1


def test_census_ignores_float_roundoff_but_reports_real_cache_difference():
    rows = [{"symbol": "KHX", "exchange": "HNX", "price_row": None, "snapshot_row": {"symbol": "KHX", "snapshot_date": "2026-10-26", "trade_date": "2026-10-23", "price": 16100, "volume": 1, "extended_metrics": {"price_unit": "VND", "price_source": "vietcap_vnd"}}}]
    cache = {"KHX": {"screener": {"symbol": "KHX", "snapshot_date": "2026-10-26", "trade_date": "2026-10-23", "price": 16100.000000000002, "volume": 2}}}
    report = reconcile_census(rows, {}, cache, [], {"count": 0, "hit": False}, date(2026, 10, 26), datetime(2026, 10, 26, 10, tzinfo=UTC))

    assert "redis_screener_price_mismatch" not in report["rows"][0]["reasons"]
    assert "redis_screener_volume_mismatch" in report["rows"][0]["reasons"]
