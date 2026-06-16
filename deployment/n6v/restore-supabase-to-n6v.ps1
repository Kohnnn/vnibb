param(
    [Parameter(Mandatory=$true)] [string]$SupabaseDatabaseUrl,
    [Parameter(Mandatory=$true)] [string]$N6vDatabaseUrl,
    [string]$DumpPath = "C:\\vnibb-stack\\supabase_public.dump"
)

$ErrorActionPreference = "Stop"

$dumpDir = Split-Path -Parent $DumpPath
New-Item -ItemType Directory -Force -Path $dumpDir | Out-Null

pg_dump $SupabaseDatabaseUrl --format=custom --no-owner --no-acl --file $DumpPath
pg_restore --clean --if-exists --no-owner --no-acl --dbname $N6vDatabaseUrl $DumpPath

psql $N6vDatabaseUrl -c "select table_name from information_schema.tables where table_schema='public' order by table_name;"
psql $N6vDatabaseUrl -c "select count(*) as screener_snapshots from screener_snapshots;"

Write-Host "Restore complete from Supabase to n6v Postgres. Dump: $DumpPath"
