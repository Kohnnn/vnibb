#!/usr/bin/env bash
set -euo pipefail

LB_PUBLIC_IP="${LB_PUBLIC_IP:-${1:-}}"
HOSTNAME="${HOSTNAME:-${2:-}}"
CORS_TEST_ORIGIN="${CORS_TEST_ORIGIN:-https://vnibb.vercel.app}"
TIMEOUT="${TIMEOUT:-15}"

if [[ -z "$LB_PUBLIC_IP" || -z "$HOSTNAME" ]]; then
  echo "Usage: LB_PUBLIC_IP=<ip> HOSTNAME=<host> bash scripts/oracle/lb_canary_validate.sh"
  echo "   or: bash scripts/oracle/lb_canary_validate.sh <lb_public_ip> <hostname>"
  exit 1
fi

CURL_BIN="curl"
if command -v curl.exe >/dev/null 2>&1; then
  CURL_BIN="curl.exe"
fi

status=0

check_path() {
  local label="$1"
  local path="$2"
  local code

  code="$($CURL_BIN -ksS -o /dev/null -w "%{http_code}" --http1.1 --max-time "$TIMEOUT" --resolve "${HOSTNAME}:443:${LB_PUBLIC_IP}" "https://${HOSTNAME}${path}" || true)"
  printf '%-18s https://%s%s -> %s\n' "$label" "$HOSTNAME" "$path" "$code"

  if [[ "$code" != "200" ]]; then
    status=1
  fi
}

echo "LB canary validate"
echo "  LB_PUBLIC_IP: ${LB_PUBLIC_IP}"
echo "  HOSTNAME:     ${HOSTNAME}"
echo

check_path "ready" "/ready"
check_path "live" "/live"
check_path "health" "/health/"
check_path "profile" "/api/v1/equity/VNM/profile"
check_path "quote" "/api/v1/equity/VNM/quote"
check_path "screener" "/api/v1/screener/?limit=5"

echo
echo "Checking CORS preflight"
headers="$($CURL_BIN -ksS -D - -o /dev/null --http1.1 --max-time "$TIMEOUT" --resolve "${HOSTNAME}:443:${LB_PUBLIC_IP}" -X OPTIONS "https://${HOSTNAME}/api/v1/equity/VNM/profile" -H "Origin: ${CORS_TEST_ORIGIN}" -H "Access-Control-Request-Method: GET" || true)"
printf '%s\n' "$headers"

if ! printf '%s\n' "$headers" | grep -qi "access-control-allow-origin: ${CORS_TEST_ORIGIN}"; then
  echo "CORS preflight did not return expected origin: ${CORS_TEST_ORIGIN}"
  status=1
fi

echo
if [[ "$status" -eq 0 ]]; then
  echo "LB canary validation passed"
else
  echo "LB canary validation failed"
fi

exit "$status"
