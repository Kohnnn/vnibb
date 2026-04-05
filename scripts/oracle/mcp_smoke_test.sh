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

TIMEOUT="${TIMEOUT:-15}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.oracle.yml}"
MCP_SHARED_TOKEN="${VNIBB_MCP_SHARED_BEARER_TOKEN:-}"
PYTHON_MODE="${PYTHON_MODE:-auto}"
CURL_BIN="${CURL_BIN:-}"
NULL_SINK="/dev/null"
status=0

if [[ -z "$CURL_BIN" ]]; then
  if command -v curl.exe >/dev/null 2>&1; then
    CURL_BIN="curl.exe"
  else
    CURL_BIN="curl"
  fi
fi

if [[ "$CURL_BIN" == "curl.exe" ]]; then
  NULL_SINK="NUL"
fi

echo "VNIBB MCP smoke target: ${BASE_URL}"

health_code="$($CURL_BIN -ksS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" "$HEALTH_URL" || true)"
printf '%-14s %s -> %s\n' "mcp_health" "$HEALTH_URL" "$health_code"
if [[ "$health_code" != "200" ]]; then
  status=1
fi

mcp_code="$($CURL_BIN -ksS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" "$MCP_URL" || true)"
printf '%-14s %s -> %s\n' "mcp_path" "$MCP_URL" "$mcp_code"
if [[ "$mcp_code" == "000" ]]; then
  status=1
fi

pick_python_mode() {
  if [[ "$PYTHON_MODE" != "auto" ]]; then
    printf '%s' "$PYTHON_MODE"
    return
  fi

  if command -v docker >/dev/null 2>&1 && [[ -f "$COMPOSE_FILE" ]]; then
    if docker compose -f "$COMPOSE_FILE" ps mcp >/dev/null 2>&1; then
      printf '%s' "container"
      return
    fi
  fi

  for candidate in python python3 py; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c "import mcp" >/dev/null 2>&1; then
        printf '%s' "host:${candidate}"
        return
      fi
    fi
  done

  printf '%s' "none"
}

run_python_probe() {
  local mode
  mode="$(pick_python_mode)"

  if [[ "$mode" == "none" ]]; then
    echo "MCP probe skipped: no usable Python+mcp client was found"
    return 1
  fi

  if [[ "$mode" == "container" ]]; then
    docker compose -f "$COMPOSE_FILE" exec -T mcp python - "$MCP_URL" "$MCP_SHARED_TOKEN" <<'PY'
import asyncio
import json
import sys

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

url = sys.argv[1]
token = sys.argv[2]
headers = {}
if token:
    headers["Authorization"] = f"Bearer {token}"


async def main() -> int:
    async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(15.0), follow_redirects=True) as client:
        async with streamable_http_client(url, http_client=client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                result = await session.call_tool("get_appwrite_status", arguments={})
                if result.isError:
                    print("MCP tool call returned an error")
                    return 1
                payload = result.structuredContent or {}
                print(
                    json.dumps(
                        {
                            "status": "ok",
                            "tool_count": len(tools.tools),
                            "connectivity": payload.get("connectivity"),
                        },
                        indent=2,
                    )
                )
                return 0


raise SystemExit(asyncio.run(main()))
PY
    return $?
  fi

  local python_bin
  python_bin="${mode#host:}"
  "$python_bin" - "$MCP_URL" "$MCP_SHARED_TOKEN" <<'PY'
import asyncio
import json
import sys

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

url = sys.argv[1]
token = sys.argv[2]
headers = {}
if token:
    headers["Authorization"] = f"Bearer {token}"


async def main() -> int:
    async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(15.0), follow_redirects=True) as client:
        async with streamable_http_client(url, http_client=client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                result = await session.call_tool("get_appwrite_status", arguments={})
                if result.isError:
                    print("MCP tool call returned an error")
                    return 1
                payload = result.structuredContent or {}
                print(
                    json.dumps(
                        {
                            "status": "ok",
                            "tool_count": len(tools.tools),
                            "connectivity": payload.get("connectivity"),
                        },
                        indent=2,
                    )
                )
                return 0


raise SystemExit(asyncio.run(main()))
PY
}

echo "Running MCP initialize + tool probe"
if ! run_python_probe; then
  status=1
fi

exit "$status"
