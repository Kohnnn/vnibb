param(
  [int[]]$PreferredPorts = @(3000, 3001, 3002, 4000)
)

$ErrorActionPreference = 'SilentlyContinue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

$lockFile = Join-Path $projectRoot ".next\dev\lock"
if (Test-Path $lockFile) {
  try {
    $staleLock = Join-Path $projectRoot (".next\dev\lock.stale.{0}" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
    Move-Item -Path $lockFile -Destination $staleLock -Force
    Write-Host "Moved stale lock to $staleLock"
  } catch {
    Write-Host "Unable to move lock file, continuing with best effort."
  }
}

function Test-PortInUse([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $conn
}

$selectedPort = $null
foreach ($port in $PreferredPorts) {
  if (-not (Test-PortInUse $port)) {
    $selectedPort = $port
    break
  }
}

if (-not $selectedPort) {
  $selectedPort = 3005
}

Write-Host "Starting Next.js dev server on port $selectedPort"
pnpm exec next dev -p $selectedPort
