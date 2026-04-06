#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-http://127.0.0.1:8000}}"
BASE_URL="${BASE_URL%/}"
TIMEOUT="${TIMEOUT:-15}"
EXPECTED_DATA_BACKEND="${EXPECTED_DATA_BACKEND:-hybrid}"
EXPECTED_APPWRITE_WRITE_ENABLED="${EXPECTED_APPWRITE_WRITE_ENABLED:-false}"
EXPECTED_ANON_DASHBOARD_WRITES="${EXPECTED_ANON_DASHBOARD_WRITES:-true}"
DASHBOARD_CLIENT_ID="${DASHBOARD_CLIENT_ID:-browserlocalclient01}"
CURL_BIN="${CURL_BIN:-}"
status=0

if [[ -z "$CURL_BIN" ]]; then
  if command -v curl.exe >/dev/null 2>&1; then
    CURL_BIN="curl.exe"
  else
    CURL_BIN="curl"
  fi
fi

read_json_field() {
  local json_payload="$1"
  local field_path="$2"

  python - "$json_payload" "$field_path" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
path = sys.argv[2].split('.')
value = payload
for key in path:
    value = value[key]
if isinstance(value, bool):
    print(str(value).lower())
else:
    print(value)
PY
}

echo "Runtime verification target: ${BASE_URL}"

health_json="$($CURL_BIN -ksS --max-time "$TIMEOUT" "${BASE_URL}/health/")"
printf 'health payload -> %s

data_backend="$(read_json_field "$health_json" "providers.data_backend")"
appwrite_write_enabled="$(read_json_field "$health_json" "providers.appwrite_write_enabled")"
anon_dashboard_writes="$(read_json_field "$health_json" "providers.allow_anonymous_dashboard_writes")"

printf 'resolved data backend      -> %s
printf 'appwrite writes enabled    -> %s
printf 'anonymous dashboard writes -> %s

if [[ "$data_backend" != "$EXPECTED_DATA_BACKEND" ]]; then
  echo "Expected data backend ${EXPECTED_DATA_BACKEND}, got ${data_backend}"
  status=1
fi

if [[ "$appwrite_write_enabled" != "$EXPECTED_APPWRITE_WRITE_ENABLED" ]]; then
  echo "Expected appwrite_write_enabled=${EXPECTED_APPWRITE_WRITE_ENABLED}, got ${appwrite_write_enabled}"
  status=1
fi

if [[ "$anon_dashboard_writes" != "$EXPECTED_ANON_DASHBOARD_WRITES" ]]; then
  echo "Expected allow_anonymous_dashboard_writes=${EXPECTED_ANON_DASHBOARD_WRITES}, got ${anon_dashboard_writes}"
  status=1
fi

dashboard_code="$($CURL_BIN -ksS -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" \
  -H "X-VNIBB-Client-ID: ${DASHBOARD_CLIENT_ID}" \
  "${BASE_URL}/api/v1/dashboard/" || true)"
printf 'dashboard anon endpoint    -> %s

if [[ "$dashboard_code" != "200" ]]; then
  echo "Expected anonymous dashboard endpoint to return 200"
  status=1
fi

exit "$status"
