#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-http://127.0.0.1:8000}}"
BASE_URL="${BASE_URL%/}"
TIMEOUT="${TIMEOUT:-15}"
EXPECTED_DATA_BACKEND="${EXPECTED_DATA_BACKEND:-hybrid}"
EXPECTED_APPWRITE_WRITE_ENABLED="${EXPECTED_APPWRITE_WRITE_ENABLED:-false}"
EXPECTED_ANON_DASHBOARD_WRITES="${EXPECTED_ANON_DASHBOARD_WRITES:-true}"
EXPECTED_RELEASE_REVISION="${EXPECTED_RELEASE_REVISION:-}"
EXPECTED_IMAGE_REPOSITORY="${EXPECTED_IMAGE_REPOSITORY:-${VNIBB_API_IMAGE_REPOSITORY:-}}"
EXPECTED_IMAGE_DIGEST="${EXPECTED_IMAGE_DIGEST:-${VNIBB_API_IMAGE_DIGEST:-}}"
API_CONTAINER_NAME="${API_CONTAINER_NAME:-vnibb-api}"
DASHBOARD_CLIENT_ID="${DASHBOARD_CLIENT_ID:-browserlocalclient01}"
CORS_TEST_ORIGIN="${CORS_TEST_ORIGIN:-https://vnibb-web.vercel.app}"
CURL_BIN="${CURL_BIN:-}"
PYTHON_BIN="${PYTHON_BIN:-}"
NULL_SINK="/dev/null"
status=0

if [[ -z "$CURL_BIN" ]]; then
  if command -v curl.exe >/dev/null 2>&1; then
    CURL_BIN="curl.exe"
    NULL_SINK="NUL"
  else
    CURL_BIN="curl"
  fi
fi

if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python python3 py; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$PYTHON_BIN" ]]; then
  echo "No python interpreter found on PATH for runtime_verify.sh"
  exit 1
fi

read_json_field() {
  local json_payload="$1"
  local field_path="$2"

  "$PYTHON_BIN" - "$json_payload" "$field_path" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
value = payload
for key in sys.argv[2].split('.'):
    value = value[key]
if isinstance(value, bool):
    print(str(value).lower())
else:
    print(value)
PY
}

echo "Runtime verification target: ${BASE_URL}"

health_json="$($CURL_BIN -ksS --max-time "$TIMEOUT" "${BASE_URL}/health/")"
printf 'health payload -> %s\n' "$health_json"

data_backend="$(read_json_field "$health_json" "providers.data_backend")"
appwrite_write_enabled="$(read_json_field "$health_json" "providers.appwrite_write_enabled")"
anon_dashboard_writes="$(read_json_field "$health_json" "providers.allow_anonymous_dashboard_writes")"
release_revision="$(read_json_field "$health_json" "revision")"

printf 'resolved data backend      -> %s\n' "$data_backend"
printf 'appwrite writes enabled    -> %s\n' "$appwrite_write_enabled"
printf 'anonymous dashboard writes -> %s\n' "$anon_dashboard_writes"
printf 'release revision           -> %s\n' "$release_revision"

if [[ -n "$EXPECTED_RELEASE_REVISION" && "$release_revision" != "$EXPECTED_RELEASE_REVISION" ]]; then
  echo "Expected release revision ${EXPECTED_RELEASE_REVISION}, got ${release_revision}"
  status=1
fi

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

if [[ -n "$EXPECTED_IMAGE_REPOSITORY$EXPECTED_IMAGE_DIGEST" ]]; then
  if [[ -z "$EXPECTED_IMAGE_REPOSITORY" || -z "$EXPECTED_IMAGE_DIGEST" ]]; then
    echo "Set both EXPECTED_IMAGE_REPOSITORY and EXPECTED_IMAGE_DIGEST to verify the deployed image"
    status=1
  elif ! command -v docker >/dev/null 2>&1; then
    echo "Docker unavailable; cannot verify deployed image digest"
    status=1
  else
    expected_image="${EXPECTED_IMAGE_REPOSITORY}@${EXPECTED_IMAGE_DIGEST}"
    if ! configured_image="$(docker inspect --format '{{.Config.Image}}' "$API_CONTAINER_NAME" 2>/dev/null)"; then
      echo "Unable to inspect deployed API container ${API_CONTAINER_NAME} for image digest verification"
      status=1
    elif [[ "$configured_image" != "$expected_image" ]]; then
      echo "Expected configured image ${expected_image}, got ${configured_image}"
      status=1
    else
      printf 'configured image digest   -> %s\n' "$EXPECTED_IMAGE_DIGEST"
    fi
  fi
fi

dashboard_code="$($CURL_BIN -ksS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" \
  -H "X-VNIBB-Client-ID: ${DASHBOARD_CLIENT_ID}" \
  "${BASE_URL}/api/v1/dashboard/" || true)"
printf 'dashboard anon endpoint    -> %s\n' "$dashboard_code"

if [[ "$dashboard_code" != "200" ]]; then
  echo "Expected anonymous dashboard endpoint to return 200"
  status=1
fi

cors_headers="$($CURL_BIN -ksS -D - -o "$NULL_SINK" --max-time "$TIMEOUT" \
  -X OPTIONS "${BASE_URL}/api/v1/dashboard/" \
  -H "Origin: ${CORS_TEST_ORIGIN}" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: X-VNIBB-Client-ID" || true)"

printf 'dashboard cors preflight   -> %s\n' "$CORS_TEST_ORIGIN"

if ! printf '%s\n' "$cors_headers" | grep -qi "access-control-allow-origin: ${CORS_TEST_ORIGIN}"; then
  echo "Expected dashboard CORS preflight to allow origin ${CORS_TEST_ORIGIN}"
  status=1
fi

if ! printf '%s\n' "$cors_headers" | grep -qi "access-control-allow-headers: .*x-vnibb-client-id"; then
  echo "Expected dashboard CORS preflight to allow X-VNIBB-Client-ID"
  status=1
fi

if [[ -n "${MCP_HEALTH_URL:-}" ]]; then
  mcp_code="$($CURL_BIN -ksS -o "$NULL_SINK" -w "%{http_code}" --max-time "$TIMEOUT" \
    "${MCP_HEALTH_URL}" || true)"
  printf 'mcp health endpoint        -> %s\n' "$mcp_code"
  if [[ "$mcp_code" != "200" ]]; then
    echo "Expected MCP health endpoint ${MCP_HEALTH_URL} to return 200"
    status=1
  fi
fi

exit "$status"
