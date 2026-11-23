"""The census report is observational: stored rows never imply admission."""
from datetime import UTC, date, datetime

import pytest

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


@pytest.mark.parametrize(
    ("price_row", "comparison_reasons"),
    [
        (None, []),
        ({}, []),
        ({"time": "2026-10-25", "close": 20000, "source": "vietcap_vnd"}, ["mongo_sql_price_date_mismatch"]),
        ({"time": "2026-10-26", "close": 20000, "source": "vietcap_vnd"}, ["mongo_sql_price_value_mismatch"]),
        ({"time": "2026-10-26", "close": 10000, "source": "vietcap_vnd"}, []),
    ],
    ids=["sql-absent", "sql-empty", "date-mismatch", "value-mismatch", "matching"],
)
@pytest.mark.parametrize(
    ("marker", "value", "invalid"),
    [
        ("raw", {}, True),
        ("sourceUnitEvidence", None, True),
        ("priceUnit", "USD", True),
        (None, None, False),
    ],
    ids=["missing-raw", "missing-unit-evidence", "wrong-unit", "valid-lineage"],
)
def test_census_checks_mongo_eod_lineage_independently_of_sql(price_row, comparison_reasons, marker, value, invalid):
    eod = {"tradeDate": "2026-10-26", "close": 10000, "raw": {"close": 10000}, "sourceUnitEvidence": {"unit": "VND"}, "priceUnit": "VND"}
    if marker is not None:
        eod[marker] = value
    rows = [{"symbol": "AAA", "price_row": price_row, "snapshot_row": None}]
    report = reconcile_census(rows, {"AAA": {"eod": eod}}, {}, [], {"count": 0}, date(2026, 10, 26), datetime(2026, 10, 26, 10, tzinfo=UTC))

    reasons = [reason for reason in report["rows"][0]["reasons"] if reason.startswith(("mongo_eod_", "mongo_sql_price_"))]
    lineage_reason = "mongo_eod_unit_or_raw_lineage_invalid"
    assert reasons == comparison_reasons + ([lineage_reason] if invalid else [])
    assert report["reason_counts"].get(lineage_reason, 0) == int(invalid)


@pytest.mark.parametrize(
    ("eod", "price_row", "expected_reasons"),
    [
        (None, None, ["mongo_eod_missing"]),
        (None, {"time": "2026-10-26", "close": 10000}, ["mongo_eod_missing"]),
        ({}, None, ["mongo_eod_unit_or_raw_lineage_invalid"]),
        ({}, {"time": "2026-10-26", "close": 10000}, ["mongo_sql_price_date_mismatch", "mongo_eod_unit_or_raw_lineage_invalid"]),
    ],
    ids=["absent-no-sql", "absent-with-sql", "present-empty-no-sql", "present-empty-with-sql"],
)
def test_census_distinguishes_absent_and_present_empty_mongo_eod(eod, price_row, expected_reasons):
    rows = [{"symbol": "AAA", "price_row": price_row, "snapshot_row": None}]
    report = reconcile_census(rows, {"AAA": {"eod": eod}}, {}, [], {"count": 0}, date(2026, 10, 26), datetime(2026, 10, 26, 10, tzinfo=UTC))

    assert [reason for reason in report["rows"][0]["reasons"] if reason.startswith(("mongo_eod_", "mongo_sql_price_"))] == expected_reasons


def test_census_reports_a_completed_member_qualified_receipt():
    now = datetime(2026, 10, 26, 10, tzinfo=UTC)
    rows = [{"symbol": symbol, "exchange": "HOSE", "price_row": None, "snapshot_row": None} for symbol in ("AAA", "BBB")]
    receipts = [{"id": 1, "status": "completed", "error_count": 0, "success_count": 2, "completed_at": datetime(2026, 10, 26, 9),
                 "additional_data": {"snapshot_date": "2026-10-26", "expected_symbols": ["AAA", "BBB"], "expected_count": 2}}]
    report = reconcile_census(rows, {}, {}, receipts, {"count": 0, "hit": False}, date(2026, 10, 26), now)

    assert report["receipts"][0]["rejections"] == []
    assert "completion_receipt_missing" not in report["reason_counts"]
    assert "completion_receipt_not_current_member_qualified" not in report["reason_counts"]


def test_receipt_reads_the_deployed_columns_and_rejects_a_missing_receipt_column():
    from scripts.readiness_census import _receipt_query

    class Cursor:
        def __init__(self, columns):
            self.columns, self.rows = columns, []

        def execute(self, query):
            self.rows = [{"status_table": "public.sync_status", "snapshot_table": "screener_snapshots"}] if "to_regclass" in query else [{"column_name": name} for name in self.columns]

        def fetchone(self):
            return self.rows[0]

        def fetchall(self):
            return self.rows

    columns = ["id", "status", "error_count", "success_count", "completed_at", "additional_data"]
    query = _receipt_query(Cursor(columns))
    identifiers = [part for part in query._wrapped if hasattr(part, "strings")]
    assert identifiers[-1].strings == ("public", "sync_status")

    try:
        _receipt_query(Cursor(columns[:-1]))
    except RuntimeError as exc:
        assert "additional_data" in str(exc)
    else:
        raise AssertionError("A missing receipt column must fail capture instead of being skipped")


def test_census_without_retention_stores_still_completes():
    from types import SimpleNamespace

    from scripts.readiness_census import _retained

    settings = SimpleNamespace(mongodb_url=None, mongodb_database="vnibb-market", redis_url="")
    assert _retained(settings, ["AAA"], date(2026, 10, 26), 3000) == ({}, {}, [])
