<#
.SYNOPSIS
  Disaster-recovery restore drill for the VNIBB PostgreSQL + MongoDB backups.

.DESCRIPTION
  Reproduces the verified restore sequence used to validate a backup set WITHOUT
  touching any production source. It spins up throwaway Docker containers, rechecks
  artifact SHA256 against the verification manifest, restores each dump into the
  container, asserts object-count parity, then tears the containers down.

  The PostgreSQL restore MUST use the Supabase image (roles like supabase_admin /
  supabase_vault exist in the dump and vanilla postgres:17 will error on them).
  Startup is a ~45s two-stage boot, so the readiness poll is generous.

  This script performs NO writes to any source system and exposes NO host ports.

.PARAMETER BackupId
  Backup set id, e.g. 20260721T181749Z. Defaults to the newest manifest found.

.PARAMETER BackupsDir
  Directory holding the dumps + BACKUP_VERIFICATION_<id>.json manifest.
  Defaults to <repo>/../backups.

.PARAMETER SkipPostgres
.PARAMETER SkipMongo
  Skip one engine (e.g. when only Docker image for the other is available).

.EXAMPLE
  pwsh ./scripts/restore-drill.ps1
  pwsh ./scripts/restore-drill.ps1 -BackupId 20260721T181749Z
#>
[CmdletBinding()]
param(
    [string]$BackupId,
    [string]$BackupsDir,
    [switch]$SkipPostgres,
    [switch]$SkipMongo
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
if (-not $BackupsDir) {
    $BackupsDir = (Resolve-Path "$repoRoot/../backups").Path
}
if (-not (Test-Path -LiteralPath $BackupsDir)) {
    throw "Backups directory not found: $BackupsDir"
}

if (-not $BackupId) {
    $manifest = Get-ChildItem -LiteralPath $BackupsDir -Filter 'BACKUP_VERIFICATION_*.json' |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $manifest) {
        throw "No BACKUP_VERIFICATION_*.json manifest found in $BackupsDir"
    }
    $BackupId = $manifest.Name -replace '^BACKUP_VERIFICATION_', '' -replace '\.json$', ''
}

$manifestPath = Join-Path $BackupsDir "BACKUP_VERIFICATION_$BackupId.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Manifest not found: $manifestPath"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

# --- helpers ---------------------------------------------------------------

function Get-Artifact {
    param([string]$Suffix)
    $a = $manifest.artifacts | Where-Object { $_.name -like "*$Suffix" } | Select-Object -First 1
    if (-not $a) { throw "No artifact matching *$Suffix in manifest $manifestPath" }
    $path = Join-Path $BackupsDir $a.name
    if (-not (Test-Path -LiteralPath $path)) { throw "Artifact missing on disk: $path" }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $a.sha256.ToLower()) {
        throw "SHA256 mismatch for $($a.name): manifest=$($a.sha256) actual=$actual"
    }
    Write-Host "  checksum ok: $($a.name)" -ForegroundColor DarkGreen
    return $path
}

function Remove-Container {
    param([string]$Name)
    docker rm -f $Name 2>$null | Out-Null
}

$pgImage = $manifest.verification.postgresql_isolated_restore.image
if (-not $pgImage) { $pgImage = 'supabase/postgres:17.6.1.136' }
$mongoImage = $manifest.verification.mongodb_isolated_restore.image
if (-not $mongoImage) { $mongoImage = 'mongo:7' }

$stamp = (Get-Date -Format 'yyyyMMddHHmmss')
$results = [ordered]@{}
$failures = @()

Write-Host "Restore drill for backup $BackupId" -ForegroundColor Cyan
Write-Host "  backups dir : $BackupsDir"
Write-Host "  pg image    : $pgImage"
Write-Host "  mongo image : $mongoImage"

# --- PostgreSQL ------------------------------------------------------------

if (-not $SkipPostgres) {
    $expected = [int]($manifest.verification.postgresql_isolated_restore.public_table_count_parity -split '/')[1]
    $pgDump = Get-Artifact -Suffix '.dump'
    $ctr = "vnibb-restore-drill-pg-$stamp"
    try {
        Write-Host "PostgreSQL restore into throwaway container $ctr" -ForegroundColor Cyan
        Remove-Container $ctr
        # No -p: container is reachable only via docker exec, never a host port.
        docker run -d --name $ctr -e POSTGRES_PASSWORD=drill $pgImage | Out-Null

        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 2
            docker exec $ctr pg_isready -U supabase_admin -d postgres 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        }
        if (-not $ready) { throw "PostgreSQL did not become ready within 120s" }

        Get-Content -LiteralPath $pgDump -AsByteStream |
            docker exec -i $ctr pg_restore -U supabase_admin -d postgres --no-owner --clean --if-exists 2>&1 |
            Out-Null

        $count = docker exec $ctr psql -U supabase_admin -d postgres -tAc `
            "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
        $count = [int]($count | Select-Object -Last 1).Trim()

        $ok = ($count -eq $expected)
        $results['postgresql'] = "$count/$expected base tables ($([string]($ok ? 'pass' : 'FAIL')))"
        if (-not $ok) { $failures += "postgresql table parity $count/$expected" }
        Write-Host "  $($results['postgresql'])" -ForegroundColor ($ok ? 'Green' : 'Red')
    }
    finally {
        Remove-Container $ctr
    }
}

# --- MongoDB ---------------------------------------------------------------

if (-not $SkipMongo) {
    $expected = [int]($manifest.verification.mongodb_isolated_restore.collection_count_parity -split '/')[1]
    $mongoArchive = Get-Artifact -Suffix '.archive.gz'
    $db = $manifest.source.mongodb.database
    if (-not $db) { $db = 'vnibb-market' }
    $ctr = "vnibb-restore-drill-mongo-$stamp"
    try {
        Write-Host "MongoDB restore into throwaway container $ctr" -ForegroundColor Cyan
        Remove-Container $ctr
        docker run -d --name $ctr $mongoImage | Out-Null

        $ready = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 2
            docker exec $ctr mongosh --quiet --eval 'db.adminCommand("ping").ok' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        }
        if (-not $ready) { throw "MongoDB did not become ready within 60s" }

        Get-Content -LiteralPath $mongoArchive -AsByteStream |
            docker exec -i $ctr mongorestore --archive --gzip --drop 2>&1 | Out-Null

        $count = docker exec $ctr mongosh $db --quiet --eval 'db.getCollectionNames().length'
        $count = [int]($count | Select-Object -Last 1).Trim()

        $ok = ($count -eq $expected)
        $results['mongodb'] = "$count/$expected collections ($([string]($ok ? 'pass' : 'FAIL')))"
        if (-not $ok) { $failures += "mongodb collection parity $count/$expected" }
        Write-Host "  $($results['mongodb'])" -ForegroundColor ($ok ? 'Green' : 'Red')
    }
    finally {
        Remove-Container $ctr
    }
}

# --- summary ---------------------------------------------------------------

Write-Host ""
Write-Host "Restore drill summary ($BackupId)" -ForegroundColor Cyan
foreach ($k in $results.Keys) { Write-Host "  ${k}: $($results[$k])" }

if ($failures.Count -gt 0) {
    Write-Host "DRILL FAILED: $($failures -join '; ')" -ForegroundColor Red
    exit 1
}
Write-Host "DRILL PASSED" -ForegroundColor Green
