# Oracle Runbook

## 1. Provision Oracle VM

### Recommended shape

- Preferred: Oracle Always Free Ampere A1 VM
- Fallback: an Always Free x86 VM if Ampere capacity is unavailable

### Recommended OS

- Ubuntu 24.04 LTS

### Boot volume guidance

- Keep the boot volume lean and avoid extra paid block volumes unless necessary.
- Use Docker volumes for runtime state that must survive container recreation.

### Public IP guidance

- Attach a reserved public IP so DNS cutover does not depend on a transient address.

### SSH restriction

- Restrict port `22` to operator IP ranges only.

### Base package install

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg ufw git jq
```

### Docker install

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

## 2. Configure Network

- Allow inbound `80/tcp` from `0.0.0.0/0`
- Allow inbound `443/tcp` from `0.0.0.0/0`
- Restrict inbound `22/tcp` to operator IPs
- Do not expose `8000/tcp` publicly
- Create DNS records for:
  - stable hostname: `api.example.com`
  - canary hostname: `oracle-api.example.com`

## 3. Deploy Runtime

### Prepare deployment files

```bash
cp deployment/env.oracle.example deployment/env.oracle
```

Edit `deployment/env.oracle` and set:

- `SITE_HOSTNAME`
- `ACME_EMAIL`
- `DATABASE_URL`
- `DATABASE_URL_SYNC`
- `DATA_BACKEND=hybrid`
- `APPWRITE_WRITE_ENABLED=false` for the current month
- `ALLOW_ANONYMOUS_DASHBOARD_WRITES=true`
- `MONGODB_URL` for shared market/raw analytical records used by microstructure widgets
- `MONGODB_DATABASE=vnibb-market`
- `MONGODB_ENABLED=true`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`
- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`
- `APPWRITE_API_KEY`
- `APPWRITE_DATABASE_ID` (reuse the existing VNIBB database)
- `APPWRITE_SYSTEM_TEMPLATES_COLLECTION_ID=system_dashboard_templates`
- `VNIBB_MCP_URL=http://mcp:8001/mcp`
- `VNIBB_MCP_SHARED_BEARER_TOKEN`
- `MCP_PUBLIC_BIND=127.0.0.1`
- `MCP_PUBLIC_PORT=8001`
- `REDIS_URL` if the cache tier remains enabled
- `MEMORY_CACHE_MAX_ENTRY_BYTES=1048576` or larger if the cache tier is disabled and microstructure payloads must fit memory fallback
- `SENTRY_DSN`
- `ADMIN_API_KEY`
- `LOG_FORMAT=json`
- `CORS_ORIGINS`
- `VNIBB_API_IMAGE_REPOSITORY` as the registry repository and `VNIBB_API_IMAGE_DIGEST` as the published `sha256:<digest>`
- resource and log limit values from `deployment/env.oracle.example`, adjusted only after a measured baseline

### Create the system templates collection

For the exact click-by-click setup, see the archived `appwrite_system_layouts_manual_setup.md` under the workspace archive (`../docs/archive/vnibb-docs-2026-06-09/`, outside this repo).

Before expecting admin draft/publish to work, create collection `system_dashboard_templates` in the existing VNIBB database with these attributes:

- `dashboard_key` string
- `status` string
- `version` integer
- `dashboard_json` string
- `notes` string
- `updated_by` string
- `updated_at` string
- `published_at` string

Recommended indexes:

- `dashboard_key + status`
- `dashboard_key + version`

### Admin-first workflow result

After deploy, admins can save the platform admin key in the web UI and manage locked Initial layouts without SSH access or code edits.

### Build and publish the release image

Build outside OCI. The release image is free-compatible when no premium secret is supplied. For a premium image, use BuildKit's secret mount and provide the installer SHA-256 out of band; never pass the API key with `--build-arg`.

```bash
export IMAGE_RELEASE_REVISION="$(git rev-parse --verify HEAD)"
export VNSTOCK_API_KEY_FILE=/secure/path/vnstock-api-key
export VNSTOCK_INSTALLER_SHA256=<verified-installer-sha256>
bash scripts/oracle/build_release_image.sh registry.example.com/vnibb/api:<release-tag>
```

After publishing, resolve the registry's manifest digest and set `VNIBB_API_IMAGE_REPOSITORY=registry.example.com/vnibb/api` plus `VNIBB_API_IMAGE_DIGEST=sha256:<published-digest>` in `deployment/env.oracle`. Compose joins these fields as `repository@digest`, so a mutable tag cannot enter the release path. The image stores its build revision in `/app/.release-revision`; stale `RELEASE_REVISION` runtime keys cannot override health, logs, or Sentry. The identical image value is used by API, MCP, scheduler, and the one-shot migration service.

### Release the stack

```bash
git pull --ff-only
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml config
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml pull
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml run --rm migrate
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml run --rm migrate current
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --no-build --force-recreate api mcp caddy
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml --profile scheduler up -d --no-build --force-recreate scheduler
```

### Scheduler cutover and rollback

The API defaults to `API_SKIP_SCHEDULER_STARTUP=true`; it does not execute APScheduler jobs. Enable the isolated worker only after the API is recreated with that default and `REDIS_URL` is reachable.

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml --profile scheduler config
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml --profile scheduler up -d --no-build scheduler
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs scheduler --tail=200
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml --profile scheduler ps
```

The scheduler service uses the same pinned repository and digest and requires `SCHEDULER_LOCK_MODE=required`; a Redis failure skips jobs rather than risking duplicates. Verify `/api/v1/data/sync/status` reports API role and `scheduler_lock_*` configuration under `/health/`.

Rollback the worker before restoring API-owned scheduling:

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml --profile scheduler stop scheduler
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml --profile scheduler rm -f scheduler
API_SKIP_SCHEDULER_STARTUP=false docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --no-build --force-recreate api
```

Use API-owned scheduling only for a single API replica and only after the scheduler container has stopped.

Always include `--env-file deployment/env.oracle`. Compose does not use the service-level `env_file` for `${...}` interpolation, and Caddy requires `SITE_HOSTNAME` plus `ACME_EMAIL` before it can obtain a public TLS certificate. A migration failure stops this release sequence before API or MCP is recreated, leaving the currently running services untouched.

### Verify container health

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml ps
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs api --tail=200
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs caddy --tail=200
```

### Verify TLS

- Wait for Caddy to obtain certificates.
- Confirm the canary hostname answers on `https://`.
- If the browser console shows `net::ERR_SSL_PROTOCOL_ERROR` for every `/api/v1/*` request, the frontend is pointed at a host/port that is not terminating TLS. Fix `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` to use the public Caddy HTTPS hostname, then redeploy the frontend.

If the public Caddy hostname itself fails TLS with `tlsv1 alert internal error`, confirm the running compose config is using the real hostname, then recreate Caddy:

```bash
grep -E '^(SITE_HOSTNAME|ACME_EMAIL)=' deployment/env.oracle
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml config | grep -E 'SITE_HOSTNAME|ACME_EMAIL'
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --force-recreate caddy
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs caddy --tail=200
```

Then verify from outside the VM:

```bash
openssl s_client -connect "$SITE_HOSTNAME:443" -servername "$SITE_HOSTNAME" -brief
BASE_URL="https://$SITE_HOSTNAME" bash scripts/oracle/healthcheck.sh
```

## 4. Verify Service

### Health checks

```bash
bash scripts/oracle/healthcheck.sh
bash scripts/oracle/smoke_test.sh
bash scripts/oracle/runtime_verify.sh
bash scripts/oracle/mcp_smoke_test.sh
BASE_URL=http://127.0.0.1:8001 bash scripts/oracle/mcp_smoke_test.sh
BASE_URL=https://oracle-api.example.com bash scripts/oracle/healthcheck.sh
CORS_TEST_ORIGIN=https://vnibb.vercel.app BASE_URL=https://oracle-api.example.com bash scripts/oracle/smoke_test.sh
BASE_URL=https://oracle-api.example.com bash scripts/oracle/runtime_verify.sh
BASE_URL=https://oracle-api.example.com bash scripts/oracle/mcp_smoke_test.sh
```

Notes:

- The scripts default to `http://127.0.0.1:8000`, which is useful for local VM rehearsal before DNS is live.
- The MCP smoke script now defaults to `http://127.0.0.1:8001`, which matches the host-published `vnibb-mcp` port on OCI.
- Override `CORS_TEST_ORIGIN` when validating a non-default frontend origin.
- Set `VNIBB_MCP_SHARED_BEARER_TOKEN` in the shell before running the MCP smoke script against a protected deployment.

### Log review

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs api --tail=200
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs caddy --tail=200
```

### What to confirm

- `/live`, `/ready`, `/health/`, and `/api/v1/health` return `200`
- `/health/` reports `providers.data_backend=hybrid`
- `/health/` reports `providers.appwrite_write_enabled=false`
- `/health/` reports `providers.allow_anonymous_dashboard_writes=true`
- `/api/v1/dashboard/` returns `200` when called with `X-VNIBB-Client-ID`
- `/mcp-health` returns `200`
- `/mcp` accepts MCP initialization and `get_appwrite_status`
- the database stack is reported as connected
- CORS preflight succeeds for `https://vnibb-web.vercel.app`
- Key API endpoints succeed
- Websocket probe succeeds or is explicitly skipped with a known reason

## 5. Cutover Procedure

1. Freeze backend changes.
2. Re-run Oracle health and smoke checks.
3. Re-run health checks against any rollback target that is still being kept warm.
4. Confirm the stable hostname TTL is already `60`.
5. Switch the stable hostname from the previous backend or OCI canary hostname to the Oracle reserved IP.
6. Wait for DNS propagation.
7. Test the production Vercel frontend against the stable hostname.
8. Confirm the frontend build is using `NEXT_PUBLIC_AUTH_PROVIDER=supabase` by verifying the browser no longer calls `/account/jwts` on the legacy auth path during dashboard load.
9. Monitor minute 0-15:
   - uptime
   - 5xx rate
   - p95 latency
   - websocket reconnects
   - database stack connectivity
10. Declare success only after the 15-minute window stays green.

### Required confirmation roles

- Operator confirms deployment health
- Application owner confirms Vercel frontend behavior
- Incident owner confirms metrics/logs are acceptable

## 6. Incident Procedure

### First checks

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml ps
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs api --tail=200
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs caddy --tail=200
BASE_URL=https://api.example.com bash scripts/oracle/healthcheck.sh
```

### Safe restarts

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml restart api
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml restart caddy
```

Routine API and MCP restarts do not run migrations, download installers, or install packages. Run `migrate` only as part of a controlled release.

### When to rollback

- `/ready` or `/api/v1/health` is non-200 after restart attempts
- sustained 5xx errors
- broken auth/session behavior
- websocket instability severe enough to degrade user experience
- latency regression that breaches the agreed threshold

See [oracle_rollback_plan.md](./oracle_rollback_plan.md) for the exact rollback sequence.

## 7. Maintenance

### Patch cadence

- Apply OS security updates weekly
- Rebuild containers for dependency updates on a planned maintenance window

### Resource and log ceilings

- `api`, `mcp`, `caddy`, and optional `local-redis` use Compose CPU, memory, and PID limits from `deployment/env.oracle`.
- Defaults reserve capacity for the Docker daemon, kernel, Caddy, and operator access on the 4 OCPU / 24 GB A1 allowance; tune only from measured peak CPU, RSS, process count, and log volume.
- Docker uses the `local` log driver by default with `10m` files and three retained files. Set `DOCKER_LOG_DRIVER=json-file` only when host tooling requires it; the same size and file-count values apply.
- Check `docker inspect --format '{{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}' vnibb-api` and `docker stats --no-stream` after every limit change.

### Disk checks

```bash
df -h
docker system df
```

### Certificate validation

- Confirm Caddy certificate renewals continue automatically
- Review Caddy logs after renewals or DNS changes

### Oracle quota checks

- Review the current Always Free allowance before resizing or adding volumes
- Reference:
  - [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/)
  - [Oracle Compute shapes documentation](https://docs.oracle.com/iaas/Content/Compute/References/computeshapes.htm)

### Cost overrun quick check (Always Free)

Use this checklist before and after each deployment to confirm OCI usage remains in Always Free.

Official Always Free thresholds (home region):
- Compute (A1 Flex): up to 4 OCPUs and 24 GB RAM equivalent usage
- Block + boot volumes combined: up to 200 GB
- Outbound data transfer: up to 10 TB/month

Console path for all checks:
- `Governance & Administration -> Limits, Quotas and Usage`

What to verify:
1. Compute usage is below A1 Always Free limits (OCPU + memory)
2. No accidental paid shapes are running (non-Always-Free compute)
3. Boot + block volumes combined remain <= 200 GB
4. Monthly outbound data transfer remains <= 10 TB
5. Resources are provisioned in the tenancy home region when required by Always Free

Recommended VNIBB guardrails:
- Keep one primary `VM.Standard.A1.Flex` backend host
- Keep default/lean boot volumes and avoid extra block volumes
- Use one reserved public IP for stable DNS cutover
- Treat additional compute nodes, larger volumes, and managed OCI add-ons as potential paid expansion

Pass/fail rule:
- PASS: all five checks are within thresholds
- FAIL: any single threshold is exceeded or paid shape usage appears
