#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-http://127.0.0.1:8001}}"
BASE_URL="${BASE_URL%/}"
MCP_URL="${MCP_URL:-${BASE_URL}/mcp}"
if [[ -z "${HEALTH_URL:-}" ]]; then
  if [[ "$BASE_URL" =~ :[0-9]+$ ]]; then
    HEALTH_URL="${BASE_URL}/health"
  else
    HEALTH_URL="${BASE_URL}/mcp-health"
  fi
fi
TIMEOUT="${TIMEOUT:-20}"
SYMBOL="${SYMBOL:-FPT}"
PERIOD_TYPE="${PERIOD_TYPE:-year}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.oracle.yml}"
ENV_FILE="${ENV_FILE:-deployment/env.oracle}"
PYTHON_MODE="${PYTHON_MODE:-auto}"
compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

if [[ "$PYTHON_MODE" == "auto" ]]; then
  PYTHON_MODE=none
  for candidate in python3 python py; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import mcp, httpx' >/dev/null 2>&1; then
      PYTHON_MODE="host:${candidate}"
      break
    fi
  done
  if [[ "$PYTHON_MODE" == "none" ]] && command -v docker >/dev/null 2>&1 && [[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]; then
    if [[ -n "$("${compose[@]}" ps --status running -q mcp)" ]]; then
      PYTHON_MODE=container
    fi
  fi
fi

if [[ "$PYTHON_MODE" == "container" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing compose interpolation env file: $ENV_FILE" >&2
    exit 1
  fi
  if [[ -z "$("${compose[@]}" ps --status running -q mcp)" ]]; then
    echo "MCP container is not running; smoke never starts services" >&2
    exit 1
  fi
  command=("${compose[@]}" exec -T)
  if [[ -n "${VNIBB_MCP_SHARED_BEARER_TOKEN:-}" ]]; then
    command+=(-e "VNIBB_MCP_SHARED_BEARER_TOKEN=${VNIBB_MCP_SHARED_BEARER_TOKEN}")
  fi
  if [[ -n "${SSL_CERT_FILE:-}" ]]; then
    command+=(-e "SSL_CERT_FILE=${SSL_CERT_FILE}")
  fi
  command+=(mcp python)
elif [[ "$PYTHON_MODE" == host:* ]]; then
  command=("${PYTHON_MODE#host:}")
else
  echo "No Python MCP client. Install apps/api dependencies or use PYTHON_MODE=container with a running MCP service." >&2
  exit 1
fi

echo "VNIBB MCP protocol smoke: ${MCP_URL}, symbol=${SYMBOL}, period=${PERIOD_TYPE}, runtime=${PYTHON_MODE}"
"${command[@]}" - "$MCP_URL" "$HEALTH_URL" "$SYMBOL" "$PERIOD_TYPE" "$TIMEOUT" <<'PY'
import asyncio
import json
import math
import os
import re
import ssl
import sys

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

url, health_url, symbol, period_type, timeout = sys.argv[1:]
symbol = symbol.upper()
if period_type not in {"year", "quarter"}:
    raise SystemExit("PERIOD_TYPE must be year or quarter")
headers = {}
if token := os.environ.get("VNIBB_MCP_SHARED_BEARER_TOKEN"):
    headers["Authorization"] = f"Bearer {token}"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def numeric_values(mapping):
    return [v for v in mapping.values() if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)]


def error_messages(exc):
    children = getattr(exc, "exceptions", None)
    if children:
        return [message for child in children for message in error_messages(child)]
    message = f"{type(exc).__name__}: {exc}"
    for key, value in os.environ.items():
        if value and any(part in key.upper() for part in ("TOKEN", "SECRET", "PASSWORD", "API_KEY")):
            message = message.replace(value, "<REDACTED>")
    return [re.sub(r"\b[a-z][a-z0-9+.-]*://[^\s'\"<>]+", "<REDACTED_URL>", message, flags=re.I)]


async def call(session, name, arguments=None):
    result = await session.call_tool(name, arguments=arguments or {})
    require(not result.isError, f"{name}: tool error (database unavailable or read failed): {result.content}")
    payload = result.structuredContent
    if payload is None:
        texts = [item.text for item in result.content if getattr(item, "type", None) == "text"]
        payload = json.loads("\n".join(texts))
    require(isinstance(payload, dict), f"{name}: missing structured object")
    return payload


async def main():
    report = {"symbol": symbol, "period_type": period_type, "checks": {}}
    # TLS verification stays enabled. SSL_CERT_FILE may point to a trusted private CA.
    async with httpx.AsyncClient(headers=headers, timeout=float(timeout), verify=ssl.create_default_context()) as client:
        health = await client.get(health_url)
        health.raise_for_status()
        require(health.json().get("read_only") is True, "health: not a read-only MCP server")
        report["checks"]["health"] = "process only; not database evidence"
        async with streamable_http_client(url, http_client=client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = {tool.name for tool in (await session.list_tools()).tools}
                required = {"get_database_status", "get_mongo_status", "get_symbol_prices", "get_latest_financial_statement", "get_premium_dataset"}
                require(required <= tools, f"list_tools: missing {sorted(required - tools)}")
                report["tool_count"] = len(tools)
                pg = await call(session, "get_database_status")
                require(pg.get("connectivity", {}).get("status") == "connected", "PostgreSQL unavailable (not an empty symbol result)")
                mongo = await call(session, "get_mongo_status")
                require(mongo.get("enabled"), "MongoDB not configured (not an empty dataset)")
                require(mongo.get("connectivity", {}).get("status") == "connected", "MongoDB unavailable (not an empty dataset)")
                prices = await call(session, "get_symbol_prices", {"symbol": symbol, "limit": 3})
                require(prices.get("source") == "postgres:stock_prices", "prices: incorrect storage source")
                require(prices.get("items"), "PostgreSQL connected but symbol price rows empty")
                for row in prices["items"]:
                    require(row.get("symbol") == symbol, "prices: cross-symbol row")
                    require(row.get("price_unit") not in {None, "unknown"}, "prices: unknown unit; no magnitude inference allowed")
                    require(row.get("source"), "prices: no provider source evidence")
                report["checks"]["postgres_prices"] = len(prices["items"])
                failures = []
                for statement in ("income_statement", "balance_sheet", "cash_flow"):
                    try:
                        pg_statement = await call(session, "get_latest_financial_statement", {"symbol": symbol, "statement": statement, "period_type": period_type})
                        require(pg_statement.get("found"), f"PostgreSQL connected but {statement} empty for {symbol}/{period_type}")
                        item = pg_statement["item"]
                        require(item.get("symbol") == symbol and item.get("period_type") == period_type, f"{statement}: incorrect symbol/fiscal scope")
                        require(item.get("fiscal_year") and (period_type != "quarter" or item.get("fiscal_quarter") in (1, 2, 3, 4)), f"{statement}: missing fiscal period")
                        require(item.get("source") == "vietcap", f"{statement}: no IQ primary source in PostgreSQL")
                        require(numeric_values({k: v for k, v in item.items() if k not in {"id", "fiscal_year", "fiscal_quarter"}}), f"{statement}: no structured numeric financial values")
                        sql_evidence = item.get("raw_data") or {}
                        require(sql_evidence.get("raw") and sql_evidence.get("descriptors"), f"{statement}: missing PostgreSQL lossless source evidence")
                        require(sql_evidence.get("sourceDate"), f"{statement}: PostgreSQL source date unavailable")
                        report["checks"][f"postgres:{statement}"] = "IQ structured row"
                    except Exception as exc:
                        failures.extend(error_messages(exc))
                    dataset = f"finance.{statement}"
                    try:
                        corpus = await call(session, "get_premium_dataset", {"symbol": symbol, "dataset": dataset, "period_type": period_type, "limit": 3})
                        require(corpus.get("items"), f"MongoDB connected but {dataset} IQ rows empty; no source substitution")
                        for row in corpus["items"]:
                            require(row.get("symbol") == symbol and row.get("datasetVariant") == f"{dataset}.{period_type}", f"{dataset}: incorrect symbol/fiscal scope")
                            require(row.get("source") == "vietcap", f"{dataset}: non-IQ source")
                            require(row.get("sourceDate"), f"{dataset}: source date unavailable; receipt time is not source freshness")
                            require(row.get("raw") and row.get("recordKey"), f"{dataset}: missing raw/source identity")
                            unit_values = row.get("units") or {"value": row.get("unit")}
                            require(isinstance(unit_values, dict) and any(value not in (None, "", "unknown") for value in unit_values.values()), f"{dataset}: source units unavailable/unknown")
                            structured = row.get("structured") or {}
                            basis = structured.get("fiscalBasis") or row.get("fiscalBasis") or {}
                            require(isinstance(basis, dict) and basis.get("year") and basis.get("periodType") == period_type, f"{dataset}: fiscal basis unavailable/unknown")
                            if period_type == "quarter":
                                require(basis.get("quarter") in (1, 2, 3, 4), f"{dataset}: missing fiscal quarter")
                                require(basis.get("quarterBasis") not in (None, "", "unknown"), f"{dataset}: standalone/cumulative quarterly basis unavailable")
                            require(row.get("comTypeCode") and (row.get("descriptors") or row.get("descriptorEvidence")), f"{dataset}: missing company/descriptor evidence")
                            require(numeric_values(structured.get("values") or structured), f"{dataset}: no structured numeric values")
                        report["checks"][dataset] = {"mongodb_rows": len(corpus["items"])}
                    except Exception as exc:
                        failures.extend(error_messages(exc))
                try:
                    ratios = await call(session, "get_premium_dataset", {"symbol": symbol, "dataset": "finance.ratio", "period_type": period_type, "limit": 3})
                    report["checks"]["finance.ratio"] = {"row_count": ratios.get("row_count"), "data_status": ratios.get("data_status"), "completeness": "not asserted; inspect units/descriptors before use"}
                except Exception as exc:
                    failures.extend(error_messages(exc))
                print(json.dumps({"status": "failed" if failures else "passed", **report, "failures": failures}, indent=2))
                require(not failures, "Structured-data acceptance failed; see per-dataset failures above")


try:
    asyncio.run(main())
except Exception as exc:
    print(json.dumps({"status": "failed", "symbol": symbol, "errors": error_messages(exc)}, indent=2), file=sys.stderr)
    raise SystemExit(1)
PY
