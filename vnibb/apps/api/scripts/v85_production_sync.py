#!/usr/bin/env python3
"""V85 production sync runner and V88 verification gate.

Runs the V67/V68 enrichment scripts against the currently configured DATABASE_URL,
then verifies the public API gates used in Sprint V85-V88.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

CONFIRM_TOKEN = "RUN_PRODUCTION_SYNC"
DEFAULT_API_BASE = os.getenv("VNIBB_API_BASE", "")
CHECK_SYMBOLS = ("VNM", "VCB", "FPT", "HPG")
CORE_SCREENER_FIELDS = (
    "revenue_growth",
    "operating_margin",
    "ev_ebitda",
    "dividend_yield",
    "debt_to_asset",
    "current_ratio",
    "market_cap",
)
OPTIONAL_RATIO_FIELDS = (
    "inventory_turnover",
    "dps",
    "payout_ratio",
    "debt_service_coverage",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="V85 production sync orchestrator")
    parser.add_argument("--symbols", default="ALL", help="Comma-separated symbol list or ALL")
    parser.add_argument(
        "--period",
        default="year",
        choices=["year", "quarter"],
        help="Period passed to v67_universal_resync.py",
    )
    parser.add_argument("--limit", type=int, default=0, help="Optional symbol cap (0 = no cap)")
    parser.add_argument("--batch-size-v67", type=int, default=50)
    parser.add_argument("--batch-size-v68", type=int, default=100)
    parser.add_argument("--skip-v67", action="store_true")
    parser.add_argument("--skip-v68", action="store_true")
    parser.add_argument("--skip-ratios", action="store_true")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Skip V67/V68 execution and run verification gates only",
    )
    parser.add_argument(
        "--confirm",
        default="",
        help=f"Safety token required to run sync jobs: {CONFIRM_TOKEN}",
    )
    return parser.parse_args()


def normalize_api_base(api_base: str) -> str:
    return api_base.rstrip("/")


def ensure_database_target() -> str:
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set. Abort to prevent accidental local execution.")

    lowered = database_url.lower()
    if "localhost" in lowered or "127.0.0.1" in lowered:
        raise RuntimeError("DATABASE_URL points to localhost. Refusing production sync.")

    if "vnibb.db" in lowered or "sqlite" in lowered:
        raise RuntimeError("DATABASE_URL points to SQLite. Refusing production sync.")

    return database_url


def run_command(command: list[str], dry_run: bool) -> None:
    print("$", " ".join(command))
    if dry_run:
        return
    subprocess.run(command, check=True)


def fetch_json(url: str, timeout: int = 30, retries: int = 2) -> dict[str, Any]:
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            if attempt >= retries:
                raise RuntimeError(f"HTTP {exc.code} for {url}: {body[:200]}") from exc
        except Exception as exc:
            if attempt >= retries:
                raise RuntimeError(f"Request failed for {url}: {exc}") from exc
        attempt += 1
        time.sleep(1.5)


def run_api_verification(api_base: str) -> bool:
    print("\n# API Verification")
    passed = True

    profile = fetch_json(f"{api_base}/equity/VNM/profile")
    market_cap = profile.get("data", {}).get("market_cap")
    print(f"- VNM profile market_cap: {market_cap}")
    if market_cap in (None, 0):
        vnm_screener = fetch_json(f"{api_base}/screener?symbol=VNM&limit=1")
        screener_rows = vnm_screener.get("data", []) or []
        screener_market_cap = screener_rows[0].get("market_cap") if screener_rows else None
        print(f"- VNM screener market_cap fallback: {screener_market_cap}")
        if screener_market_cap in (None, 0):
            passed = False

    screener = fetch_json(f"{api_base}/screener?limit=50")
    rows = screener.get("data", []) or []
    print(f"- Screener rows checked: {len(rows)}")

    if rows:
        row_keys = set(rows[0].keys())
    else:
        row_keys = set()

    tracked_fields = [field for field in CORE_SCREENER_FIELDS if field in row_keys]
    if len(tracked_fields) < len(CORE_SCREENER_FIELDS):
        missing_fields = sorted(set(CORE_SCREENER_FIELDS) - set(tracked_fields))
        print(f"- Core screener fields missing from payload: {', '.join(missing_fields)}")
        passed = False

    non_null_total = 0
    expected_total = max(1, len(rows) * max(1, len(tracked_fields)))
    for field in tracked_fields:
        non_null = sum(1 for row in rows if row.get(field) not in (None, ""))
        non_null_total += non_null
        print(f"  - {field}: {non_null}/{len(rows)}")

    overall_ratio = (non_null_total / expected_total) * 100
    print(f"- Screener tracked field ratio (core): {overall_ratio:.1f}%")
    if overall_ratio < 50:
        passed = False

    print("\n# Ratio Coverage (Optional Fields)")
    ratio_coverage = {field: 0 for field in OPTIONAL_RATIO_FIELDS}
    ratio_checked = 0
    for symbol in CHECK_SYMBOLS:
        payload = fetch_json(f"{api_base}/equity/{symbol}/ratios?period=year&limit=3")
        rows_ratio = payload.get("data", []) or []
        ratio_checked += len(rows_ratio)
        for row in rows_ratio:
            for field in OPTIONAL_RATIO_FIELDS:
                if row.get(field) not in (None, ""):
                    ratio_coverage[field] += 1

    print(f"- Ratio rows checked: {ratio_checked}")
    for field in OPTIONAL_RATIO_FIELDS:
        print(f"  - {field}: {ratio_coverage[field]} non-null values")

    print("\n# Statement Completeness")
    for symbol in CHECK_SYMBOLS:
        symbol_ok = True
        for endpoint in ("income-statement", "balance-sheet", "cash-flow"):
            payload = fetch_json(f"{api_base}/equity/{symbol}/{endpoint}")
            count = len(payload.get("data", []) or [])
            print(f"- {symbol} {endpoint}: {count}")
            if count == 0:
                symbol_ok = False
        passed = passed and symbol_ok

    print("\n# Real-time Probe")
    quote = fetch_json(f"{api_base}/equity/VNM/quote")
    quote_price = quote.get("data", {}).get("price")
    print(f"- VNM quote price: {quote_price}")
    if quote_price in (None, 0):
        passed = False

    return passed


def main() -> int:
    args = parse_args()
    api_base = normalize_api_base(args.api_base)

    if not api_base:
        print("ERROR: --api-base or VNIBB_API_BASE must be provided.")
        return 1

    print("# V85 Production Sync")
    print(f"- API verification base: {api_base}")

    database_url = None
    if not args.verify_only:
        try:
            database_url = ensure_database_target()
        except RuntimeError as exc:
            print(f"ERROR: {exc}")
            return 1
        print(f"- DATABASE_URL target: {database_url[:60]}...")

    if not args.verify_only and not args.dry_run and args.confirm != CONFIRM_TOKEN:
        print(f"ERROR: Missing confirmation token. Re-run with --confirm {CONFIRM_TOKEN}")
        return 1

    script_dir = Path(__file__).resolve().parent
    v67_script = script_dir / "v67_universal_resync.py"
    v68_script = script_dir / "v68_screener_enrich.py"

    if not args.verify_only and not args.skip_v67:
        command = [
            sys.executable,
            str(v67_script),
            "--target",
            "all",
            "--symbols",
            args.symbols,
            "--period",
            args.period,
            "--batch-size",
            str(args.batch_size_v67),
        ]
        if args.limit > 0:
            command.extend(["--limit", str(args.limit)])
        run_command(command, args.dry_run)

    if not args.verify_only and not args.skip_v68:
        command = [
            sys.executable,
            str(v68_script),
            "--symbols",
            args.symbols,
            "--batch-size",
            str(args.batch_size_v68),
        ]
        if args.limit > 0:
            command.extend(["--limit", str(args.limit)])
        if args.skip_ratios:
            command.append("--skip-ratios")
        run_command(command, args.dry_run)

    if args.dry_run:
        print("\nDry run complete. No sync jobs were executed.")
        return 0

    try:
        passed = run_api_verification(api_base)
    except RuntimeError as exc:
        print(f"ERROR: Verification failed: {exc}")
        return 1

    if passed:
        print("\nPASS: Production sync and verification gates succeeded.")
        return 0

    print("\nFAIL: One or more verification gates failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
