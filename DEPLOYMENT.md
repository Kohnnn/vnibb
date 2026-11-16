# VNIBB Deployment Guide

> **Superseded guidance.** This page used to prescribe `backend/`, `frontend/`,
> `docker-compose.prod.yml` and an implicit default Compose file. None of those
> exist in this monorepo. The canonical, current references are:
>
> - [`docs/oracle_runbook.md`](docs/oracle_runbook.md) — Oracle VM deploy, verify, cutover, rollback
> - [`docs/DEPLOYMENT_AND_OPERATIONS.md`](docs/DEPLOYMENT_AND_OPERATIONS.md) — deployment profile and ops policy
> - [`docs/VNIBB_MCP_DEPLOYMENT.md`](docs/VNIBB_MCP_DEPLOYMENT.md) — read-only MCP sidecar deployment and smoke
>
> Archived/legacy material stays where it is for history: `DEPLOYMENT.md.example`
> (Zeabur-era template) and the superseded plans under `docs/archive/`. Do not
> follow them for a current deployment.

## Repository shape

Every command in the canonical guides runs from the **repository root**, which is
the only directory where these resolve together:

| Path | Purpose |
|---|---|
| `docker-compose.oracle.yml` | production stack (api, mcp, caddy, migrate, scheduler profile) |
| `docker-compose.data.local.yml` | local development database stack only |
| `deployment/env.oracle` | private production env file (never committed) |
| `deployment/env.oracle.example` | placeholder template to copy |
| `apps/api/` | FastAPI backend |
| `apps/web/` | Next.js frontend |
| `scripts/oracle/` | release, health and smoke scripts |

There is no `docker-compose.yml` default file: always pass `-f` explicitly.

## Local development

Start the database stack first (`docs/oracle_runbook.md` → "Database recovery and
local startup"): it publishes loopback ports `55432` (PostgreSQL) and `57017`
(MongoDB) with private credentials from a file outside the repository.

```bash
# Repository root
pnpm install --frozen-lockfile
python -m pip install --isolated --index-url https://pypi.org/simple \
  -c apps/api/constraints-vnstock.txt -e "apps/api[dev]"

pnpm --filter frontend dev
python -m uvicorn vnibb.api.main:app --reload --app-dir apps/api
```

Frontend environment goes in `apps/web/.env.local`
(`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`). Backend environment goes in
`apps/api/.env`, created from `apps/api/.env.example`; placeholder values only,
never a real secret in the repository.

## Production

Use the runbook. The minimum shape, from the repository root:

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml pull api mcp migrate
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml run --rm migrate
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --no-build api mcp caddy
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml ps
```

Migrations run through the `migrate` service with `ALEMBIC_STRICT=1`; never run
`docker compose down -v`, and never run ad-hoc SQL against production to
"validate" a documentation change.

## Verification

```bash
bash scripts/oracle/healthcheck.sh
bash scripts/oracle/runtime_verify.sh
```

MCP smoke (host mode, from the repository root). Load the sidecar bearer from
your private secret store without printing it, then pass it explicitly — a bearer
that exists only in the container's env never reaches a host client, and auto
mode would pick that host client when it is installed:

```bash
# set VNIBB_MCP_SHARED_BEARER_TOKEN in this shell from the private secret store
EXPECTED_REVISION=<reviewed-40-char-sha> VNIBB_MCP_SHARED_BEARER_TOKEN="$VNIBB_MCP_SHARED_BEARER_TOKEN" PYTHON_MODE=host:python3 BASE_URL=http://127.0.0.1:8001 bash scripts/oracle/mcp_smoke_test.sh
```

`EXPECTED_REVISION` must come from the reviewed/published release record
(`git rev-parse --verify '<published-tag>^{commit}'`, the build receipt, or
`/app/.release-revision` in the pulled image), never from the running health
response. Process health is not database, source, freshness or coverage
acceptance — see `docs/VNIBB_MCP_DEPLOYMENT.md` for the container-mode variant.

## Troubleshooting

1. **Database connection failed** — check `DATABASE_URL` format and that the
   database stack is running and reachable on its private/loopback address.
2. **VNStock API errors** — confirm `VNSTOCK_SOURCE=VCI` and the configured
   `VNSTOCK_RUNTIME_TIER`. Golden startup fails closed without a valid
   `VNSTOCK_API_KEY`; free mode runs no startup account check, so isolate
   `VNSTOCK_HOME` to avoid reusing a persisted paid account.
3. **Frontend build errors** — remove `.next`, reinstall with
   `pnpm install --frozen-lockfile`, then `pnpm --filter frontend exec tsc --noEmit`.
4. **CORS errors** — verify `CORS_ORIGINS`/`CORS_ORIGIN_REGEX` in the backend env
   match the deployed frontend origin; do not add a wildcard.

## Security checklist

- [ ] HTTPS everywhere in production
- [ ] Strong, unique database credentials held outside the repository
- [ ] Rate limiting enabled
- [ ] CORS scoped to known origins (no `*`)
- [ ] Secrets supplied via the private env file / secret store only
- [ ] Database stack private; never published to the internet
- [ ] Regular security updates
