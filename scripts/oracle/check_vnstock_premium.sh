#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.oracle.yml}"
REQUIRED_MODULES="${VNSTOCK_PREMIUM_REQUIRED_MODULES:-vnstock_data,vnstock_ta,vnstock_pipeline,vnstock_news,vnii}"

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

modules = [
    m.strip()
    for m in os.getenv("VNSTOCK_PREMIUM_REQUIRED_MODULES", "").split(",")
    if m.strip()
]
if not modules:
    print("No VNSTOCK_PREMIUM_REQUIRED_MODULES configured")
    sys.exit(1)

missing = []
for name in modules:
    try:
        module = importlib.import_module(name)
        print(f"{name}: OK version={getattr(module, \"__version__\", \"n/a\")}")
    except Exception as exc:
        print(f"{name}: MISSING ({type(exc).__name__}: {exc})")
        missing.append(name)

if missing:
    print(f"Missing premium modules: {\", \".join(missing)}")
    sys.exit(1)

print("All required premium modules are available")
PY
'
