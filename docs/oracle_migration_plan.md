# Oracle Migration Plan

## Executive Summary

This plan migrates the VNIBB backend runtime from Zeabur to an Oracle Cloud Always Free VM with minimal risk. The frontend stays on Vercel. This document reflects the original Oracle cutover scope; current runtime operations now prefer Supabase/Postgres for primary durable state, with Appwrite retained only as an optional legacy fallback or projection target. Oracle Database is explicitly out of scope for this phase.

The migration is organized around five mitigation tracks:

1. Remove dangerous production defaults that still target Zeabur.
2. Make the backend deployable on Oracle VM with Docker Compose and a reverse proxy.
3. Cut over traffic through a stable custom backend hostname with rollback in under 15 minutes.
4. Reduce CI and build reproducibility issues that would raise migration risk.
5. Ship a runbook and rollback guide that operators can execute without guesswork.

## Current-State Risk Summary

### Current architecture

- Frontend hosting: Vercel
- Backend hosting: Zeabur
- Backend runtime: Dockerized FastAPI
- Auth/runtime data backend at the time: Appwrite-first with PostgreSQL assumptions still present
- Current mitigation direction: Supabase auth + Postgres primary durable state
- Health endpoints already available: `/health/`, `/live`, `/ready`

### Observed repository risks

1. Production frontend fallback still pointed to Zeabur when env values were missing.
2. Zeabur hostnames were hardcoded across scripts, docs, workflows, and UI examples.
3. The frontend used `next/font/google`, which can fail in clean or network-restricted builds.
4. Root CI and local gate behavior had drifted from the monorepo layout and package-manager reality.
5. Backend production still requires `DATABASE_URL`, and current mitigation keeps Postgres as the primary durable store.

## Goal And Non-Goals

### Goal

Move the backend runtime to Oracle VM compute while preserving the current API contract, the Appwrite path, and a fast rollback route back to Zeabur.

### Non-goals

- No Oracle Database migration
- No frontend hosting move
- No API schema rewrite
- No Appwrite replacement
- No header-based traffic splitting in this phase

## Target Oracle Reference Architecture

- Oracle Always Free VM running Ubuntu 24.04 LTS
- Docker Engine + Docker Compose
- `api` container built from `apps/api/Dockerfile`
- `caddy` container handling HTTPS termination and reverse proxy
- Optional `redis` compose profile, disabled by default
- Reserved public IP attached to the VM
- Stable backend hostname such as `api.example.com`
- Optional canary hostname such as `oracle-api.example.com`
- External services remain external:
  - Appwrite
  - PostgreSQL/Supabase
  - Managed Redis, if kept enabled

## Step-By-Step Mitigation Workstream

### Phase A: Remove dangerous defaults

1. Require explicit production `NEXT_PUBLIC_API_URL`.
2. Require explicit production `NEXT_PUBLIC_WS_URL`.
3. Remove silent frontend fallback to `https://vnibb.zeabur.app`.
4. Replace Zeabur-specific examples in the settings UI, connect-backend modal, docs, and env examples.
5. Update health and sync tooling to use env-driven base URLs instead of hardcoded provider URLs.

### Phase B: Make Oracle runtime deployable

1. Add `docker-compose.oracle.yml` with `api`, `caddy`, and optional `redis`.
2. Add `deployment/env.oracle.example` with the full production env contract.
3. Add `deployment/Caddyfile` with TLS termination and reverse proxy settings.
4. Run the API behind proxy-aware Uvicorn flags.
5. Keep `/root/.vnstock` on a persistent Docker volume so the runtime survives restarts cleanly.

### Phase C: Make cutover safe

1. Deploy Oracle behind the canary hostname first.
2. Run `bash scripts/oracle/healthcheck.sh` against Oracle.
3. Run `bash scripts/oracle/smoke_test.sh` against Oracle.
4. Lower the stable hostname DNS TTL to 60 seconds at least 24 hours before cutover.
5. Keep Zeabur running and unchanged as the hot rollback target.
6. Switch only the stable custom API hostname during cutover.

### Phase D: Improve reproducibility

1. Replace Google font fetching with local font assets.
2. Make root CI and local gates use the actual monorepo layout.
3. Pin CI package-manager installation to `pnpm@9.15.4`.
4. Use a cross-platform `ci:gate` implementation instead of shell-specific wrappers.
5. Document any remaining environment bootstrap caveats in the verification report.

### Phase E: Operationalize

1. Monitor API uptime, 5xx rate, p95 latency, and websocket stability for the first 15 minutes after cutover.
2. Document incident triggers and rollback criteria.
3. Document Oracle quota guardrails and links to the official Oracle Free Tier pages.

## Pre-Cutover Checklist

- Oracle VM created and patched
- Reserved public IP attached
- Security list or NSG rules applied
- Docker Engine and Compose installed
- `deployment/env.oracle` created from `deployment/env.oracle.example`
- Caddy and API containers healthy
- Appwrite connectivity healthy
- PostgreSQL connectivity healthy
- Redis connectivity healthy or intentionally disabled
- CORS matches Vercel production and preview domains
- Vercel preview validated against the Oracle canary hostname
- `healthcheck.sh` passes against Oracle
- `smoke_test.sh` passes against Oracle
- Zeabur still healthy and unchanged
- Stable hostname TTL lowered to 60 seconds

## Cutover Steps

1. Freeze backend changes.
2. Confirm Oracle canary health.
3. Run `bash scripts/oracle/healthcheck.sh` against Oracle.
4. Run `bash scripts/oracle/smoke_test.sh` against Oracle.
5. Run the same health checks against Zeabur.
6. Switch the stable hostname from Zeabur to Oracle.
7. Wait for TTL propagation.
8. Verify Vercel frontend behavior against the stable hostname.
9. Watch health, logs, error rate, latency, and websocket stability for 15 minutes.
10. Declare success only if all checks remain green.

## Post-Cutover Validation

- `/live` returns `200`
- `/ready` returns `200`
- `/health/` reports the expected backend/provider state
- Key equity endpoints return `200`
- Websocket connection succeeds
- Appwrite auth/session flow still works from Vercel
- CORS preflight succeeds for the Vercel origin
- Scheduler and warmup behavior do not destabilize startup

## Risk Table

| Risk | Symptom | Likely Cause | Mitigation Before Cutover | Rollback Trigger |
| --- | --- | --- | --- | --- |
| Silent frontend drift | Vercel points at the wrong backend | Missing production envs | Fail fast on missing API/WS envs | Any production request hits the deprecated host |
| Clean build fragility | `next build` fails in CI or on Vercel | External font fetch blocked | Local font assets checked into repo | Frontend build fails during cutover window |
| Workflow drift | Root CI fails or misses real regressions | Old paths and package-manager mismatch | Root `ci:gate` uses the real monorepo layout | CI or preflight gate cannot complete before cutover |
| Appwrite misconfiguration | Data/auth paths degrade on Oracle | Incomplete `APPWRITE_*` env contract | Production config validation now fails early | Appwrite health is not connected after deploy |
| Oracle runtime boot issues | `/ready` never goes green | Env mismatch, migrations, proxy config | Compose manifest + runbook + health scripts | `/ready` remains non-200 after cutover |

## Oracle Cost Guardrails

- Prefer a single Always Free VM for the backend runtime and avoid unnecessary extra block volumes.
- Keep Redis external unless there is a strong reason to self-host it.
- Keep port exposure limited to `80/443` and one reserved public IP.
- Re-check the current Always Free compute and storage allowances before provisioning:
  - [Oracle Cloud Free Tier overview](https://www.oracle.com/cloud/free/)
  - [Oracle Compute shapes documentation](https://docs.oracle.com/iaas/Content/Compute/References/computeshapes.htm)

## Verification Report

| Command | Pass/Fail | Notes |
| --- | --- | --- |
| `pnpm --filter frontend lint` | Pass | Passed with pinned `pnpm@9.15.4` binary first on `PATH`. The default Windows Corepack shim on this workstation is broken and fails before repo code runs. |
| `pnpm --filter frontend build` | Pass | Passed with pinned `pnpm@9.15.4` binary first on `PATH`. Local font assets removed the external Google font fetch dependency. |
| `pnpm --filter frontend test -- --runInBand` | Pass | `6` suites and `37` tests passed. |
| `python -m py_compile apps/api/vnibb/api/main.py` | Pass | Exit code `0`. |
| `python -m pytest apps/api/tests -v` | Pass | `97 passed` in about `10s`. The shell wrapper timed out after completion unless output was redirected, but the full suite completed successfully. |
| `pnpm ci:gate` | Pass with caveat | All gate stages completed in `ci-gate-root.log`, including frontend lint/build/test and backend compile/pytest. On this workstation the wrapper timed out after test completion, so CI should remain the source of truth for exit-code enforcement. |
| `bash scripts/oracle/healthcheck.sh` | Pass | Verified against a local API instance on `http://127.0.0.1:8000`. |
| `bash scripts/oracle/smoke_test.sh` | Pass | Verified against a local API instance on `http://127.0.0.1:8000`. Websocket probe was skipped because the `websockets` Python package is not installed in the bash-visible interpreter. |

### Known blockers to record if still present

- Default Windows Corepack `pnpm` shim on this workstation is not usable; use the pinned `pnpm@9.15.4` binary path or CI.
- `pnpm ci:gate` finishes all inner checks, but the local shell wrapper may time out after pytest output completes.
- Historical docs still mention Zeabur for past deployments or rollback context; current operational docs now point to Oracle.
