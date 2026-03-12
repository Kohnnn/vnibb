$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path "$PSScriptRoot/.."
Set-Location $repoRoot

node ./scripts/ci-gate.mjs
