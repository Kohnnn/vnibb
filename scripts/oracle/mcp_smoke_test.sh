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
SCRIPT_DIR="$(dirname -- "${BASH_SOURCE[0]}")"
EXPECTED_REVISION="${EXPECTED_REVISION:?Set EXPECTED_REVISION to the exact deployed commit before acceptance}"
compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

if [[ "$PYTHON_MODE" == "auto" ]]; then
  PYTHON_MODE=none
  for candidate in python3 python py; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import mcp, httpx, jsonschema' >/dev/null 2>&1; then
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

echo "VNIBB MCP protocol smoke: authenticated read-only acceptance, runtime=${PYTHON_MODE}"
# Reuse the acceptance client; never echo endpoint credentials or bearer values.
"${command[@]}" - --mcp-url "$MCP_URL" --health-url "$HEALTH_URL" --symbol "$SYMBOL" --period-type "$PERIOD_TYPE" --timeout "$TIMEOUT" --expected-revision "$EXPECTED_REVISION" --smoke < "${SCRIPT_DIR}/mcp_acceptance.py"
