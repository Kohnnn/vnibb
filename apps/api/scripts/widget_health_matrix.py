#!/usr/bin/env python3
"""
Generate a core widget endpoint health matrix.

This script is intentionally lightweight and can be used as a quick smoke utility
without requiring the full test stack.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen


CORE_ENDPOINTS = [
    ("health", "/health/"),
    ("screener", "/api/v1/screener/?limit=20"),
    ("profile", "/api/v1/equity/VNM/profile"),
    ("quote", "/api/v1/equity/VNM/quote"),
    ("ratios", "/api/v1/equity/VNM/ratios?period=year"),
    ("historical", "/api/v1/equity/historical?symbol=VNM&period=1Y"),
]


def fetch_status(url: str, timeout: float) -> dict[str, Any]:
    started = time.perf_counter()
    req = Request(url, headers={"User-Agent": "vnibb-health-matrix/1.0"})
    try:
        with urlopen(req, timeout=timeout) as response:
            body = response.read(2000)
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
                "last_error": next((a.get("error") for a in reversed(attempts) if a.get("error")), None),
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": normalized_base,
        "repeats": repeats,
        "rows": rows,
        "overall_ok": all(row["all_ok"] for row in rows),
    }


def print_markdown(report: dict[str, Any]) -> None:
    print("# Core Widget Health Matrix")
    print(f"- Generated: `{report['generated_at']}`")
    print(f"- Base URL: `{report['base_url']}`")
    print(f"- Repeats: `{report['repeats']}`")
    print(f"- Overall OK: `{report['overall_ok']}`")
    print("")
    print("| Widget | Attempts | OK | Avg Latency (ms) | Statuses |")
    print("|--------|----------|----|------------------|----------|")
    for row in report["rows"]:
        statuses = ", ".join("None" if s is None else str(s) for s in row["statuses"])
        print(
            f"| {row['widget']} | {row['attempts']} | {row['ok_attempts']} | "
            f"{row['avg_latency_ms']} | {statuses} |"
        )
        if row["last_error"]:
            print(f"| `{row['widget']}` error | - | - | - | `{row['last_error']}` |")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run core widget endpoint health matrix")
    parser.add_argument("--base-url", default="https://vnibb.zeabur.app")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--output-json", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = run_matrix(args.base_url, repeats=args.repeats, timeout=args.timeout)
    print_markdown(report)

    if args.output_json:
        output = Path(args.output_json)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nSaved JSON report to `{output}`")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

