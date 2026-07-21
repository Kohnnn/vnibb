param(
    [string]$MongoUri = $env:MONGODB_URL,
    [string]$MongoDatabase = $(if ($env:MONGODB_DATABASE) { $env:MONGODB_DATABASE } else { "vnibb-market" }),
    [string]$BackupDir = "C:\vnibb-backups\market-lake",
    [string]$BronzePath = $(if ($env:VNIBB_BRONZE_PATH) { $env:VNIBB_BRONZE_PATH } elseif ($env:VNIBB_BRONZE_ROOT) { $env:VNIBB_BRONZE_ROOT } else { "C:\vnibb-market-lake\bronze" }),
    [string]$BronzeRunId = $env:VNIBB_BRONZE_RUN_ID,
    [ValidateRange(1, 100)] [int]$ReadDataSubsetPercent = 5
)

$ErrorActionPreference = "Stop"

function Require-Value([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name is required. Set it in the environment or pass the matching parameter."
    }
}

function Get-CommittedBronzeRun([string]$Path, [string]$RunId) {
    $inputPath = Get-Item -LiteralPath ([System.IO.Path]::GetFullPath($Path)) -ErrorAction Stop
    $run = if (Test-Path -LiteralPath (Join-Path $inputPath.FullName "COMPLETE") -PathType Leaf) {
        if (-not [string]::IsNullOrWhiteSpace($RunId)) {
            throw "BronzeRunId cannot be used when BronzePath is a committed run: $($inputPath.FullName)"
        }
        $inputPath
    } else {
        $runsRoot = Join-Path $inputPath.FullName "runs"
        if (-not (Test-Path -LiteralPath $runsRoot -PathType Container)) {
            throw "BronzePath must be a committed run or a Bronze root containing runs: $($inputPath.FullName)"
        }
        if ([string]::IsNullOrWhiteSpace($RunId)) {
            Get-ChildItem -LiteralPath $runsRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "COMPLETE") } | Sort-Object Name -Descending | Select-Object -First 1
        } else {
            Get-Item -LiteralPath (Join-Path $runsRoot $RunId) -ErrorAction Stop
        }
    }
    if ($null -eq $run -or -not $run.PSIsContainer) {
        throw "No committed Bronze run was found under $($inputPath.FullName)"
    }
    $completePath = Join-Path $run.FullName "COMPLETE"
    $manifestPath = Join-Path $run.FullName "manifest.json"
    if (-not (Test-Path -LiteralPath $completePath -PathType Leaf) -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Bronze run is incomplete: $($run.FullName)"
    }
    $complete = Get-Content -LiteralPath $completePath -Raw | ConvertFrom-Json
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($complete.manifest_sha256) -or $manifest.files.Count -lt 1) {
        throw "Bronze run manifest is invalid: $($run.FullName)"
    }
    $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestHash -ne $complete.manifest_sha256.ToLowerInvariant()) {
        throw "Bronze run manifest checksum does not match COMPLETE: $($run.FullName)"
    }
    $records = 0
    foreach ($file in $manifest.files) {
        if ([string]::IsNullOrWhiteSpace($file.path) -or [string]::IsNullOrWhiteSpace($file.sha256) -or $file.records -lt 1) {
            throw "Bronze manifest file entry is invalid: $($run.FullName)"
        }
        $fragmentPath = Join-Path $run.FullName $file.path
        if (-not (Test-Path -LiteralPath $fragmentPath -PathType Leaf)) {
            throw "Bronze fragment is missing: $fragmentPath"
        }
        $fragmentHash = (Get-FileHash -LiteralPath $fragmentPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($fragmentHash -ne $file.sha256.ToLowerInvariant()) {
            throw "Bronze fragment checksum mismatch: $fragmentPath"
        }
        $records += [int64]$file.records
    }
    if ($records -ne [int64]$manifest.records) {
        throw "Bronze manifest record count mismatch: $($run.FullName)"
    }
    return $run.FullName
}

Require-Value "MongoUri" $MongoUri
Require-Value "MongoDatabase" $MongoDatabase
Require-Value "RESTIC_REPOSITORY" $env:RESTIC_REPOSITORY
if ([string]::IsNullOrWhiteSpace($env:RESTIC_PASSWORD_FILE) -and [string]::IsNullOrWhiteSpace($env:RESTIC_PASSWORD_COMMAND)) {
    throw "RESTIC_PASSWORD_FILE or RESTIC_PASSWORD_COMMAND is required."
}

$mongodump = Get-Command mongodump -ErrorAction Stop
$restic = Get-Command restic -ErrorAction Stop
$bronzeRun = Get-CommittedBronzeRun $BronzePath $BronzeRunId
$backupRoot = [System.IO.Path]::GetFullPath($BackupDir)
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$timestamp = Get-Date -Format "yyyyMMddTHHmmssZ"
$dumpPath = Join-Path $backupRoot "market_prices_eod-$timestamp.archive.gz"

& $mongodump.Source --uri $MongoUri --db $MongoDatabase --collection "market_prices_eod" --archive=$dumpPath --gzip
if ($LASTEXITCODE -ne 0) {
    throw "mongodump failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $dumpPath) -or (Get-Item -LiteralPath $dumpPath).Length -eq 0) {
    throw "mongodump did not produce a non-empty archive."
}

$backupOutput = & $restic.Source backup $dumpPath $bronzeRun --tag "vnibb" --tag "market-lake" --tag "mongo-eod" --tag "bronze-eod" --json 2>&1
$backupExitCode = $LASTEXITCODE
if ($backupExitCode -ne 0) {
    throw "restic backup failed with exit code $backupExitCode."
}
$backupSummary = $backupOutput |
    ForEach-Object {
        try { $_ | ConvertFrom-Json } catch { $null }
    } |
    Where-Object { $_.message_type -eq "summary" } |
    Select-Object -Last 1
$snapshotId = [string]$backupSummary.snapshot_id
if ([string]::IsNullOrWhiteSpace($snapshotId)) {
    throw "restic backup did not report a snapshot ID."
}
$snapshotOutput = & $restic.Source snapshots --json $snapshotId 2>&1
$snapshotExitCode = $LASTEXITCODE
if ($snapshotExitCode -ne 0) {
    throw "restic snapshots failed with exit code $snapshotExitCode."
}
$snapshots = ($snapshotOutput -join "`n") | ConvertFrom-Json
$matchingSnapshots = @($snapshots | Where-Object { $_.id -eq $snapshotId -or $_.short_id -eq $snapshotId })
if ($matchingSnapshots.Count -ne 1) {
    throw "restic did not return exactly one backup snapshot for $snapshotId."
}
$snapshot = $matchingSnapshots[0]
$expectedPaths = @($dumpPath, $bronzeRun)
foreach ($expectedPath in $expectedPaths) {
    if ($snapshot.paths -notcontains $expectedPath) {
        throw "Backup snapshot $snapshotId does not contain $expectedPath."
    }
}
& $restic.Source check --read-data-subset "$ReadDataSubsetPercent%"
if ($LASTEXITCODE -ne 0) {
    throw "restic check failed with exit code $LASTEXITCODE."
}

Remove-Item -LiteralPath $dumpPath -Force
Write-Host "Backup and Restic check complete. Snapshot: $snapshotId Bronze run: $bronzeRun"
