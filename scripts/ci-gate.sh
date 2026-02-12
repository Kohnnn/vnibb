#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "=== Frontend Lint ==="
pnpm --filter frontend lint

echo "=== Frontend Build ==="
pnpm --filter frontend build

echo "=== Frontend Tests ==="
pnpm --filter frontend test -- --runInBand

echo "=== Backend Compile Check ==="
python -m py_compile "apps/api/vnibb/api/main.py"

echo "=== Backend Tests ==="
python -m pytest "apps/api/tests" -v

echo "✅ All gates passed"
