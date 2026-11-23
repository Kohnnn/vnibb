#!/usr/bin/env python3
# ruff: noqa: E402
"""
Compare V34 data-coverage baseline vs latest audit and evaluate SLA deltas.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.v32_data_audit import build_report
from vnibb.services.data_quality import PRICE_ROW_5Y_METRIC, normalize_archived_price_row_metric

COVERAGE_KEYS = [
    "top_with_prices",
    PRICE_ROW_5Y_METRIC,
    "top_with_ratios",
    "top_with_company_news",
    "top_with_company_events",
]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def print_delta(delta: dict[str, Any]) -> None:
    print("# V34 Coverage Delta")
    print(f"- Generated: `{delta['generated_at']}`")
    print(f"- Baseline: `{delta['baseline_file']}`")
    print(f"- Current: `{delta['current_file']}`")
    print(f"- Audit targets passed: `{delta['sla_passed']}`")
    print(f"- Historical session coverage: `{delta['historical_session_coverage_status']}`")
    print("")
    print("| Metric | Baseline | Current | Delta |")
    print("|--------|----------|---------|-------|")
    for metric in COVERAGE_KEYS:
        row = delta["metrics"][metric]
        print(
            f"| {metric} | {row['baseline']} | {row['current']} | "
            f"{row['delta']:+d} |"
        )
    print("")
    if delta["notes"]:
        print("## Notes")
        for note in delta["notes"]:
            print(f"- {note}")


async def run(args: argparse.Namespace) -> int:
    baseline_file = Path(args.baseline_json)
    current_file = Path(args.current_json)
    output_delta = Path(args.output_json)

    if args.run_current_audit or not current_file.exists():
        core_symbols = [s.strip().upper() for s in args.core_symbols.split(",") if s.strip()]
        current_report = await build_report(args.top_limit, core_symbols)
        current_file.parent.mkdir(parents=True, exist_ok=True)
        current_file.write_text(json.dumps(current_report, indent=2), encoding="utf-8")
    else:
        current_report = load_json(current_file)

    if not baseline_file.exists():
        raise FileNotFoundError(f"Baseline file not found: {baseline_file}")
    baseline_report = load_json(baseline_file)

    baseline_cov = normalize_archived_price_row_metric(baseline_report.get("top_symbol_coverage", {}))
    current_cov = normalize_archived_price_row_metric(current_report.get("top_symbol_coverage", {}))

    metrics: dict[str, dict[str, int]] = {}
    notes: list[str] = []
    has_regression = False

    for key in COVERAGE_KEYS:
        baseline_value = int(baseline_cov.get(key, 0) or 0)
        current_value = int(current_cov.get(key, 0) or 0)
        delta_value = current_value - baseline_value
        metrics[key] = {
            "baseline": baseline_value,
            "current": current_value,
            "delta": delta_value,
        }
        if delta_value < 0:
            has_regression = True
            notes.append(f"{key} regressed by {abs(delta_value)}")

    old_row_delta = metrics[PRICE_ROW_5Y_METRIC]["delta"]
    old_row_target_met = old_row_delta >= args.min_old_price_row_improvement
    outcome = "met" if old_row_target_met else "did not meet"
    notes.append(
        f"Old price-row count change {old_row_delta:+d} {outcome} target "
        f"(minimum change {args.min_old_price_row_improvement}); continuity not assessed"
    )

    sla_passed = old_row_target_met and not has_regression

    delta_report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "baseline_file": str(baseline_file),
        "current_file": str(current_file),
        "metrics": metrics,
        "historical_session_coverage_status": "not_assessed",
        "notes": notes,
        "sla_passed": sla_passed,
        "requirements": {
            "min_old_price_row_improvement": args.min_old_price_row_improvement,
            "allow_regression": args.allow_regression,
        },
    }

    output_delta.parent.mkdir(parents=True, exist_ok=True)
    output_delta.write_text(json.dumps(delta_report, indent=2), encoding="utf-8")
    print_delta(delta_report)
    print(f"\nSaved delta report to `{output_delta}`")

    if args.fail_on_miss:
        if not old_row_target_met:
            return 1
        if has_regression and not args.allow_regression:
            return 1
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare V34 coverage baseline and latest audit")
    parser.add_argument(
        "--baseline-json",
        default="scripts/v34_data_audit_baseline.json",
    )
    parser.add_argument(
        "--current-json",
        default="scripts/v34_data_audit_after.json",
    )
    parser.add_argument(
        "--output-json",
        default="scripts/v34_data_audit_delta.json",
    )
    parser.add_argument("--top-limit", type=int, default=200)
    parser.add_argument("--core-symbols", default="VNM,FPT,VCB,HPG,VIC")
    parser.add_argument("--run-current-audit", action="store_true")
    parser.add_argument(
        "--min-old-price-row-improvement",
        type=int,
        default=1,
        help="Minimum change in symbols with a retained row on or before the 5-year cutoff",
    )
    parser.add_argument("--allow-regression", action="store_true")
    parser.add_argument("--fail-on-miss", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parse_args())))
