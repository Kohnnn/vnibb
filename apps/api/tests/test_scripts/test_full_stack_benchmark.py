import importlib.util
import json
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "scripts" / "full_stack_benchmark.py"
SPEC = importlib.util.spec_from_file_location("full_stack_benchmark", MODULE_PATH)
full_stack_benchmark = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(full_stack_benchmark)


def test_percentile_uses_linear_interpolation() -> None:
    values = [10.0, 20.0, 30.0, 40.0, 50.0]

    assert full_stack_benchmark.percentile(values, 0.50) == 30.0
    assert full_stack_benchmark.percentile(values, 0.95) == 48.0
    assert full_stack_benchmark.percentile(values, 0.99) == 49.6


def test_endpoint_benchmark_reports_percentiles_and_partial_failure(monkeypatch) -> None:
    attempts = iter(
        [
            {"ok": True, "status": 200, "latency_ms": 10.0},
            {"ok": False, "status": 503, "latency_ms": 30.0, "error": "unavailable"},
        ]
    )
    monkeypatch.setattr(full_stack_benchmark, "fetch_status", lambda *_: next(attempts))

    row = full_stack_benchmark.endpoint_benchmark("http://test", ["/ready"], 2, 1.0)[0]

    assert row["failure_state"] == "partial"
    assert row["p50_latency_ms"] == 20.0
    assert row["p95_latency_ms"] == 29.0
    assert row["p99_latency_ms"] == 29.8


def test_market_freshness_probe_scores_bucket_contract(monkeypatch) -> None:
    payload = {
        "timestamp": "2026-07-28T00:00:00",
        "overall": "fresh",
        "buckets": [
            {
                "label": "Daily prices",
                "last_data_date": "2026-07-28",
                "age_days": 0,
                "status": "fresh",
                "detail": "Price data",
            }
        ],
    }
    monkeypatch.setattr(
        full_stack_benchmark,
        "TABLE_QUALITY_PROBES",
        {"market_freshness": full_stack_benchmark.TABLE_QUALITY_PROBES["market_freshness"]},
    )
    monkeypatch.setattr(
        full_stack_benchmark,
        "fetch_status",
        lambda *_: {
            "ok": True,
            "status": 200,
            "latency_ms": 1.0,
            "sample": json.dumps(payload),
        },
    )

    row = full_stack_benchmark.data_quality("http://test", "VNM", "VCB", 1.0)[0]

    assert row["row_count"] == 1
    assert row["score"] == 100.0
    assert row["critical_fields"]["last_data_date"] == {
        "nulls": 0,
        "total": 1,
        "null_rate": 0.0,
    }
