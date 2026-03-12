#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-http://127.0.0.1:8000}}"
BASE_URL="${BASE_URL%/}"
TIMEOUT="${TIMEOUT:-10}"
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

check_status() {
  local label="$1"
  local path="$2"
  local expected="${3:-200}"
  local code

  code="$("$CURL_BIN" -ksS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" "${BASE_URL}${path}" || true)"
  printf '%-10s %s -> %s\n' "$label" "${BASE_URL}${path}" "$code"

  if [[ "$code" != "$expected" ]]; then
    status=1
  fi
}

echo "Oracle health check target: ${BASE_URL}"
check_status "live" "/live"
check_status "ready" "/ready"
check_status "health" "/health/"

if [[ -n "${CHECK_METRICS:-}" ]]; then
  metrics_code="$("$CURL_BIN" -ksS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" "${BASE_URL}/metrics" || true)"
  printf '%-10s %s -> %s\n' "metrics" "${BASE_URL}/metrics" "$metrics_code"
fi

exit "$status"
