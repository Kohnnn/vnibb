#!/usr/bin/env python3
"""Production endpoint probe for Sprint V321-V400 verification.

Checks:
- raw health endpoints (`/health/`, `/live`, `/ready`)
- market indices route shape and scaling guard for VNINDEX/VN30
- RS endpoints (`leaders`, `laggards`, `gainers`)
- core equity + historical + insider endpoints across the sprint symbol set
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

DEFAULT_RAW_BASE = "https://213.35.101.237.sslip.io"
DEFAULT_SYMBOLS = "VNM,FPT,TCB,HPG,SHS,BSR,HUG,IPA"
DEFAULT_TIMEOUT = 20.0
EQUITY_ENDPOINTS = (
    "profile",
    "quote",
    "ratios",
    "income-statement",
    "balance-sheet",
    "cash-flow",
    "shareholders",
    "dividends",
    "calendar",
    "estimates",
)
RS_ENDPOINTS = ("leaders", "laggards", "gainers")


@dataclass
class ProbeResult:
    label: str
    url: str
    status: int | None
    ok: bool
    detail: str | None = None


def parse_symbols(raw: str) -> list[str]:
    return [symbol.strip().upper() for symbol in raw.split(",") if symbol.strip()]


def build_urls(raw_base: str, symbols: list[str]) -> list[tuple[str, str]]:
    api_base = f"{raw_base.rstrip('/')}/api/v1"
    urls: list[tuple[str, str]] = [
        ("health", f"{raw_base.rstrip('/')}/health/"),
        ("live", f"{raw_base.rstrip('/')}/live"),
        ("ready", f"{raw_base.rstrip('/')}/ready"),
        ("market_indices", f"{api_base}/market/indices"),
    ]

    urls.extend((f"rs_{endpoint}", f"{api_base}/rs/{endpoint}") for endpoint in RS_ENDPOINTS)

    for symbol in symbols:
        for endpoint in EQUITY_ENDPOINTS:
            urls.append((f"equity_{symbol}_{endpoint}", f"{api_base}/equity/{symbol}/{endpoint}"))
        urls.append(
            (f"historical_{symbol}", f"{api_base}/equity/historical?symbol={symbol}&period=1Y")
        )
        urls.append((f"insider_{symbol}", f"{api_base}/insider/{symbol}/deals"))

    return urls


def fetch_json(url: str, timeout: float) -> tuple[int, Any]:
    request = Request(url, headers={"User-Agent": "vnibb-production-probe/1.0"})
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - explicit probe target
        status = response.status
        payload = response.read().decode("utf-8")
    return status, json.loads(payload) if payload else None


def fetch_json_with_headers(url: str, timeout: float) -> tuple[int, Any, dict[str, str]]:
    request = Request(url, headers={"User-Agent": "vnibb-production-probe/1.0"})
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - explicit probe target
        status = response.status
        payload = response.read().decode("utf-8")
        headers = {key.lower(): value for key, value in response.headers.items()}
    return status, json.loads(payload) if payload else None, headers


def run_probe(url: str, timeout: float) -> ProbeResult:
    try:
        status, _ = fetch_json(url, timeout)
        return ProbeResult(label="", url=url, status=status, ok=status == 200)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:400]
        return ProbeResult(label="", url=url, status=exc.code, ok=False, detail=detail or exc.reason)
    except URLError as exc:
        return ProbeResult(label="", url=url, status=None, ok=False, detail=str(exc.reason))
    except Exception as exc:  # pragma: no cover - defensive reporting
        return ProbeResult(label="", url=url, status=None, ok=False, detail=str(exc))


def verify_market_scaling(raw_base: str, timeout: float) -> ProbeResult:
    market_url = f"{raw_base.rstrip('/')}/api/v1/market/indices"

    try:
        status, payload = fetch_json(market_url, timeout)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:400]
        return ProbeResult(
            label="market_scaling",
            url=market_url,
            status=exc.code,
            ok=False,
            detail=detail or exc.reason,
        )
    except Exception as exc:
        return ProbeResult(
            label="market_scaling",
            url=market_url,
            status=None,
            ok=False,
            detail=str(exc),
        )

    items = payload if isinstance(payload, list) else payload.get("data", [])
    market_map = {
        str(item.get("index_name", "")).upper(): item.get("current_value")
        for item in items
        if isinstance(item, dict)
    }

    invalid = {
        name: value
        for name, value in market_map.items()
        if name in {"VNINDEX", "VN30"} and (not isinstance(value, (int, float)) or value <= 1000)
    }
    detail = None
    if invalid:
        detail = json.dumps(invalid, ensure_ascii=True)

    return ProbeResult(
        label="market_scaling",
        url=market_url,
        status=status,
        ok=status == 200 and not invalid,
        detail=detail,
    )


def verify_response_headers(raw_base: str, timeout: float) -> ProbeResult:
    probe_url = f"{raw_base.rstrip('/')}/api/v1/equity/FPT/quote"

    try:
        status, _, headers = fetch_json_with_headers(probe_url, timeout)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:400]
        return ProbeResult(
            label="response_headers",
            url=probe_url,
            status=exc.code,
            ok=False,
            detail=detail or exc.reason,
        )
    except Exception as exc:
        return ProbeResult(
            label="response_headers",
            url=probe_url,
            status=None,
            ok=False,
            detail=str(exc),
        )

    api_version = headers.get("x-api-version")
    data_source = headers.get("x-data-source")
    detail_map: dict[str, Any] = {}
    if not api_version:
        detail_map["x-api-version"] = None
    if not data_source:
        detail_map["x-data-source"] = None

    return ProbeResult(
        label="response_headers",
        url=probe_url,
        status=status,
        ok=status == 200 and not detail_map,
        detail=json.dumps(detail_map, ensure_ascii=True) if detail_map else None,
    )


def extract_screener_item(payload: Any, symbol: str) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and str(item.get("symbol", "")).upper() == symbol:
                    return item
            return data[0] if data and isinstance(data[0], dict) else None

        if isinstance(data, dict):
            items = data.get("items")
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict) and str(item.get("symbol", "")).upper() == symbol:
                        return item
                return items[0] if items and isinstance(items[0], dict) else None

    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict) and str(item.get("symbol", "")).upper() == symbol:
                return item
        return payload[0] if payload and isinstance(payload[0], dict) else None

    return None


def verify_quote_alignment(raw_base: str, timeout: float, symbol: str = "FPT") -> ProbeResult:
    api_base = f"{raw_base.rstrip('/')}/api/v1"
    quote_url = f"{api_base}/equity/{symbol}/quote"
    screener_url = f"{api_base}/screener/?symbol={symbol}&limit=1"

    try:
        quote_status, quote_payload = fetch_json(quote_url, timeout)
        screener_status, screener_payload = fetch_json(screener_url, timeout)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:400]
        return ProbeResult(
            label="quote_alignment",
            url=quote_url,
            status=exc.code,
            ok=False,
            detail=detail or exc.reason,
        )
    except Exception as exc:
        return ProbeResult(
            label="quote_alignment",
            url=quote_url,
            status=None,
            ok=False,
            detail=str(exc),
        )

    quote_data = quote_payload.get("data", {}) if isinstance(quote_payload, dict) else {}
    screener_item = extract_screener_item(screener_payload, symbol.upper())
    quote_price = quote_data.get("price") if isinstance(quote_data, dict) else None
    screener_price = screener_item.get("price") if isinstance(screener_item, dict) else None

    prices_ok = isinstance(quote_price, (int, float)) and isinstance(screener_price, (int, float))
    mismatch = False
    if prices_ok and screener_price:
        mismatch = abs(float(quote_price) - float(screener_price)) / abs(float(screener_price)) > 0.01

    detail_map: dict[str, Any] = {
        "symbol": symbol.upper(),
        "quote_price": quote_price,
        "screener_price": screener_price,
    }
    if not prices_ok:
        detail_map["error"] = "missing_price"
    elif mismatch:
        detail_map["pct_diff"] = round(
            abs(float(quote_price) - float(screener_price)) / abs(float(screener_price)) * 100,
            2,
        )

    return ProbeResult(
        label="quote_alignment",
        url=quote_url,
        status=quote_status if quote_status != 200 else screener_status,
        ok=quote_status == 200 and screener_status == 200 and prices_ok and not mismatch,
        detail=json.dumps(detail_map, ensure_ascii=True) if (not prices_ok or mismatch) else None,
    )


def build_report(raw_base: str, symbols: list[str], timeout: float) -> dict[str, Any]:
    results: list[ProbeResult] = []
    for label, url in build_urls(raw_base, symbols):
        result = run_probe(url, timeout)
        result.label = label
        results.append(result)

    results.append(verify_market_scaling(raw_base, timeout))
    results.append(verify_response_headers(raw_base, timeout))
    results.append(verify_quote_alignment(raw_base, timeout))

    failures = [asdict(result) for result in results if not result.ok]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "raw_base": raw_base,
        "api_base": f"{raw_base.rstrip('/')}/api/v1",
        "symbols": symbols,
        "checked": len(results),
        "failure_count": len(failures),
        "failures": failures,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Probe VNIBB production endpoints")
    parser.add_argument("--raw-base", default=DEFAULT_RAW_BASE, help="Raw service base URL")
    parser.add_argument(
        "--symbols",
        default=DEFAULT_SYMBOLS,
        help="Comma-separated symbols for equity route verification",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help="Per-request timeout in seconds",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional JSON report output path",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    report = build_report(args.raw_base, parse_symbols(args.symbols), args.timeout)

    rendered = json.dumps(report, indent=2, ensure_ascii=True)
    print(rendered)

    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")

    return 0 if report["failure_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
