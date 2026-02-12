$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path "$PSScriptRoot/.."
Set-Location $repoRoot

Write-Host "=== Frontend Lint ==="
pnpm --filter frontend lint

Write-Host "=== Frontend Build ==="
pnpm --filter frontend build

Write-Host "=== Frontend Tests ==="
pnpm --filter frontend test -- --runInBand

Write-Host "=== Backend Compile Check ==="
python -m py_compile "apps/api/vnibb/api/main.py"

Write-Host "=== Backend Tests ==="
python -m pytest "apps/api/tests" -v

Write-Host "✅ All gates passed"
