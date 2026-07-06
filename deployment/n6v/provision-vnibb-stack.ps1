param(
    [string]$WorkDir = "C:\\vnibb-stack",
    [string]$PostgresPassword = $env:VNIBB_POSTGRES_PASSWORD,
    [string]$PostgresPort = "15432",
    [string]$RedisPort = "6379"
)

$ErrorActionPreference = "Stop"

if (-not $PostgresPassword) {
    throw "VNIBB_POSTGRES_PASSWORD is required. Pass -PostgresPassword or set the env var."
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

$composePath = Join-Path $WorkDir "docker-compose.vnibb.yml"
$envPath = Join-Path $WorkDir ".env"

@"
VNIBB_POSTGRES_PASSWORD=$PostgresPassword
VNIBB_POSTGRES_PORT=$PostgresPort
VNIBB_REDIS_PORT=$RedisPort
"@ | Set-Content -Path $envPath -Encoding UTF8

@"
services:
  vnibb-postgres:
    image: postgres:16-alpine
    container_name: vnibb-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: vnibb
      POSTGRES_USER: vnibb
      POSTGRES_PASSWORD: `${VNIBB_POSTGRES_PASSWORD}
    ports:
      - "`${VNIBB_POSTGRES_PORT:-5432}:5432"
    volumes:
      - vnibb_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vnibb -d vnibb"]
      interval: 10s
      timeout: 5s
      retries: 10

  vnibb-redis:
    image: redis:7-alpine
    container_name: vnibb-redis
    restart: unless-stopped
    ports:
      - "`${VNIBB_REDIS_PORT:-6379}:6379"
    volumes:
      - vnibb_redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  vnibb_postgres_data:
  vnibb_redis_data:
"@ | Set-Content -Path $composePath -Encoding UTF8

docker compose --env-file $envPath -f $composePath up -d
docker ps --filter "name=vnibb-"

Write-Host "VNIBB n6v stack provisioned in $WorkDir"
Write-Host "DATABASE_URL=postgresql+asyncpg://vnibb:<password>@<n6v-tailscale-ip>:$PostgresPort/vnibb"
Write-Host "REDIS_URL=redis://<n6v-tailscale-ip>:$RedisPort/0"
