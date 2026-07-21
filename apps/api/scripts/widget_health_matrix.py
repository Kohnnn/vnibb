#!/usr/bin/env python3
"""
Generate a core widget endpoint health matrix.

This script is intentionally lightweight and can be used as a quick smoke utility
without requiring the full test stack.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CORE_ENDPOINTS = [
    ("health", "/health/"),
    ("live", "/live"),
    ("ready", "/ready"),
    ("screener", "/api/v1/screener/?limit=20"),
    ("profile", "/api/v1/equity/VNM/profile"),
    ("quote", "/api/v1/equity/VNM/quote"),
    ("ratios", "/api/v1/equity/VNM/ratios?period=year"),
    ("historical", "/api/v1/equity/historical?symbol=VNM&period=1Y"),
    ("world_news", "/api/v1/news/world?freshness_hours=72"),
]

MAX_SAMPLE_BYTES = 256_000


def fetch_status(url: str, timeout: float) -> dict[str, Any]:
    started = time.perf_counter()
    req = Request(url, headers={"User-Agent": "vnibb-health-matrix/1.0"})
    try:
        with urlopen(req, timeout=timeout) as response:
            body = response.read(MAX_SAMPLE_BYTES)
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            return {
                "ok": 200 <= response.status < 400,
                "status": int(response.status),
                "latency_ms": elapsed_ms,
                "sample": body.decode("utf-8", errors="ignore"),
            }
    except HTTPError as exc:
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return {"ok": False, "status": int(exc.code), "latency_ms": elapsed_ms, "error": str(exc)}
    except URLError as exc:
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return {"ok": False, "status": None, "latency_ms": elapsed_ms, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return {"ok": False, "status": None, "latency_ms": elapsed_ms, "error": str(exc)}


def _decode_json_sample(sample: str | None) -> Any:
    if not sample:
        return None
    try:
        return json.loads(sample)
    except Exception:  # noqa: BLE001
        return None


def _extract_data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload.get("data")
    return payload


def evaluate_widget_state(widget: str, payload: Any) -> tuple[str, str]:
    """
    Return state enum and reason:
    - loaded: endpoint payload is valid and useful for widget render
    - empty: endpoint is healthy but dataset is legitimately empty
    - error: endpoint payload shape indicates broken contract
    - unknown: no parseable payload available
    """
    if payload is None:
        return ("unknown", "No JSON payload sample from successful response")

    data = _extract_data(payload)

    if widget == "health":
        status = payload.get("status") if isinstance(payload, dict) else None
        db = payload.get("db") if isinstance(payload, dict) else None
        if status in {"ok", "healthy"} and db in {"connected", "ok"}:
            return ("loaded", "Health endpoint returned connected status")
        if status in {"ok", "healthy"}:
            return ("empty", "Health endpoint reachable but dependency degraded")
        return ("error", "Health response missing expected status keys")

    if widget == "live":
        if isinstance(payload, dict) and payload.get("alive") is True:
            return ("loaded", "Liveness probe is healthy")
        return ("error", "Liveness payload missing alive=true")

    if widget == "ready":
        if isinstance(payload, dict) and payload.get("ready") is True:
            return ("loaded", "Readiness probe is healthy")
        return ("error", "Readiness payload missing ready=true")

    if widget == "screener":
        if isinstance(data, list):
            if data:
                return ("loaded", f"Screener returned {len(data)} rows")
            return ("empty", "Screener returned an empty list")
        return ("error", "Screener response missing list data")

    if widget == "profile":
        candidate = data if isinstance(data, dict) else payload if isinstance(payload, dict) else {}
        if isinstance(candidate, dict) and candidate.get("symbol"):
            return ("loaded", "Profile payload includes symbol metadata")
        return ("error", "Profile payload missing symbol")

    if widget == "quote":
        candidate = data if isinstance(data, dict) else payload if isinstance(payload, dict) else {}
        price = candidate.get("price") if isinstance(candidate, dict) else None
        if isinstance(price, (int, float)):
            return ("loaded", "Quote payload includes price")
        return ("error", "Quote payload missing numeric price")

    if widget in {"ratios", "historical"}:
        if isinstance(data, list):
            if data:
                return ("loaded", f"{widget} payload returned {len(data)} rows")
            return ("empty", f"{widget} payload returned an empty list")
        if isinstance(data, dict) and data:
            return ("loaded", f"{widget} payload returned object data")
        return ("error", f"{widget} payload missing data contract")

    return ("unknown", "No widget-state rule configured")


def evaluate_reliability_contract(
    report: dict[str, Any],
    *,
    max_5xx_rate: float,
    max_latency_ms: float,
    max_readiness_failures: int,
    scheduler_missed_runs: int | None,
    max_scheduler_missed_runs: int,
) -> dict[str, Any]:
    request_attempts = sum(row.get("request_attempts", 0) for row in report["rows"])
    server_errors = sum(row.get("server_error_attempts", 0) for row in report["rows"])
    readiness = next((row for row in report["rows"] if row["widget"] == "ready"), None)
    readiness_failures = 0 if readiness is None else readiness["attempts"] - readiness["ok_attempts"]
    max_observed_latency_ms = max((row["max_latency_ms"] or 0 for row in report["rows"]), default=0)
    checks = {
        "5xx_rate": server_errors / request_attempts if request_attempts else 1.0,
        "max_latency_ms": max_observed_latency_ms,
        "readiness_failures": readiness_failures,
        "scheduler_missed_runs": scheduler_missed_runs,
    }
    failures = []
    if checks["5xx_rate"] > max_5xx_rate:
        failures.append("5xx_rate")
    if checks["max_latency_ms"] > max_latency_ms:
        failures.append("max_latency_ms")
    if checks["readiness_failures"] > max_readiness_failures:
        failures.append("readiness_failures")
    if scheduler_missed_runs is not None and scheduler_missed_runs > max_scheduler_missed_runs:
        failures.append("scheduler_missed_runs")
    return {"checks": checks, "failures": failures, "ok": not failures}


def fetch_scheduler_missed_runs(url: str, timeout: float) -> int | None:
    result = fetch_status(url, timeout)
    payload = _decode_json_sample(result.get("sample"))
    if not result.get("ok") or not isinstance(payload, dict):
        return None
    value = payload.get("missed_runs")
    return int(value) if isinstance(value, int) and value >= 0 else None


def run_matrix(base_url: str, repeats: int, timeout: float) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    normalized_base = base_url.rstrip("/")

    for widget, path in CORE_ENDPOINTS:
        attempts = []
        for _ in range(max(1, repeats)):
            attempts.append(fetch_status(f"{normalized_base}{path}", timeout=timeout))

        ok_attempts = [a for a in attempts if a.get("ok")]
        statuses = [a.get("status") for a in attempts]
        latencies = [a.get("latency_ms", 0) for a in attempts]
        sample_payload = None
        for attempt in ok_attempts:
            sample_payload = _decode_json_sample(attempt.get("sample"))
            if sample_payload is not None:
                break

        widget_state, state_reason = evaluate_widget_state(widget, sample_payload)

        rows.append(
            {
                "widget": widget,
                "path": path,
                "attempts": len(attempts),
                "ok_attempts": len(ok_attempts),
                "all_ok": len(ok_attempts) == len(attempts),
                "statuses": statuses,
                "avg_latency_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
                "max_latency_ms": max(latencies) if latencies else None,
                "widget_state": widget_state,
                "state_reason": state_reason,
                "last_error": next((a.get("error") for a in reversed(attempts) if a.get("error")), None),
                "request_attempts": len(attempts),
                "server_error_attempts": sum(
                    1 for attempt in attempts if (attempt.get("status") or 0) >= 500
                ),
            }
        )

    endpoint_ok = all(row["all_ok"] for row in rows)
    widget_state_ok = all(row["widget_state"] != "error" for row in rows)

    state_counts: dict[str, int] = {"loaded": 0, "empty": 0, "error": 0, "unknown": 0}
    for row in rows:
        key = row["widget_state"]
        state_counts[key] = state_counts.get(key, 0) + 1

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "base_url": normalized_base,
        "repeats": repeats,
        "rows": rows,
        "state_counts": state_counts,
        "endpoint_ok": endpoint_ok,
        "widget_state_ok": widget_state_ok,
        "overall_ok": endpoint_ok and widget_state_ok,
    }


def print_markdown(report: dict[str, Any]) -> None:
    print("# Core Widget Health Matrix")
    print(f"- Generated: `{report['generated_at']}`")
    print(f"- Base URL: `{report['base_url']}`")
    print(f"- Repeats: `{report['repeats']}`")
    print(f"- Endpoint OK: `{report['endpoint_ok']}`")
    print(f"- Widget State OK: `{report['widget_state_ok']}`")
    print(f"- Overall OK: `{report['overall_ok']}`")
    print(f"- State Counts: `{report['state_counts']}`")
    print("")
    print("| Widget | Attempts | OK | Avg Latency (ms) | Statuses | State |")
    print("|--------|----------|----|------------------|----------|-------|")
    for row in report["rows"]:
        statuses = ", ".join("None" if s is None else str(s) for s in row["statuses"])
        print(
            f"| {row['widget']} | {row['attempts']} | {row['ok_attempts']} | "
            f"{row['avg_latency_ms']} | {statuses} | {row['widget_state']} |"
        )
        if row["state_reason"]:
            print(f"| `{row['widget']}` note | - | - | - | - | `{row['state_reason']}` |")
        if row["last_error"]:
            print(f"| `{row['widget']}` error | - | - | - | - | `{row['last_error']}` |")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run core widget endpoint health matrix")
    parser.add_argument(
        "--base-url",
        default=os.getenv("VNIBB_BASE_URL", "http://localhost:8000"),
    )
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--max-5xx-rate", type=float, default=0.0)
    parser.add_argument("--max-latency-ms", type=float, default=3000.0)
    parser.add_argument("--max-readiness-failures", type=int, default=0)
    parser.add_argument("--scheduler-status-url", default=os.getenv("VNIBB_SCHEDULER_STATUS_URL", ""))
    parser.add_argument("--max-scheduler-missed-runs", type=int, default=0)
    parser.add_argument(
        "--fail-on-error",
        action="store_true",
        help="Exit with code 1 when endpoint/status checks fail in the configured window",
    )
    parser.add_argument(
        "--strict-widget-state",
        action="store_true",
        help="Treat empty widget states as failures in addition to error states",
    )
    parser.add_argument("--output-json", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = run_matrix(args.base_url, repeats=args.repeats, timeout=args.timeout)
    scheduler_missed_runs = (
        fetch_scheduler_missed_runs(args.scheduler_status_url, args.timeout)
        if args.scheduler_status_url
        else None
    )
    report["reliability_contract"] = evaluate_reliability_contract(
        report,
        max_5xx_rate=args.max_5xx_rate,
        max_latency_ms=args.max_latency_ms,
        max_readiness_failures=args.max_readiness_failures,
        scheduler_missed_runs=scheduler_missed_runs,
        max_scheduler_missed_runs=args.max_scheduler_missed_runs,
    )
    print_markdown(report)
    print(f"- Reliability Contract: `{report['reliability_contract']}`")

    if args.output_json:
        output = Path(args.output_json)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nSaved JSON report to `{output}`")

    if args.fail_on_error:
        if not report["endpoint_ok"] or not report["reliability_contract"]["ok"]:
            return 1
        if args.strict_widget_state:
            if any(row["widget_state"] != "loaded" for row in report["rows"]):
                return 1
        elif not report["widget_state_ok"]:
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
