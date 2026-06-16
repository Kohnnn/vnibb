# N6V Database Consolidation Runbook

Target host: `desktop-8o94n6v` / `100.72.199.91`.

Goal: consolidate VNIBB runtime data onto the n6v Docker stack: MongoDB for vnstock/premium corpus, PostgreSQL for application relational data, Redis for cache/queues. This supersedes the older split plan that kept Supabase as production SQL/auth.

## Current Facts

- n6v MongoDB is reachable over Tailscale on `100.72.199.91:27017`.
- Mongo corpus is richer and fresher than Supabase for market data: `market_prices_eod` has 4.8M+ rows and dates through `2026-06-15`.
- `market_vnstock_premium_records` contains clean `finance.ratio` fields including `pe`, `pb`, `ps`, `roe`, `roa`.
- Docker control on n6v requires an interactive elevated PowerShell session on the n6v host. Do not try to run n6v Docker mutation commands from a remote non-elevated shell.

## Desired Runtime Shape

- `mongodb`: existing n6v market corpus, primary source for premium/eod market data.
- `postgres`: application SQL store replacing Supabase Postgres for VNIBB-owned tables. On this n6v host, Docker Desktop already occupies host port `5432`, so VNIBB Postgres is published on host port `15432` and container port `5432`.
- `supabase-selfhosted`: official Supabase Docker bundle staged inside the canonical VNIBB stack at `C:\vnibb-stack\supabase`. Kong/API/Studio uses host port `18000`, HTTPS uses `18443`, Supavisor session mode uses `15433`, and transaction mode uses `16543`.
- `redis`: cache and job coordination.
- Appwrite writes remain frozen during migration unless running a controlled export/backfill.
- Backend config after cutover: `DATA_BACKEND=hybrid`, `MONGODB_URL` to n6v Mongo, `DATABASE_URL` to n6v Postgres.

## Preflight From This Machine

Run from `vnibb/`:

```powershell
python -m py_compile apps/api/vnibb/services/data_pipeline.py apps/api/vnibb/services/rs_rating_service.py apps/api/scripts/full_stack_benchmark.py
python apps/api/scripts/full_stack_benchmark.py --base-url http://localhost:8000 --output-json artifacts/full_stack_benchmark.local.json
```

If the API is not running, start it first:

```powershell
python -m uvicorn vnibb.api.main:app --reload --app-dir apps/api
```

## On-Host N6V Provisioning

Run these only in an elevated PowerShell session on `desktop-8o94n6v`.

1. Verify Docker is available:

```powershell
docker ps
docker compose version
```

2. Create or update the n6v VNIBB compose file with services:

```yaml
services:
  vnibb-postgres:
    image: postgres:16-alpine
    container_name: vnibb-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: vnibb
      POSTGRES_USER: vnibb
      POSTGRES_PASSWORD: ${VNIBB_POSTGRES_PASSWORD}
    ports:
      - "15432:5432"
    volumes:
      - vnibb_postgres_data:/var/lib/postgresql/data

  vnibb-redis:
    image: redis:7-alpine
    container_name: vnibb-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - vnibb_redis_data:/data

volumes:
  vnibb_postgres_data:
  vnibb_redis_data:
```

3. Start services:

```powershell
docker compose --env-file .env up -d vnibb-postgres vnibb-redis
docker ps --filter name=vnibb-
```

## Self-Hosted Supabase Start

The official Supabase Docker bundle has been staged on n6v at `C:\vnibb-stack\supabase` with generated secrets and non-conflicting ports. If Docker pulls fail over SSH with `docker-credential-desktop`, run this from the interactive `KietLocalServer` PowerShell session:

```powershell
cd C:\vnibb-stack
docker compose --env-file .env -f supabase\docker-compose.yml pull
docker compose --env-file .env -f supabase\docker-compose.yml up -d
docker compose --env-file .env -f supabase\docker-compose.yml ps
```

Expected endpoints after startup:

```env
SUPABASE_URL=http://100.72.199.91:18000
SUPABASE_STUDIO=http://100.72.199.91:18000
SUPABASE_DB_POOLER_SESSION=postgres://postgres.vnibb:<password>@100.72.199.91:15433/postgres
SUPABASE_DB_POOLER_TRANSACTION=postgres://postgres.vnibb:<password>@100.72.199.91:16543/postgres
```

Hosted Supabase public data was copied into self-hosted Supabase using `apps/api/scripts/migrate_supabase_public_to_n6v.py` because hosted Supabase runs Postgres 17 and local/n6v `pg_dump` tooling was unavailable over SSH. The verified migration state is 34/34 `public` tables with matching row counts, including `stock_prices` at `1,731,826` rows and `screener_snapshots` at `169,586` rows.

Self-hosted REST verification:

```powershell
$anon = '<ANON_KEY from C:\vnibb-stack\.env>'
Invoke-WebRequest `
  -Uri 'http://100.72.199.91:18000/rest/v1/stocks?select=symbol&limit=3' `
  -Headers @{ apikey = $anon; Authorization = "Bearer $anon" }
```

4. Confirm ports from this machine after services are up:

```powershell
Test-NetConnection 100.72.199.91 -Port 15432
Test-NetConnection 100.72.199.91 -Port 6379
Test-NetConnection 100.72.199.91 -Port 27017
```

## Supabase Postgres Export And Restore

Use `pg_dump` from a machine with access to the current Supabase database.

```powershell
pg_dump "$env:SUPABASE_DATABASE_URL" --format=custom --no-owner --no-acl --file artifacts/supabase_public.dump
pg_restore --clean --if-exists --no-owner --no-acl --dbname "$env:N6V_DATABASE_URL" artifacts/supabase_public.dump
```

After restore:

```powershell
psql "$env:N6V_DATABASE_URL" -c "select table_name from information_schema.tables where table_schema='public' order by table_name;"
psql "$env:N6V_DATABASE_URL" -c "select count(*) from screener_snapshots;"
```

## Post-Restore Cleanup

- Reset stuck full-market sync rows before resuming jobs:

```sql
update sync_status
set status = 'failed', completed_at = now(), error_message = 'reset before n6v cutover'
where sync_type = 'full_market' and status = 'running';
```

- Review duplicate migration ledgers and keep one canonical path before the next schema migration.
- Review unused indexes after one full production day on n6v. Do not drop indexes during cutover.

## Cutover Config

Set deployment secrets after restore validation:

```powershell
DATABASE_URL=postgresql+asyncpg://vnibb:<password>@100.72.199.91:15432/vnibb
MONGODB_URL=mongodb://<user>:<password>@100.72.199.91:27017/<db>?authSource=admin
REDIS_URL=redis://100.72.199.91:6379/0
DATA_BACKEND=hybrid
APPWRITE_WRITE_ENABLED=false
ENABLE_AI_SENTIMENT_ANALYSIS=0
SUPABASE_URL=http://100.72.199.91:18000
SUPABASE_ANON_KEY=<ANON_KEY from C:\vnibb-stack\.env>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from C:\vnibb-stack\.env>
NEXT_PUBLIC_SUPABASE_URL=http://100.72.199.91:18000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from C:\vnibb-stack\.env>
```

## Validation Gate

Run after backend points at n6v:

```powershell
python apps/api/scripts/full_stack_benchmark.py --base-url http://localhost:8000 --repeats 3 --output-json artifacts/full_stack_benchmark.n6v.json --fail-on-error
pnpm --filter frontend lint
pnpm --filter frontend exec tsc --noEmit
```

Pass criteria:

- API health, live, ready endpoints pass.
- Screener probe returns rows with non-null `pe`, `pb`, and `ps` for symbols where source data exists.
- Historical prices are fresh through the latest n6v Mongo trading date.
- No `full_market` sync remains stuck in `running` state.
- Widget coverage JSON is generated for all registry widgets.
