import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).parents[2] / "scripts" / "widget_health_matrix.py"
SPEC = importlib.util.spec_from_file_location("widget_health_matrix", MODULE_PATH)
widget_health_matrix = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(widget_health_matrix)


def test_reliability_contract_enforces_slo_thresholds() -> None:
    report = {
        "rows": [
            {
                "widget": "ready",
                "attempts": 2,
                "ok_attempts": 1,
                "request_attempts": 2,
                "server_error_attempts": 1,
                "max_latency_ms": 3200,
            }
        ]
    }

    result = widget_health_matrix.evaluate_reliability_contract(
        report,
        max_5xx_rate=0,
        max_latency_ms=3000,
        max_readiness_failures=0,
        scheduler_missed_runs=1,
        max_scheduler_missed_runs=0,
    )

    assert result["failures"] == [
        "5xx_rate",
        "max_latency_ms",
        "readiness_failures",
        "scheduler_missed_runs",
    ]
