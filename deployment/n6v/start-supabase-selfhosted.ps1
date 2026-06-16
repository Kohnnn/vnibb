$ErrorActionPreference = "Stop"

$project = "C:\vnibb-stack"
if (-not (Test-Path -LiteralPath $project)) {
    throw "Missing $project. The VNIBB stack must be staged before running this script."
}

$supabaseCompose = Join-Path $project "supabase\docker-compose.yml"
if (-not (Test-Path -LiteralPath $supabaseCompose)) {
    throw "Missing $supabaseCompose. The Supabase Docker bundle must live under C:\vnibb-stack\supabase."
}

Set-Location $project

Write-Host "Starting self-hosted Supabase from $project"
Write-Host "Ports: Kong/API/Studio 18000, HTTPS 18443, pooler session 15433, pooler transaction 16543"

docker compose --env-file .env -f supabase\docker-compose.yml pull
docker compose --env-file .env -f supabase\docker-compose.yml up -d
docker compose --env-file .env -f supabase\docker-compose.yml ps

Write-Host ""
Write-Host "Supabase URL: http://100.72.199.91:18000"
Write-Host "Studio login: read DASHBOARD_USERNAME and DASHBOARD_PASSWORD from C:\vnibb-stack\.env"
Write-Host "Postgres pooler session: 100.72.199.91:15433"
Write-Host "Postgres pooler transaction: 100.72.199.91:16543"
