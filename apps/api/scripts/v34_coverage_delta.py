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
from datetime import UTC, date, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.v32_data_audit import build_report
from vnibb.services.data_quality import (
    PRICE_ROW_5Y_CUTOFF_POLICY,
    PRICE_ROW_5Y_METRIC,
    normalize_archived_price_row_metric,
)

COVERAGE_KEYS = [
    "top_with_prices",
    PRICE_ROW_5Y_METRIC,
    "top_with_ratios",
    "top_with_company_news",
    "top_with_company_events",
]
STRICT_CUTOFF_POLICY = "host_date_minus_5y_inclusive"
# Pin metadata-free evidence to exact bytes; filenames and the legacy metric
# alone do not identify the policy. The V34 producer (b1a74bf2) was strict;
# e517286e introduced the allowance and committed the V35 report.
ARCHIVE_CUTOFF_POLICIES = {
    "2bbb3d9d3c33de5ddee77870cf5877f44cba0e6643d4f0ca9b6d9f1dae4b28b8": STRICT_CUTOFF_POLICY,  # V32 before
    "4a3b0c366fbc5a77aa279694b7652649b1f2f719bc89e9fd9738a0a32fb1445c": STRICT_CUTOFF_POLICY,  # V34 baseline
    "0e054897320ca1cdc56fbf8f7986c8f970aa88cf5df590d06c9331b8b5fb5651": STRICT_CUTOFF_POLICY,  # V34 after
    "bf82dfb1153e6101fa14555a0cef5d38b769a9ea21f1e88a4d4346a8b8168a6d": PRICE_ROW_5Y_CUTOFF_POLICY,  # V35 final
}


def load_json(path: Path) -> tuple[dict[str, Any], str | None]:
    contents = path.read_bytes()
    return json.loads(contents), ARCHIVE_CUTOFF_POLICIES.get(sha256(contents).hexdigest())


def _cutoff_evidence(coverage: dict[str, Any], archive_policy: str | None) -> dict[str, str | None]:
    policy = archive_policy or coverage.get("price_row_five_year_cutoff_policy")
    if policy not in (STRICT_CUTOFF_POLICY, PRICE_ROW_5Y_CUTOFF_POLICY):
        policy = None
    cutoff = coverage.get("price_row_five_year_cutoff")
    if isinstance(cutoff, str):
        try:
            if date.fromisoformat(cutoff).isoformat() != cutoff:
                cutoff = None
        except ValueError:
            cutoff = None
    else:
        cutoff = None
    return {"policy": policy, "cutoff_date": cutoff}


def _compare_cutoffs(baseline: dict[str, str | None], current: dict[str, str | None]) -> str:
    for key in ("policy", "cutoff_date"):
        if baseline[key] is not None and current[key] is not None and baseline[key] != current[key]:
            return "incomparable"
    if any(value is None for evidence in (baseline, current) for value in evidence.values()):
        return "unknown"
    return "comparable"


def _old_row_count(coverage: dict[str, Any]) -> int | None:
    value = coverage.get(PRICE_ROW_5Y_METRIC)
    return value if type(value) is int and value >= 0 else None


def print_delta(delta: dict[str, Any]) -> None:
    print("# V34 Coverage Delta")
    print(f"- Generated: `{delta['generated_at']}`")
    print(f"- Baseline: `{delta['baseline_file']}`")
    print(f"- Current: `{delta['current_file']}`")
    print(f"- Audit targets passed: `{delta['sla_passed']}`")
    print(f"- Historical session coverage: `{delta['historical_session_coverage_status']}`")
    comparison = delta["price_row_cutoff_comparison"]
    for side in ("baseline", "current"):
        evidence = comparison[side]
        print(
            f"- {side.title()} cutoff: `{evidence['policy'] or 'unknown'}` "
            f"(date: `{evidence['cutoff_date'] or 'unknown'}`)"
        )
    print(f"- Old-row cutoff comparison: `{comparison['status']}`")
    print("")
    print("| Metric | Baseline | Current | Delta |")
    print("|--------|----------|---------|-------|")
    for metric in COVERAGE_KEYS:
        row = delta["metrics"][metric]
        change = f"{row['delta']:+d}" if row["delta"] is not None else "not assessed"
        baseline = row["baseline"] if row["baseline"] is not None else "unknown"
        current = row["current"] if row["current"] is not None else "unknown"
        print(f"| {metric} | {baseline} | {current} | {change} |")
    print("")
    if delta["notes"]:
        print("## Notes")
        for note in delta["notes"]:
            print(f"- {note}")


async def run(args: argparse.Namespace) -> int:
    baseline_file = Path(args.baseline_json)
    current_file = Path(args.current_json)
    output_delta = Path(args.output_json)

    if output_delta.exists() or (args.run_current_audit and output_delta.resolve() == current_file.resolve()):
        raise FileExistsError(f"Use a fresh, separate --output-json path: {output_delta}")
    if args.run_current_audit and current_file.exists():
        raise FileExistsError(f"Use a fresh --current-json path with --run-current-audit: {current_file}")

    baseline_report, baseline_archive = load_json(baseline_file)
    if args.run_current_audit:
        core_symbols = [s.strip().upper() for s in args.core_symbols.split(",") if s.strip()]
        current_report = await build_report(args.top_limit, core_symbols)
        current_archive = None
        current_file.parent.mkdir(parents=True, exist_ok=True)
        with current_file.open("x", encoding="utf-8") as file:
            json.dump(current_report, file, indent=2)
    else:
        current_report, current_archive = load_json(current_file)

    baseline_cov = normalize_archived_price_row_metric(baseline_report.get("top_symbol_coverage", {}))
    current_cov = normalize_archived_price_row_metric(current_report.get("top_symbol_coverage", {}))
    baseline_cutoff = _cutoff_evidence(baseline_cov, baseline_archive)
    current_cutoff = _cutoff_evidence(current_cov, current_archive)
    cutoff_status = _compare_cutoffs(baseline_cutoff, current_cutoff)
    baseline_count = _old_row_count(baseline_cov)
    current_count = _old_row_count(current_cov)
    old_row_delta = (
        current_count - baseline_count
        if cutoff_status == "comparable" and current_count is not None and baseline_count is not None
        else None
    )

    metrics: dict[str, dict[str, int | None]] = {}
    notes: list[str] = []
    has_regression = False

    for key in COVERAGE_KEYS:
        if key == PRICE_ROW_5Y_METRIC:
            baseline_value, current_value, delta_value = baseline_count, current_count, old_row_delta
        else:
            baseline_value = int(baseline_cov.get(key, 0) or 0)
            current_value = int(current_cov.get(key, 0) or 0)
            delta_value = current_value - baseline_value
        metrics[key] = {
            "baseline": baseline_value,
            "current": current_value,
            "delta": delta_value,
        }
        if delta_value is not None and delta_value < 0:
            has_regression = True
            notes.append(f"{key} regressed by {abs(delta_value)}")

    old_row_target_met = None
    if old_row_delta is None:
        notes.append("Old price-row target not assessed: matching cutoff policies, dates and counts are required.")
    else:
        old_row_target_met = old_row_delta >= args.min_old_price_row_improvement
        outcome = "met" if old_row_target_met else "did not meet"
        notes.append(
            f"Old price-row count change {old_row_delta:+d} {outcome} target "
            f"(minimum change {args.min_old_price_row_improvement}); continuity not assessed"
        )

    sla_passed = old_row_target_met is True and not has_regression

    delta_report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "baseline_file": str(baseline_file),
        "current_file": str(current_file),
        "metrics": metrics,
        "price_row_cutoff_comparison": {
            "status": cutoff_status,
            "baseline": baseline_cutoff,
            "current": current_cutoff,
            "target_met": old_row_target_met,
        },
        "historical_session_coverage_status": "not_assessed",
        "notes": notes,
        "sla_passed": sla_passed,
        "requirements": {
            "min_old_price_row_improvement": args.min_old_price_row_improvement,
            "allow_regression": args.allow_regression,
        },
    }

    output_delta.parent.mkdir(parents=True, exist_ok=True)
    with output_delta.open("x", encoding="utf-8") as file:
        json.dump(delta_report, file, indent=2)
    print_delta(delta_report)
    print(f"\nSaved delta report to `{output_delta}`")

    if args.fail_on_miss:
        if old_row_target_met is not True:
            return 1
        if has_regression and not args.allow_regression:
            return 1
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare V34 retained counts and gate old-row counts only at matching cutoffs",
        epilog="The retired --min-5y-improvement option was replaced by --min-old-price-row-improvement.",
    )
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
        default="scripts/v34_data_audit_delta_current.json",
        help="Fresh output path; existing files are not overwritten",
    )
    parser.add_argument("--top-limit", type=int, default=200)
    parser.add_argument("--core-symbols", default="VNM,FPT,VCB,HPG,VIC")
    parser.add_argument(
        "--run-current-audit", action="store_true", help="Write a new audit to a fresh --current-json path"
    )
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
