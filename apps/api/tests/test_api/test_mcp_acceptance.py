"""Behavioral regressions for issue111's external-harness blind spots."""
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

SPEC = importlib.util.spec_from_file_location(
    "mcp_acceptance", Path(__file__).resolve().parents[4] / "scripts/oracle/mcp_acceptance.py"
)
qa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qa)
ARGS = {"symbol": "MSR", "start_date": "2026-10-01", "end_date": "2026-10-12", "limit": 100}


def price_packet():
    return {
        "symbol": "MSR", "row_count": 1, "price_unit": "VND", "price_units": ["VND"],
        "unknown_price_unit_count": 0, "prices_comparable": True,
        "items": [{"symbol": "MSR", "time": "2026-10-12T00:00:00Z", "price_unit": "VND",
                   "source": "VCI", "open": 100, "high": 110, "low": 90, "close": 105}],
    }


def test_contradictory_unknown_unit_metadata_rejected():
    packet = price_packet()
    packet["items"][0]["price_unit"] = "unknown"
    with pytest.raises(qa.Failure, match="unit"):
        qa.prices(packet, ARGS)


def test_nonfinite_price_rejected():
    packet = price_packet()
    packet["items"][0]["close"] = float("inf")
    with pytest.raises((qa.Failure, ValueError)):
        qa.prices(packet, ARGS)


def test_missing_ohlc_rejected():
    packet = price_packet()
    del packet["items"][0]["open"]
    with pytest.raises(qa.Failure, match="OHLC"):
        qa.prices(packet, ARGS)


def test_out_of_window_timestamp_rejected():
    packet = price_packet()
    packet["items"][0]["time"] = "2020-01-01T00:00:00Z"
    with pytest.raises(qa.Failure, match="outside"):
        qa.prices(packet, ARGS)


def test_unordered_timestamp_rejected():
    packet = price_packet()
    packet["items"].append({**packet["items"][0], "time": "2026-10-01T00:00:00Z"})
    packet["row_count"] = 2
    with pytest.raises(qa.Failure, match="unordered"):
        qa.prices(packet, ARGS)


def test_untyped_financial_found_rejected():
    packet = {"symbol": "MSR", "period_type": "year", "found": "true", "item": {"value": 1}}
    with pytest.raises(qa.Failure, match="typed"):
        qa.financial(packet, {"symbol": "MSR", "period_type": "year", "statement": "income_statement"})


def test_wrong_statement_identity_rejected():
    packet = {"symbol": "MSR", "period_type": "year", "found": True, "item": {}, "statement": "balance_sheet", "collection": "balance_sheets"}
    with pytest.raises(qa.Failure, match="statement identity"):
        qa.financial(packet, {"symbol": "MSR", "period_type": "year", "statement": "income_statement"})


def test_missing_ratio_envelope_rejected():
    with pytest.raises(qa.Failure):
        qa.financial({"unrelated": {"roe": 20}}, {"symbol": "MSR", "period_type": "year"})


def test_unknown_financial_units_are_partial():
    item = {"raw": {"value": 1}, "descriptors": ["value"], "sourceDate": "2026-01-01", "comTypeCode": "CT",
            "fiscalBasis": {"year": 2025, "periodType": "year", "consolidation": "consolidated"}, "units": {"value": "unknown"}}
    with pytest.raises(qa.Partial, match="units unknown"):
        qa.unit_basis(item, "year")


def test_empty_mongo_status_rejected():
    with pytest.raises(qa.Failure, match="shape"):
        qa.mongo_status({})


def test_null_news_rows_rejected():
    with pytest.raises(qa.Failure, match="objects"):
        qa.objects({"symbol": "MSR", "row_count": 1, "items": [None]}, symbol="MSR")


def test_wrong_premium_dataset_rejected():
    with pytest.raises(qa.Failure, match="dataset"):
        qa.objects({"dataset": "macro.gdp", "row_count": 1, "items": [{"dataset": "macro.gdp"}]}, dataset="macro.cpi")


@pytest.mark.asyncio
async def test_discovery_cursor_cycle_rejected():
    async def pages(cursor=None):
        return SimpleNamespace(tools=[], nextCursor="repeated")
    with pytest.raises(qa.Failure, match="cycle"):
        await qa.discover(pages, "tools")


def test_count_matching_wrong_catalog_rejected():
    with pytest.raises(qa.Failure, match="identifier"):
        qa.exact_catalog([SimpleNamespace(name="wrong")], {"required"}, "name")


def test_nested_response_and_endpoint_secrets_redacted(monkeypatch):
    monkeypatch.setenv("VNIBB_TEST_SECRET", "synthetic-sentinel")
    output = json.dumps(qa.redact({"error": ["synthetic-sentinel", "https://user:pw@host/path?token=abc", "user:pw@host/path", "Bearer abc.secret"]}))
    assert all(value not in output for value in ("synthetic-sentinel", "user:pw", "abc.secret", "token=abc"))


def test_wrong_matrix_snapshot_with_empty_evidence_rejected():
    with pytest.raises(qa.Failure, match="snapshot"):
        qa.matrix_selection({"snapshot": {"snapshot_id": "wrong", "cells": []}, "evidence": []}, {"snapshot_id": "requested", "result_ids": ["r1"]})


def test_exception_group_leaf_errors_are_redacted(monkeypatch):
    monkeypatch.setenv("VNIBB_TEST_SECRET", "synthetic-sentinel")
    errors = qa.error_details(ExceptionGroup("transport", [ValueError("HTTP401 synthetic-sentinel")]))
    assert errors == ["ValueError: HTTP401 <REDACTED>"]


def test_partial_mandatory_coverage_cannot_pass():
    checks = [{"name": "revision", "status": "PASS"}, {"name": "anonymous", "status": "PASS"}]
    assert qa.mandatory_gate(checks, {"revision", "anonymous", "authenticated"}) == "UNTESTED"


def test_source_catalog_drives_positional_reference_reads():
    catalog = qa.source_catalog()
    requests = [{"collection": name, "limit": min(100, spec["max_limit"])} for name, spec in catalog["collections"].items()]
    assert next(request for request in requests if request["collection"] == "companies") == {"collection": "companies", "limit": 100}


def financial_packet():
    return {"symbol": "MSR", "period_type": "year", "statement": "income_statement", "collection": "income_statements", "found": True,
            "item": {"symbol": "MSR", "source": "vietcap", "period_type": "year", "fiscal_year": 2025, "period": "2025", "revenue": 10,
                     "raw_data": {"structured": {"fiscalBasis": {"year": 2025, "periodType": "year"}}}}}


def test_numeric_period_with_all_financial_metrics_null_rejected():
    packet = financial_packet()
    packet["item"].update(revenue=None, period=2025)
    with pytest.raises(qa.Failure, match="no finite financial metrics"):
        qa.financial(packet, {"symbol": "MSR", "period_type": "year", "statement": "income_statement"})


def test_sql_financial_year_conflicting_with_raw_source_basis_rejected():
    packet = financial_packet()
    packet["item"]["raw_data"]["structured"]["fiscalBasis"]["year"] = 2024
    with pytest.raises(qa.Failure, match="fiscal year conflict"):
        qa.financial(packet, {"symbol": "MSR", "period_type": "year", "statement": "income_statement"})


def test_joint_remote_schema_and_row_truncation_cannot_pass():
    runner = qa.Runner(SimpleNamespace(expected_revision="test", holiday=[], matrix_fixtures=None))
    fields = runner.catalog["collections"]["stock_prices"]["fields"]
    assert "open" in fields
    with pytest.raises(qa.Failure, match="omits"):
        runner.sql_rows({"collection": "stock_prices", "row_count": 1, "items": [{"symbol": "MSR", "close": 100}]}, {"collection": "stock_prices", "symbol": "MSR"})


def test_nested_explicit_full_data_truncation_marker_rejected():
    with pytest.raises(qa.Failure, match="truncation marker"):
        qa.objects({"row_count": 1, "items": [{"raw": {"evidence": ["[truncated]"]}}]})


def test_invalid_float_cli_argument_redacts_private_value(monkeypatch, capsys):
    monkeypatch.setenv("VNIBB_TEST_SECRET", "synthetic-sentinel")
    monkeypatch.setattr(qa.sys, "argv", ["mcp_acceptance", "--expected-revision", "test", "--timeout", "synthetic-sentinel"])
    with pytest.raises(SystemExit) as failure:
        qa.arguments()
    assert failure.value.code == 2
    error = capsys.readouterr().err
    assert "synthetic-sentinel" not in error and "<REDACTED>" in error
