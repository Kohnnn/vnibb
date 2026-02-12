#!/usr/bin/env python3
"""Run VNIBB data quality coverage and freshness checks."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from vnibb.services.data_quality import run_data_quality_check


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run daily VNIBB data quality check")
    parser.add_argument(
        "--top-limit", type=int, default=200, help="Top symbol scope for SLA checks"
    )
    parser.add_argument(
        "--max-stale-days",
        type=int,
        default=7,
        help="Warn when freshness timestamps are older than this",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default="scripts/data_quality_report.json",
        help="Output path for JSON report",
    )
    return parser.parse_args()


async def _main() -> int:
    args = parse_args()
    report = await run_data_quality_check(
        top_limit=args.top_limit,
        max_stale_days=args.max_stale_days,
        output_path=args.output_json,
    )

    print("# Data Quality Check")
    print(f"- Generated: {report['generated_at']}")
    print(f"- Status: {report['status']}")
    print("- Metrics:")
    for key, value in report["metrics"].items():
        target = report["targets"].get(key)
        print(f"  - {key}: {value} (target: {target})")

    if report["warnings"]:
        print("- Warnings:")
        for warning in report["warnings"]:
            print(f"  - {warning}")
    else:
        print("- Warnings: none")

    output = Path(args.output_json)
    if output.exists():
        payload = json.loads(output.read_text(encoding="utf-8"))
        print(f"- Report saved: {output}")
        print(f"- Stored status: {payload.get('status')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
