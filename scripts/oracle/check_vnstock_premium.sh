#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.oracle.yml}"

docker compose -f "$COMPOSE_FILE" exec -T api python - <<'PY'
import importlib

modules = ["vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii"]
for name in modules:
    try:
        module = importlib.import_module(name)
        print(f"{name}: OK version={getattr(module, '__version__', 'n/a')}")
    except Exception as exc:
        print(f"{name}: MISSING ({type(exc).__name__}: {exc})")
PY
