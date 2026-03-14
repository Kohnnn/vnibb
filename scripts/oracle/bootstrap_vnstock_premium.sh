#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.oracle.yml}"
ENV_FILE="${ENV_FILE:-deployment/env.oracle}"
REQUIRED_MODULES="${VNSTOCK_PREMIUM_REQUIRED_MODULES:-vnstock_data,vnstock_ta,vnstock_pipeline,vnstock_news,vnii}"
CHECK_ATTEMPTS="${CHECK_ATTEMPTS:-40}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-15}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE"
  exit 1
fi

api_key_value="$(awk -F= '/^VNSTOCK_API_KEY=/{print $2}' "$ENV_FILE" | tail -n1)"
if [[ -z "$api_key_value" || "$api_key_value" == "your-vnstock-api-key" ]]; then
  echo "VNSTOCK_API_KEY is missing or placeholder in $ENV_FILE"
  exit 1
fi

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

check_modules() {
  docker compose -f "$COMPOSE_FILE" exec -T -e "VNSTOCK_PREMIUM_REQUIRED_MODULES=$REQUIRED_MODULES" api sh -lc '
PY_BIN="python3"
if [ -x /root/.venv/bin/python ] && PYTHONPATH="" /root/.venv/bin/python -c "import uvicorn" >/dev/null 2>&1; then
  PY_BIN="/root/.venv/bin/python"
fi
echo "Using interpreter: $PY_BIN"
"$PY_BIN" - <<'"'"'PY'"'"'
import importlib
import os
import sys

modules = [m.strip() for m in os.getenv("VNSTOCK_PREMIUM_REQUIRED_MODULES", "").split(",") if m.strip()]
if not modules:
    print("No VNSTOCK_PREMIUM_REQUIRED_MODULES configured")
    sys.exit(1)

missing = []
for name in modules:
    try:
        importlib.import_module(name)
        print(f"{name}: OK")
    except Exception as exc:
        missing.append(name)
        print(f"{name}: MISSING ({type(exc).__name__}: {exc})")

if missing:
    sys.exit(1)
PY
'
}

echo "Checking current premium module availability"
if check_modules; then
  echo "Premium modules already available. Keeping steady-state runtime mode."
  set_env "VNSTOCK_RUNTIME_INSTALL" "0"
  docker compose -f "$COMPOSE_FILE" up -d --force-recreate api
  exit 0
fi

echo "Configuring VNStock premium bootstrap in $ENV_FILE"
set_env "VNSTOCK_RUNTIME_INSTALL" "1"
set_env "VNSTOCK_AUTO_BOOTSTRAP_ON_MISSING" "1"
set_env "VNSTOCK_AUTO_BOOTSTRAP_MAX_FAILED_ATTEMPTS" "50"
set_env "VNSTOCK_PREMIUM_REQUIRED_MODULES" "$REQUIRED_MODULES"

echo "Resetting bootstrap state files"
docker compose -f "$COMPOSE_FILE" exec -T api sh -lc 'rm -f /root/.vnstock/runtime_state/last_bootstrap_attempt.epoch /root/.vnstock/runtime_state/bootstrap_failed_count.int /root/.vnstock/runtime_state/bootstrap.lock.epoch; rm -rf /root/.vnstock/runtime_state/bootstrap.lock' || true

echo "Recreating API container to trigger installer"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate api

echo "Waiting for premium modules to become available"
attempt=1
while [[ "$attempt" -le "$CHECK_ATTEMPTS" ]]; do
  echo "Check attempt $attempt/$CHECK_ATTEMPTS"
  if check_modules; then
    echo "Premium modules detected. Locking steady-state runtime mode."
    set_env "VNSTOCK_RUNTIME_INSTALL" "0"
    docker compose -f "$COMPOSE_FILE" up -d --force-recreate api
    echo "Final premium status:"
    check_modules
    echo "Bootstrap complete."
    exit 0
  fi

  sleep "$CHECK_INTERVAL_SECONDS"
  attempt=$((attempt + 1))
done

echo "Premium modules still missing after ${CHECK_ATTEMPTS} checks."
echo "Review logs for device quota or installer failures:"
echo "  docker compose -f $COMPOSE_FILE logs api --tail=400"
echo "If needed, free devices at https://vnstocks.com/account?section=devices then rerun this script."
exit 1
