#!/usr/bin/env python3
"""Run VNIBB endpoint, data-quality, and widget coverage benchmarks."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from statistics import median
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
API_TS = ROOT / "apps" / "web" / "src" / "lib" / "api.ts"
WIDGET_REGISTRY_TS = ROOT / "apps" / "web" / "src" / "components" / "widgets" / "WidgetRegistry.ts"

DEFAULT_SYMBOL = "VNM"
DEFAULT_OTHER_SYMBOL = "VCB"
MAX_SAMPLE_BYTES = 512_000

FALLBACK_ENDPOINTS = [
    "/health/",
    "/live",
    "/ready",
    "/api/v1/screener/?limit=20",
    "/api/v1/equity/VNM/profile",
    "/api/v1/equity/VNM/quote",
    "/api/v1/equity/VNM/ratios?period=year",
    "/api/v1/equity/historical?symbol=VNM&period=1Y",
    "/api/v1/news/world?freshness_hours=72",
]

TABLE_QUALITY_PROBES = {
    "screener": {
        "endpoint": "/api/v1/screener/?limit=100",
        "critical_fields": ["symbol", "price", "pe", "pb", "ps", "rs_rating"],
    },
    "historical_prices": {
        "endpoint": "/api/v1/equity/historical?symbol={symbol}&period=1Y",
        "critical_fields": ["time", "open", "high", "low", "close", "volume"],
    },
    "ratios": {
        "endpoint": "/api/v1/equity/{symbol}/ratios?period=year",
        "critical_fields": ["pe", "pb", "roe", "roa", "eps"],
    },
    "market_freshness": {
        "endpoint": "/api/v1/market/freshness",
        "critical_fields": ["source", "latest_date", "status"],
    },
}

WIDGET_ENDPOINT_RULES = {
    "ticker_info": ["/api/v1/equity/{symbol}/quote"],
    "ticker_profile": ["/api/v1/equity/{symbol}/profile"],
    "key_metrics": ["/api/v1/equity/{symbol}/ratios?period=year"],
    "valuation_multiples": ["/api/v1/equity/{symbol}/ratios?period=year"],
    "valuation_multiples_chart": ["/api/v1/equity/{symbol}/ratios/history?period=year"],
    "valuation_band": ["/api/v1/equity/{symbol}/ratios/history?period=year"],
    "price_chart": ["/api/v1/equity/historical?symbol={symbol}&period=1Y"],
    "screener": ["/api/v1/screener/?limit=100"],
    "financial_ratios": ["/api/v1/equity/{symbol}/ratios?period=year"],
    "financial_snapshot": ["/api/v1/equity/{symbol}/financials?period=year"],
    "balance_sheet": ["/api/v1/equity/{symbol}/balance-sheet?period=year"],
    "income_statement": ["/api/v1/equity/{symbol}/income-statement?period=year"],
    "cash_flow": ["/api/v1/equity/{symbol}/cash-flow?period=year"],
    "market_overview": ["/api/v1/market/indices"],
    "world_indices": ["/api/v1/market/world-indices"],
    "forex_rates": ["/api/v1/market/forex-rates"],
    "commodities": ["/api/v1/market/commodities"],
    "market_sentiment": ["/api/v1/news/sentiment"],
    "world_news_monitor": ["/api/v1/news/world?freshness_hours=72"],
    "world_news_map": ["/api/v1/news/world/map"],
    "world_news_live_stream": ["/api/v1/news/world?freshness_hours=24"],
    "world_news_sources": ["/api/v1/news/world/sources"],
    "foreign_trading": ["/api/v1/equity/{symbol}/foreign-trading?period=1M"],
    "transaction_flow": ["/api/v1/equity/{symbol}/transaction-flow?period=1M"],
    "money_flow_trend": ["/api/v1/market/money-flow-trend"],
    "sector_performance": ["/api/v1/market/sector-performance"],
    "sector_board": ["/api/v1/market/sector-board"],
    "top_movers": ["/api/v1/market/top-movers"],
    "listing_browser": ["/api/v1/listing/symbols"],
    "rs_ranking": ["/api/v1/screener/?sort_by=rs_rating&sort_order=desc&limit=50"],
    "orderbook": ["/api/v1/equity/{symbol}/orderbook"],
    "quant_summary": ["/api/v1/quant/{symbol}"],
    "momentum": ["/api/v1/quant/{symbol}/momentum"],
    "gamma_exposure": ["/api/v1/quant/{symbol}/gamma-exposure"],
    "earnings_quality": ["/api/v1/quant/{symbol}/earnings-quality"],
    "smart_money": ["/api/v1/quant/{symbol}/smart-money"],
    "relative_rotation": ["/api/v1/quant/{symbol}/relative-rotation"],
    "pair_lab": ["/api/v1/quant/{symbol}/pair/{other_symbol}"],
    "market_structure": ["/api/v1/quant/{symbol}/market-structure-tests"],
}


def normalize_path(path: str, symbol: str, other_symbol: str) -> str:
    return path.format(symbol=symbol, other_symbol=other_symbol)


def fetch_status(url: str, timeout: float) -> dict[str, Any]:
    started = time.perf_counter()
    req = Request(url, headers={"User-Agent": "vnibb-full-stack-benchmark/1.0"})
    try:
        with urlopen(req, timeout=timeout) as response:
            body = response.read(MAX_SAMPLE_BYTES)
            return {
                "ok": 200 <= response.status < 400,
                "status": int(response.status),
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                "sample": body.decode("utf-8", errors="ignore"),
            }
    except HTTPError as exc:
        return {"ok": False, "status": int(exc.code), "latency_ms": round((time.perf_counter() - started) * 1000, 2), "error": str(exc)}
    except URLError as exc:
        return {"ok": False, "status": None, "latency_ms": round((time.perf_counter() - started) * 1000, 2), "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "status": None, "latency_ms": round((time.perf_counter() - started) * 1000, 2), "error": str(exc)}


def decode_payload(sample: str | None) -> Any:
    if not sample:
        return None
    try:
        return json.loads(sample)
    except json.JSONDecodeError:
        return None


def extract_data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def discover_api_endpoints(symbol: str, other_symbol: str) -> list[str]:
    if not API_TS.exists():
        return FALLBACK_ENDPOINTS
    text = API_TS.read_text(encoding="utf-8")
    endpoints = set(FALLBACK_ENDPOINTS)
    patterns = [
        r"fetchAPI<[^>]+>\(`([^`]+)`",
        r"fetchAPI\(`([^`]+)`",
        r"fetchAPI<[^>]+>\('([^']+)'",
        r"fetchAPI\('([^']+)'",
    ]
    for pattern in patterns:
        for raw in re.findall(pattern, text):
            path = raw.replace("${symbol}", "{symbol}").replace("${other}", "{other_symbol}")
            if not path.startswith("/"):
                continue
            if "${" in path or "`" in path:
                continue
            endpoints.add("/api/v1" + normalize_path(path, symbol, other_symbol))
    return sorted(endpoints)


def discover_widgets() -> list[str]:
    if not WIDGET_REGISTRY_TS.exists():
        return []
    text = WIDGET_REGISTRY_TS.read_text(encoding="utf-8")
    match = re.search(r"export const widgetRegistry[^=]*=\s*\{(?P<body>.*?)\n\};", text, re.S)
    if not match:
        return []
    return sorted(set(re.findall(r"^\s*([a-zA-Z0-9_]+):", match.group("body"), re.M)))


def endpoint_benchmark(base_url: str, paths: list[str], repeats: int, timeout: float) -> list[dict[str, Any]]:
    rows = []
    for path in paths:
        attempts = [fetch_status(base_url + path, timeout) for _ in range(max(1, repeats))]
        latencies = [a["latency_ms"] for a in attempts]
        statuses = [a.get("status") for a in attempts]
        ok_attempts = [a for a in attempts if a.get("ok")]
        rows.append(
            {
                "path": path,
                "attempts": len(attempts),
                "ok_attempts": len(ok_attempts),
                "all_ok": len(ok_attempts) == len(attempts),
                "statuses": statuses,
                "p50_latency_ms": round(median(latencies), 2) if latencies else None,
                "max_latency_ms": max(latencies) if latencies else None,
                "last_error": next((a.get("error") for a in reversed(attempts) if a.get("error")), None),
            }
        )
    return rows


def flatten_records(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        for key in ("items", "rows", "results", "data"):
            value = data.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        return [data]
    return []


def data_quality(base_url: str, symbol: str, other_symbol: str, timeout: float) -> list[dict[str, Any]]:
    rows = []
    for name, probe in TABLE_QUALITY_PROBES.items():
        path = normalize_path(probe["endpoint"], symbol, other_symbol)
        attempt = fetch_status(base_url + path, timeout)
        payload = decode_payload(attempt.get("sample")) if attempt.get("ok") else None
        records = flatten_records(extract_data(payload))
        field_stats = {}
        for field in probe["critical_fields"]:
            total = len(records)
            nulls = sum(1 for row in records if row.get(field) in (None, ""))
            field_stats[field] = {
                "nulls": nulls,
                "total": total,
                "null_rate": round(nulls / total, 4) if total else None,
            }
        null_rates = [v["null_rate"] for v in field_stats.values() if v["null_rate"] is not None]
        score = round(100 * (1 - (sum(null_rates) / len(null_rates))), 2) if null_rates else 0
        rows.append(
            {
                "table": name,
                "endpoint": path,
                "ok": bool(attempt.get("ok")),
                "status": attempt.get("status"),
                "row_count": len(records),
                "score": score,
                "critical_fields": field_stats,
                "last_error": attempt.get("error"),
            }
        )
    return rows


def widget_coverage(widgets: list[str], endpoint_rows: list[dict[str, Any]], symbol: str, other_symbol: str) -> list[dict[str, Any]]:
    endpoint_status = {row["path"]: row for row in endpoint_rows}
    rows = []
    for widget in widgets:
        paths = [normalize_path(p, symbol, other_symbol) for p in WIDGET_ENDPOINT_RULES.get(widget, [])]
        statuses = [endpoint_status.get(path, {}).get("all_ok") for path in paths]
        rows.append(
            {
                "widget": widget,
                "mapped_endpoints": paths,
                "mapped": bool(paths),
                "all_mapped_endpoints_ok": all(status is True for status in statuses) if statuses else None,
            }
        )
    return rows


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    base_url = args.base_url.rstrip("/")
    endpoints = discover_api_endpoints(args.symbol, args.other_symbol)
    if args.max_endpoints > 0:
        endpoints = endpoints[: args.max_endpoints]
    widgets = discover_widgets()
    endpoint_rows = endpoint_benchmark(base_url, endpoints, args.repeats, args.timeout)
    quality_rows = data_quality(base_url, args.symbol, args.other_symbol, args.timeout)
    coverage_rows = widget_coverage(widgets, endpoint_rows, args.symbol, args.other_symbol)
    mapped_count = sum(1 for row in coverage_rows if row["mapped"])
    endpoint_ok_count = sum(1 for row in endpoint_rows if row["all_ok"])
    quality_ok_count = sum(1 for row in quality_rows if row["ok"] and row["score"] >= args.min_quality_score)
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "base_url": base_url,
        "symbol": args.symbol,
        "other_symbol": args.other_symbol,
        "summary": {
            "endpoint_count": len(endpoint_rows),
            "endpoint_ok_count": endpoint_ok_count,
            "endpoint_ok_rate": round(endpoint_ok_count / len(endpoint_rows), 4) if endpoint_rows else 0,
            "data_quality_probe_count": len(quality_rows),
            "data_quality_ok_count": quality_ok_count,
            "widget_count": len(coverage_rows),
            "widget_mapped_count": mapped_count,
            "widget_mapped_rate": round(mapped_count / len(coverage_rows), 4) if coverage_rows else 0,
        },
        "endpoints": endpoint_rows,
        "data_quality": quality_rows,
        "widget_coverage": coverage_rows,
    }


def print_markdown(report: dict[str, Any]) -> None:
    summary = report["summary"]
    print("# VNIBB Full Stack Benchmark")
    print(f"- Generated: `{report['generated_at']}`")
    print(f"- Base URL: `{report['base_url']}`")
    print(f"- Endpoint OK: `{summary['endpoint_ok_count']}/{summary['endpoint_count']}`")
    print(f"- Data Quality OK: `{summary['data_quality_ok_count']}/{summary['data_quality_probe_count']}`")
    print(f"- Widget Coverage: `{summary['widget_mapped_count']}/{summary['widget_count']}`")
    print("")
    print("| Endpoint | OK | p50 ms | Max ms | Statuses |")
    print("|----------|----|--------|--------|----------|")
    for row in report["endpoints"]:
        print(f"| `{row['path']}` | `{row['all_ok']}` | `{row['p50_latency_ms']}` | `{row['max_latency_ms']}` | `{row['statuses']}` |")
    print("")
    print("| Data Probe | OK | Rows | Score | Endpoint |")
    print("|------------|----|------|-------|----------|")
    for row in report["data_quality"]:
        print(f"| `{row['table']}` | `{row['ok']}` | `{row['row_count']}` | `{row['score']}` | `{row['endpoint']}` |")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run VNIBB endpoint, data-quality, and widget coverage benchmark")
    parser.add_argument("--base-url", default=os.getenv("VNIBB_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--symbol", default=os.getenv("VNIBB_BENCHMARK_SYMBOL", DEFAULT_SYMBOL))
    parser.add_argument("--other-symbol", default=os.getenv("VNIBB_BENCHMARK_OTHER_SYMBOL", DEFAULT_OTHER_SYMBOL))
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--min-quality-score", type=float, default=70.0)
    parser.add_argument("--max-endpoints", type=int, default=0, help="Limit endpoint probes for quick local checks; 0 probes all")
    parser.add_argument("--output-json", default="")
    parser.add_argument("--fail-on-error", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = build_report(args)
    print_markdown(report)
    if args.output_json:
        output = Path(args.output_json)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nSaved JSON report to `{output}`")
    if args.fail_on_error:
        summary = report["summary"]
        if summary["endpoint_ok_count"] != summary["endpoint_count"]:
            return 1
        if summary["data_quality_ok_count"] != summary["data_quality_probe_count"]:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
