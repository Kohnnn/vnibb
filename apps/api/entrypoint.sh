#!/bin/sh
set -eu

export PYTHONUNBUFFERED=1

python - <<'PY'
import importlib
from importlib.util import find_spec
import os
import sys

runtime_tier = os.getenv("VNSTOCK_RUNTIME_TIER", "free").strip().lower()
if runtime_tier not in {"free", "golden"}:
    print("VNSTOCK_RUNTIME_TIER must be 'free' or 'golden'", file=sys.stderr)
    raise SystemExit(1)
source = os.getenv("VNSTOCK_SOURCE", "VCI").strip().upper()
if source != "VCI":
    print("VNSTOCK_SOURCE must be 'VCI'; alternate sources are disabled", file=sys.stderr)
    raise SystemExit(1)
if runtime_tier == "free":
    paid_modules = ("vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii")
    present = [name for name in paid_modules if find_spec(name) is not None]
    if present:
        print(
            f"Free runtime contains forbidden paid modules: {','.join(present)}. "
            "Rebuild the credential-free image and remove historical premium runtime mounts; "
            "do not import or authenticate these modules.",
            file=sys.stderr,
        )
        raise SystemExit(1)

modules = ["uvicorn", "vnstock"]
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
