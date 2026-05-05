"""API verification utility for local/dev checks.

Usage:
    python apps/api/verify_api.py

Assumes API is running at http://localhost:8000.
"""

from __future__ import annotations

import time
from typing import Any

import requests

BASE_URL = "http://localhost:8000"
CORE_SYMBOLS = ("TCB", "HPG", "FPT")
DEFAULT_API_PREFIX = "/api/v1"


def _is_vnibb_prefix(paths: list[str], prefix: str) -> bool:
    return (
        f"{prefix}/screener/" in paths
        and f"{prefix}/equity/{{symbol}}/quote" in paths
        and f"{prefix}/equity/{{symbol}}/profile" in paths
    )


def detect_api_prefix() -> str:
    """Detect API prefix from OpenAPI schema when possible."""

    try:
        response = requests.get(f"{BASE_URL}/openapi.json", timeout=6)
        if response.status_code != 200:
            return DEFAULT_API_PREFIX

        path_keys = list(response.json().get("paths", {}).keys())

        if _is_vnibb_prefix(path_keys, "/api/v1"):
            return "/api/v1"
        if _is_vnibb_prefix(path_keys, "/api"):
            return "/api"
    except Exception:
        return DEFAULT_API_PREFIX

    return DEFAULT_API_PREFIX


def test_endpoint(name: str, url: str, timeout: int = 8) -> tuple[bool, Any]:
    """Test a single endpoint and print concise status."""

    try:
        start = time.time()
        response = requests.get(url, timeout=timeout)
        elapsed_ms = int((time.time() - start) * 1000)

        if response.status_code != 200:
            print(f"FAIL  | {name:34} | {elapsed_ms:5}ms | {response.status_code} | {url}")
            return False, response.text

        try:
            payload = response.json()
        except ValueError:
            payload = response.text

        print(f"PASS  | {name:34} | {elapsed_ms:5}ms | 200 | {url}")
        return True, payload
    except requests.Timeout:
        print(f"FAIL  | {name:34} |  >{timeout * 1000:4}ms | timeout | {url}")
        return False, "Timeout"
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL  | {name:34} |    N/A | error | {url}")
        print(f"       -> {exc}")
        return False, str(exc)


def has_payload_data(payload: Any) -> bool:
    """Check common response envelope patterns for non-empty data."""

    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return len(data) > 0
        if isinstance(data, dict):
            return len(data) > 0
        return data not in (None, "")
    return bool(payload)


def verify_symbol(symbol: str, api_prefix: str) -> bool:
    """Verify profile/ratios/statements for one symbol."""

    ok = True
    checks = [
        (f"{symbol} quote", f"{BASE_URL}{api_prefix}/equity/{symbol}/quote"),
        (f"{symbol} profile", f"{BASE_URL}{api_prefix}/equity/{symbol}/profile"),
        (
            f"{symbol} ratios",
            f"{BASE_URL}{api_prefix}/equity/{symbol}/ratios?period=year&limit=3",
        ),
        (f"{symbol} income", f"{BASE_URL}{api_prefix}/equity/{symbol}/income-statement"),
        (f"{symbol} balance", f"{BASE_URL}{api_prefix}/equity/{symbol}/balance-sheet"),
        (f"{symbol} cashflow", f"{BASE_URL}{api_prefix}/equity/{symbol}/cash-flow"),
    ]

    for label, url in checks:
        success, payload = test_endpoint(label, url)
        if not success:
            ok = False
            continue
        if not has_payload_data(payload):
            print(f"WARN  | {label:34} | empty data payload")
            ok = False

    return ok


def run_performance_probe(api_prefix: str) -> bool:
    """Simple screener latency probe."""

    print("\nPerformance Probe")
    start = time.time()
    try:
        response = requests.get(f"{BASE_URL}{api_prefix}/screener/?limit=100", timeout=12)
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL  | screener limit=100 | error: {exc}")
        return False

    elapsed_ms = int((time.time() - start) * 1000)
    if response.status_code != 200:
        print(f"FAIL  | screener limit=100 | {response.status_code} | {elapsed_ms}ms")
        return False

    print(f"PASS  | screener limit=100 | {elapsed_ms}ms")
    return True


def main() -> int:
    print("=" * 90)
    print("VNIBB API Verification")
    print("=" * 90)

    api_prefix = detect_api_prefix()
    print(f"Detected API prefix: {api_prefix}")

    vnibb_fingerprint_ok, _ = test_endpoint(
        "Vnibb screener route check", f"{BASE_URL}{api_prefix}/screener/?limit=1"
    )
    if not vnibb_fingerprint_ok:
        print("WARN  | local service does not look like VNIBB API (screener route missing)")

    global_ok = True

    print("\nBackend Health")
    for name, url in (
        ("API docs", f"{BASE_URL}/docs"),
        ("Health", f"{BASE_URL}{api_prefix}/health"),
        ("Screener", f"{BASE_URL}{api_prefix}/screener/?limit=10"),
    ):
        success, payload = test_endpoint(name, url)
        if not success:
            global_ok = False
            continue
        if name == "Screener" and isinstance(payload, dict):
            rows = payload.get("data") or payload.get("results") or []
            print(f"       -> screener rows: {len(rows)}")

    print("\nCore Symbol Verification (TCB / HPG / FPT)")
    for symbol in CORE_SYMBOLS:
        symbol_ok = verify_symbol(symbol, api_prefix)
        print(f"Result {symbol}: {'PASS' if symbol_ok else 'FAIL'}")
        global_ok = global_ok and symbol_ok

    global_ok = run_performance_probe(api_prefix) and global_ok

    print("\n" + "=" * 90)
    print(f"Overall: {'PASS' if global_ok else 'FAIL'}")
    print("=" * 90)
    return 0 if global_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
