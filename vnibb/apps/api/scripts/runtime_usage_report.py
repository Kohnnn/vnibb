#!/usr/bin/env python3
"""
Runtime usage report for Zeabur/VNIBB logs.

Parses CSV runtime logs and extracts request volume + latency by endpoint.
Use this report to track daily burn and endpoint hot spots.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

REQUEST_PATTERN = re.compile(
    r"(?:Slow Request|Request):\s+(\w+)\s+([^\s]+)\s+status=(\d+)\s+took\s+([0-9.]+)s"
)


@dataclass
class EndpointStats:
    count: int
    avg_ms: float
    p95_ms: float
    max_ms: float


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    rank = max(0, min(len(values) - 1, math.ceil(len(values) * pct) - 1))
    return values[rank]


def parse_log(path: Path) -> tuple[dict[str, EndpointStats], datetime | None, datetime | None]:
    latencies: dict[str, list[float]] = defaultdict(list)
    first_ts: datetime | None = None
    last_ts: datetime | None = None

    with path.open(encoding="utf-8", errors="ignore", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            message = row.get("message", "")
            match = REQUEST_PATTERN.search(message)
            if not match:
                continue

            method, endpoint, _status, seconds = match.groups()
            key = f"{method} {endpoint}"
            latencies[key].append(float(seconds) * 1000)

            timestamp = row.get("timestamp")
            if timestamp:
                ts = datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S")
                if first_ts is None or ts < first_ts:
                    first_ts = ts
                if last_ts is None or ts > last_ts:
                    last_ts = ts

    stats: dict[str, EndpointStats] = {}
    for key, values in latencies.items():
        ordered = sorted(values)
        stats[key] = EndpointStats(
            count=len(values),
            avg_ms=sum(values) / len(values),
            p95_ms=percentile(ordered, 0.95),
            max_ms=max(values),
        )

    return stats, first_ts, last_ts


def format_rows(stats: dict[str, EndpointStats], limit: int = 5) -> list[str]:
    rows = ["| Endpoint | Count | Avg ms | P95 ms | Max ms |", "|---|---:|---:|---:|---:|"]
    sorted_items = sorted(stats.items(), key=lambda item: item[1].count, reverse=True)[:limit]
    for endpoint, value in sorted_items:
        rows.append(
            f"| `{endpoint}` | {value.count} | {value.avg_ms:.2f} | {value.p95_ms:.2f} | {value.max_ms:.2f} |"
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate runtime endpoint usage report")
    parser.add_argument("--log", required=True, help="Path to CSV runtime log")
    parser.add_argument(
        "--baseline-usage-per-day",
        type=float,
        default=None,
        help="Known current usage/day for calibration (example: 0.6)",
    )
    parser.add_argument(
        "--usage-per-request",
        type=float,
        default=None,
        help="Direct usage cost per request (overrides calibration)",
    )
    parser.add_argument("--warning-threshold", type=float, default=0.10)
    parser.add_argument("--critical-threshold", type=float, default=0.15)
    args = parser.parse_args()

    log_path = Path(args.log)
    if not log_path.exists():
        raise FileNotFoundError(f"Log not found: {log_path}")

    stats, first_ts, last_ts = parse_log(log_path)
    total_requests = sum(item.count for item in stats.values())

    print("# Runtime Usage Report")
    print(f"- Log: `{log_path}`")
    print(f"- Endpoints seen: `{len(stats)}`")
    print(f"- Requests parsed: `{total_requests}`")

    if first_ts and last_ts and last_ts > first_ts:
        hours = (last_ts - first_ts).total_seconds() / 3600
        requests_per_day = total_requests / hours * 24
        print(f"- Time window: `{first_ts}` -> `{last_ts}` (`{hours:.2f}h`)")
        print(f"- Estimated requests/day: `{requests_per_day:.0f}`")
    else:
        hours = None
        requests_per_day = None

    usage_per_request = args.usage_per_request
    if usage_per_request is None and args.baseline_usage_per_day is not None and requests_per_day:
        usage_per_request = args.baseline_usage_per_day / requests_per_day
        print(
            "- Calibrated usage/request from baseline "
            f"`{args.baseline_usage_per_day:.3f}/day`: `{usage_per_request:.8f}`"
        )

    if usage_per_request is not None and requests_per_day is not None:
        projected_usage_day = requests_per_day * usage_per_request
        projected_usage_month = projected_usage_day * 30
        warning_requests = args.warning_threshold / usage_per_request
        critical_requests = args.critical_threshold / usage_per_request
        print(f"- Projected usage/day (current load): `{projected_usage_day:.3f}`")
        print(f"- Projected usage/30d: `{projected_usage_month:.3f}`")
        print(f"- Warning threshold `{args.warning_threshold:.3f}/day` => `{warning_requests:.0f}` req/day")
        print(
            f"- Critical threshold `{args.critical_threshold:.3f}/day` => `{critical_requests:.0f}` req/day"
        )

    print("\n## Top Endpoints")
    for row in format_rows(stats, limit=5):
        print(row)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
