#!/bin/sh
set -eu

export PYTHONUNBUFFERED=1

python - <<'PY'
import importlib
import os
import sys

modules = ["uvicorn", "vnstock"]
modules.extend(
    module.strip()
    for module in os.getenv("VNSTOCK_PREMIUM_REQUIRED_MODULES", "").split(",")
    if module.strip()
)
missing = []
for module in modules:
    try:
        importlib.import_module(module)
    except Exception:
        missing.append(module)

if missing:
    print(f"Immutable runtime verification failed; missing modules: {','.join(missing)}", file=sys.stderr)
    raise SystemExit(1)
PY

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

APP_PORT="${PORT:-${WEB_PORT:-8000}}"
case "$APP_PORT" in
    ''|*[!0-9]*)
        APP_PORT="8000"
        ;;
esac

UVICORN_PROXY_HEADERS="${UVICORN_PROXY_HEADERS:-1}"
FORWARDED_ALLOW_IPS="${FORWARDED_ALLOW_IPS:-172.16.0.0/12}"

set -- -m uvicorn vnibb.api.main:app --host 0.0.0.0 --port "$APP_PORT"
case "$(printf '%s' "$UVICORN_PROXY_HEADERS" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
        set -- "$@" --proxy-headers --forwarded-allow-ips "$FORWARDED_ALLOW_IPS"
        ;;
esac

exec python "$@"
