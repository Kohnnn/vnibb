#!/usr/bin/env python3
"""Reproduce two sampled audit-tool gaps without importing the application.

Run from a checkout containing the reviewed source:

    python3 reproduce_audit_blind_spots.py \
        --source apps/api/vnibb/services/data_quality.py \
        --output audit_blind_spots_results.json

Only Python's standard library is used. The source file is parsed, not imported.
Its Git blob hash must match the file reviewed at SOURCE_COMMIT. Only the exact
Mongo-status helper and two assignments are compiled from that verified AST.
All observations below are synthetic; no datastore or provider is contacted.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

SOURCE_COMMIT = "df6a6d6f35c1e5bcee60d67b79c81c351530d425"
SOURCE_PATH = "apps/api/vnibb/services/data_quality.py"
EXPECTED_GIT_BLOB = "9b36b6734964842dc7ca219fbcf3ef096988294d"
AUDIT_DATE = date(2026, 11, 23)


class FixedAuditDate(date):
    """Fix date.today() while leaving the source threshold expression intact."""

    @classmethod
    def today(cls) -> FixedAuditDate:
        return cls(AUDIT_DATE.year, AUDIT_DATE.month, AUDIT_DATE.day)


def exactly_one(nodes: list[ast.AST], description: str) -> ast.AST:
    if len(nodes) != 1:
        raise ValueError(f"Expected exactly one {description}; found {len(nodes)}")
    return nodes[0]


def assignment_in(function: ast.AST, target: str) -> ast.Assign:
    node = exactly_one(
        [
            item
            for item in ast.walk(function)
            if isinstance(item, ast.Assign)
            and any(
                isinstance(name, ast.Name) and name.id == target
                for name in item.targets
            )
        ],
        f"assignment to {target}",
    )
    assert isinstance(node, ast.Assign)
    return node


def execute_node(node: ast.AST, namespace: dict[str, Any]) -> None:
    module = ast.Module(body=[node], type_ignores=[])
    exec(compile(module, f"{SOURCE_PATH}@{SOURCE_COMMIT}", "exec"), namespace)


def node_evidence(node: ast.AST, source: str) -> dict[str, Any]:
    return {
        "start_line": node.lineno,
        "end_line": node.end_lineno,
        "source": ast.get_source_segment(source, node),
    }


def reproduce(source_path: Path) -> dict[str, Any]:
    raw = source_path.read_bytes()
    actual_blob = hashlib.sha1(
        b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw
    ).hexdigest()
    if actual_blob != EXPECTED_GIT_BLOB:
        raise ValueError(
            "Source blob does not match the reviewed revision. "
            f"Expected {EXPECTED_GIT_BLOB}; got {actual_blob}. "
            f"Check out {SOURCE_COMMIT} before running this reproduction."
        )
    source = raw.decode("utf-8")
    tree = ast.parse(source, filename=SOURCE_PATH)
    status_helper = exactly_one(
        [
            item
            for item in tree.body
            if isinstance(item, ast.FunctionDef)
            and item.name == "_mongo_eod_quality_status"
        ],
        "top-level _mongo_eod_quality_status helper",
    )
    runner = exactly_one(
        [
            item
            for item in tree.body
            if isinstance(item, ast.AsyncFunctionDef)
            and item.name == "run_data_quality_check"
        ],
        "top-level run_data_quality_check function",
    )
    threshold_assignment = assignment_in(runner, "threshold_5y")
    history_assignment = assignment_in(runner, "top_with_5y")

    status_namespace: dict[str, Any] = {}
    execute_node(status_helper, status_namespace)
    status_function = status_namespace["_mongo_eod_quality_status"]
    clean_summary = {
        "audited_symbols": 20,
        "audited_documents": 1,
        "coverage_symbols": 1,
        "missing_or_non_vnd_price_unit": 0,
        "invalid_ohlcv": 0,
        "missing_provenance": 0,
        "exact_duplicates": 0,
        "same_source_duplicates": 0,
        "cross_source_overlaps": 0,
    }
    mongo_results = []
    for case, changes, expected in [
        ("one_clean_symbol_of_twenty", {}, ("ok", [])),
        (
            "empty_sample_control",
            {"audited_documents": 0, "coverage_symbols": 0},
            ("warning", ["empty_sample"]),
        ),
        (
            "invalid_ohlcv_control",
            {"invalid_ohlcv": 1},
            ("failed", ["invalid_ohlcv"]),
        ),
    ]:
        summary = {**clean_summary, **changes}
        status, issues = status_function(summary)
        assert (status, issues) == expected, case
        mongo_results.append(
            {
                "case": case,
                "synthetic_summary": summary,
                "actual_output": {"status": status, "issues": issues},
            }
        )

    # Execute the actual date.today().replace(...) + timedelta(days=30)
    # assignment. Do not substitute a manually calculated threshold.
    threshold_namespace: dict[str, Any] = {
        "date": FixedAuditDate,
        "timedelta": timedelta,
    }
    execute_node(threshold_assignment, threshold_namespace)
    threshold = threshold_namespace["threshold_5y"]
    assert threshold.isoformat() == "2021-12-23"

    history_results = []
    for case, dates, expected_count in [
        ("one_ancient_row_only", ["2020-01-01"], 1),
        (
            "ancient_and_current_endpoints_only",
            ["2020-01-01", "2026-11-23"],
            1,
        ),
        ("recent_row_only_control", ["2026-11-23"], 0),
    ]:
        aggregate = {
            "min_date": min(dates),
            "max_date": max(dates),
        }
        namespace: dict[str, Any] = {
            "threshold_5y": threshold,
            "price_span": [
                SimpleNamespace(
                    min_date=date.fromisoformat(aggregate["min_date"]),
                    max_date=date.fromisoformat(aggregate["max_date"]),
                )
            ],
        }
        execute_node(history_assignment, namespace)
        actual_count = namespace["top_with_5y"]
        assert actual_count == expected_count, case
        history_results.append(
            {
                "case": case,
                "synthetic_retained_dates": dates,
                "synthetic_aggregate_row": aggregate,
                "actual_output": {"top_with_5y_prices": actual_count},
            }
        )

    return {
        "evidence_version": 1,
        "scope": "Synthetic exact-source probes; no database access",
        "source": {
            "repository": "Kohnnn/vnibb",
            "commit": SOURCE_COMMIT,
            "path": SOURCE_PATH,
            "expected_git_blob": EXPECTED_GIT_BLOB,
            "actual_git_blob": actual_blob,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "blob_verified": True,
        },
        "fixed_audit_date": AUDIT_DATE.isoformat(),
        "actual_threshold_5y": threshold.isoformat(),
        "execution": {
            "source_module_imported": False,
            "application_modules_imported": False,
            "provider_calls": 0,
            "database_connections": 0,
            "production_partitions_scanned": 0,
            "synthetic_cases": len(mongo_results) + len(history_results),
        },
        "extracted_source": {
            "mongo_status_helper": node_evidence(status_helper, source),
            "threshold_assignment": node_evidence(threshold_assignment, source),
            "history_count_assignment": node_evidence(history_assignment, source),
        },
        "mongo_status_results": mongo_results,
        "five_year_history_results": history_results,
        "limitations": [
            "Mongo cases execute the status helper, not a MongoDB aggregation.",
            "History cases execute the exact threshold and count assignments "
            "using synthetic min/max aggregates, not a SQL query.",
            "The Mongo result is a subreport status; other daily checks can "
            "still make the complete report warning or failed.",
            "These cases establish no current production counts, missing "
            "eligible records, financial truth, or source freshness.",
            "No repository test suite or rendered application test was run.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help=f"Path to {SOURCE_PATH} from reviewed commit {SOURCE_COMMIT}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write the JSON result here; omit to print JSON to stdout",
    )
    args = parser.parse_args()
    try:
        result = reproduce(args.source)
    except (OSError, UnicodeDecodeError, ValueError, AssertionError) as exc:
        parser.exit(2, f"Reproduction failed: {exc}\n")
    encoded = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output is None:
        print(encoded, end="")
    else:
        args.output.write_text(encoded, encoding="utf-8")
        print(
            json.dumps(
                {
                    "output": str(args.output),
                    "source_blob_verified": True,
                    "synthetic_cases": result["execution"]["synthetic_cases"],
                    "fixed_audit_date": result["fixed_audit_date"],
                    "actual_threshold_5y": result["actual_threshold_5y"],
                },
                indent=2,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

