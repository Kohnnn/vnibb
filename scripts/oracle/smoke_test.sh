#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-http://127.0.0.1:8000}}"
BASE_URL="${BASE_URL%/}"
WS_URL="${WS_URL:-${BASE_URL/http/ws}/api/v1/ws/prices}"
TIMEOUT="${TIMEOUT:-15}"
CORS_TEST_ORIGIN="${CORS_TEST_ORIGIN:-}"
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

if [[ -z "$CORS_TEST_ORIGIN" ]]; then
  case "$BASE_URL" in
    http://127.0.0.1:*|http://localhost:*)
      CORS_TEST_ORIGIN="http://localhost:3000"
      ;;
    *)
      CORS_TEST_ORIGIN="https://vnibb-web.vercel.app"
      ;;
  esac
fi

expect_ok() {
  local label="$1"
  local path="$2"
  local code

  code="$("$CURL_BIN" -ksS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" "${BASE_URL}${path}" || true)"
  printf '%-18s %s -> %s\n' "$label" "${BASE_URL}${path}" "$code"
  if [[ "$code" != "200" ]]; then
    status=1
  fi
}

echo "Oracle smoke test target: ${BASE_URL}"
expect_ok "live" "/live"
expect_ok "ready" "/ready"
expect_ok "health" "/health/"
expect_ok "api_health" "/api/v1/health"
expect_ok "profile" "/api/v1/equity/VNM/profile"
expect_ok "quote" "/api/v1/equity/VNM/quote"
expect_ok "screener" "/api/v1/screener/?limit=5"

echo "Checking CORS preflight"
cors_headers="$("$CURL_BIN" -ksS -D - -o "$NULL_SINK" --max-time "$TIMEOUT" \
  -X OPTIONS "${BASE_URL}/api/v1/equity/VNM/profile" \
  -H "Origin: ${CORS_TEST_ORIGIN}" \
  -H "Access-Control-Request-Method: GET" || true)"
printf '%s\n' "$cors_headers"
if ! printf '%s\n' "$cors_headers" | grep -qi "access-control-allow-origin: ${CORS_TEST_ORIGIN}"; then
  echo "CORS preflight did not return the expected origin: ${CORS_TEST_ORIGIN}"
  status=1
fi

PYTHON_BIN=""
for candidate in python python3 py; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done

if [[ -n "$PYTHON_BIN" ]]; then
  echo "Optional websocket probe: ${WS_URL}"
  "$PYTHON_BIN" - "${WS_URL}" <<'PY' || status=1
import asyncio
import importlib.util
import sys

if importlib.util.find_spec("websockets") is None:
    print("SKIP websocket probe: python package 'websockets' is not installed")
    raise SystemExit(0)

import websockets

ws_url = sys.argv[1]

async def main() -> int:
    try:
        async with websockets.connect(ws_url, ping_timeout=5, close_timeout=5):
            print(f"Websocket probe passed: {ws_url}")
            return 0
    except Exception as exc:
        print(f"Websocket probe failed: {exc}")
        return 1

raise SystemExit(asyncio.run(main()))
PY
else
  echo "SKIP websocket probe: no python interpreter is available on PATH for this shell"
fi

exit "$status"
