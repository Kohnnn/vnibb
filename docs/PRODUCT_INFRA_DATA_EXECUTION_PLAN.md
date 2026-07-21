# Product Trust, OCI Hardening, And n6v Data-Lake Execution Plan

Date started: 2026-07-16
Owner: VNIBB maintainers
Status: Repository implementation complete; live rollout gated

## Goal

Ship the next VNIBB reliability program without replacing the existing serving architecture:

1. make data quality, coverage, and alert limitations visible to users;
2. make OCI releases repeatable, immutable, observable, and safe to scale;
3. add verified off-host recovery and an append-only Parquet analytical layer on n6v;
4. preserve MongoDB and PostgreSQL as the canonical API and MCP serving stores.

## Non-Negotiable Contracts

- Vercel remains the frontend runtime.
- OCI continues to run Caddy, FastAPI, and the read-only MCP service.
- n6v MongoDB `vnibb-market` remains canonical for market and analytical records.
- n6v self-hosted Supabase PostgreSQL remains canonical for app, auth, user, and runtime state.
- Redis remains non-canonical and may only hold cache, rate-limit, and coordination state.
- Bronze and Silver Parquet outputs are analytical and recovery artifacts. API and MCP do not read them in this program.
- Appwrite writes remain disabled unless a separate controlled backfill is approved.
- One API process remains the production default until scheduler coordination, rate limiting, and WebSocket behavior are safe across processes.
- Existing deployment-local OCI files and secrets are never replaced from repository examples.
- Schema rollbacks are never automatic. Database changes use expand/contract compatibility so the previous application image remains deployable.

## Success Measures

| Area | Measure | Exit target |
|---|---|---|
| Product trust | Screener field/source coverage visible | Every response reports freshness, source state, and visible-field coverage |
| Product trust | Portfolio sector resolution visible | Resolved/unresolved holding and value coverage are explicit |
| Product trust | Alert channel truth visible | Browser permission, feed state, and unverified email delivery are distinguishable |
| OCI | Request and resource baseline | Seven days including three market sessions, with route p50/p95/p99, status rates, CPU, RSS, restarts, logs, Redis, and scheduler durations |
| OCI | Migration isolation | API restart never runs Alembic; release migration failure leaves current API serving |
| OCI | Image immutability | API and MCP run the same pinned image digest; startup performs no package installation or download |
| OCI | Resource safety | No OOM kill or sustained throttling; peak RSS stays below 80% of the configured cap |
| OCI | Shared rate limits | Multiple processes consume one Redis quota; shadow decisions are measurable before enforcement |
| OCI | Scheduler isolation | Exactly one execution per job and scheduled slot |
| n6v | Bronze integrity | Mongo inventory count equals committed Parquet count and every file checksum validates |
| n6v | Recovery | Encrypted off-host backup validates and an isolated full restore completes within the agreed RTO |
| n6v | Silver quality | No duplicate logical EOD keys; every rejected row has a reason and lineage |

## Delivery Sequence

### Phase 0: Preserve State And Establish Baselines

Status: In progress

Repository work:

- preserve the completed, uncommitted adjustment, backtest, saved-alert, portfolio, and signal-summary slices;
- record this execution plan and progress in the maintainer docs index;
- add operator-readable baseline and rollout commands without embedding credentials.

Live OCI inventory:

- record API and MCP image IDs and digests;
- save rendered Compose configuration from the real `deployment/env.oracle`;
- record `alembic current`, health payloads, premium module versions, restart counts, CPU, RSS, Docker log size, and open WebSockets;
- collect Caddy/API route status and latency statistics for seven days and at least three market sessions;
- record Redis connectivity, hit rate, errors, memory, and evictions;
- record every scheduler job duration, timeout, skip, and failure.

Live n6v inventory:

- record MongoDB version, topology, replica-set state, indexes, document counts, source/date ranges, duplicate logical EOD days, data-volume path, and free space;
- record PostgreSQL versions, database sizes, table/index sizes, active connections, and backup state;
- record Redis version, memory, persistence, and eviction policy;
- identify the existing backup target, retention, encryption owner, key recovery owner, RPO, RTO, and latest proven restore.

Exit gates:

- no live mutation occurs before both inventories are captured;
- deployed environment values match the documented hybrid/private n6v architecture;
- current image digests remain available for immediate rollback;
- logging is proven not to expose credentials, authorization headers, tokens, or sensitive query values.

### Phase 1: Product Data-Trust Bundle

Status: Implemented and repository-verified; deployment pending

#### 1.1 Screener completeness and provenance

Implementation:

- extend screener response metadata without breaking `count` and `last_data_date`;
- report cache state, stale state, fallback source, total universe size, result size, and non-null coverage for visible fundamental fields;
- preserve null values rather than inventing confidence scores;
- fix the frontend runtime endpoint label to match the real `/api/v1/screener` route;
- render concise coverage and source-state language near existing widget metadata.

Acceptance:

- an all-null optional field reports zero covered rows;
- a partially enriched response reports exact covered and total counts;
- cached, stale, and fallback states survive backend-to-frontend typing;
- existing saved screens and alert comparisons retain their exact scan semantics.

#### 1.2 Portfolio sector resolution

Implementation:

- replace the hard-coded sector sample map with backend profile data;
- batch or bound symbol profile requests through existing API/query conventions;
- track resolved holding count, unresolved holding count, resolved market value, and value-weighted resolution coverage;
- keep unresolved holdings separate from real sector classifications;
- preserve quote-coverage disclosure and positive-value filtering.

Acceptance:

- unknown symbols do not appear as a valid `Other` sector allocation;
- sector allocation totals only resolved market value;
- the widget states both holding-count and value coverage;
- concentration calculations remain deterministic and tested.

#### 1.3 Alert reliability and status visibility

Implementation:

- register the real alert settings component instead of the placeholder;
- report browser enabled state and browser permission separately;
- label email as preference-only until a sender, receipt, and delivery history exist;
- distinguish loaded, stale/cached, and unavailable alert-feed states;
- reuse existing prediction-market source-health and widget-runtime helpers.

Acceptance:

- the UI never implies that email delivery is operational when it is not verified;
- denied browser permission is distinct from a disabled preference;
- alert-feed failure does not erase the last-good state without explanation;
- no automatic permission prompt is added to settings rendering.

### Phase 2: OCI Release Hardening

Status: Implemented and repository-verified; image build and OCI canary pending

#### 2.1 Externalize migrations

Implementation:

- remove Alembic execution from API startup;
- add an explicit one-shot `migrate` Compose service using the exact release image and environment;
- make deployment order: pull image, verify image, run migration, confirm Alembic head, recreate API/MCP, run health and smoke checks;
- keep routine restarts migration-free.

Failure behavior:

- failed migration stops the new image rollout while the current API remains serving;
- failed post-migration smoke restores the previous compatible image digest;
- no automatic downgrade runs.

Acceptance:

- API startup logs contain no Alembic invocation;
- API-only restart leaves `alembic_version` unchanged;
- migration status can be checked independently of API readiness.

#### 2.2 Immutable premium image

Implementation:

- build once outside production and publish a registry image;
- use one image digest for API, MCP, migration, and scheduler services;
- install premium packages only at image build time through a build secret;
- verify required imports during image construction;
- remove runtime `pip`, installer download, package copy, and package-volume behavior;
- retain free-compatible builds when no premium build secret is supplied.

Acceptance:

- production Compose references a registry image variable and does not build locally;
- startup performs no network or package mutation;
- required premium imports are verified before deployment;
- rollback only changes the image digest.

#### 2.3 Resource and log ceilings

Implementation:

- expose Compose environment variables for service CPU, memory, PID, and Docker log rotation limits;
- use conservative defaults only where the current host contract supports them;
- document that production values must be selected from the measured baseline;
- preserve host headroom for Docker, kernel, Caddy, and operator access.

Acceptance:

- Compose renders valid limits for API, MCP, Caddy, scheduler, and optional local Redis;
- logs rotate and retain at least 24 hours at peak measured volume;
- no service is OOM-killed or restart-looping during market and post-close workloads.

### Phase 3: n6v Backup And Bronze Parquet Pilot

Status: Tooling implemented and repository-verified; live export, off-host backup, and restore drill pending

#### 3.1 Inventory and consistency contract

Implementation:

- add a read-only CLI inventory for `vnibb-market.market_prices_eod`;
- capture collection count, source/month counts, min/max dates, indexes, invalid-value counts, and duplicate logical EOD days;
- record exporter and dependency versions;
- compare start and end inventories and fail the export when source counts drift.

Acceptance:

- the inventory contains no credentials;
- no source documents are changed or deleted;
- inconsistent full exports never receive a `COMPLETE` marker.

#### 3.2 Append-only Bronze export

Implementation:

- export every physical Mongo source variant to typed Parquet plus lossless Extended JSON;
- partition by source, trade year, and trade month;
- write into a run-specific staging directory;
- checkpoint only validated partitions;
- checksum every file;
- publish a run only after PyArrow and DuckDB validation succeeds;
- keep malformed rows and report them instead of silently dropping them.

Acceptance:

- committed Parquet row count equals captured Mongo inventory count;
- every row has `mongo_id` and `document_json`;
- every checksum matches;
- every Parquet file opens with PyArrow and DuckDB;
- failed runs remain staging-only.

#### 3.3 Encrypted off-host backup and restore drill

Implementation:

- create a Mongo archive with matching MongoDB tools;
- back up the archive and committed Bronze run to a Restic repository;
- verify the repository after backup;
- restore into an isolated path and temporary Mongo container;
- compare restored collection and Parquet inventories with the archived manifest;
- record elapsed restore time and operator evidence.

Pilot targets:

- RPO no greater than 24 hours;
- monthly restore drill;
- measured full-collection RTO no greater than four hours.

Acceptance:

- a backup is not considered successful until `restic check` passes;
- RPO/RTO are not considered achieved until an isolated restore proves them;
- backup password and repository credentials are external secrets, never arguments committed to the repository.

#### 3.4 Silver follow-up

Start only after two successful Bronze runs and one successful off-host restore.

Implementation:

- read committed Bronze only;
- normalize to one row per `(symbol, trade_date)`;
- rank `vietcap`, then `vnstock-data`, then unknown sources;
- tie-break using `updated_at`, `created_at`, then stable `mongo_id`;
- write invalid rows to a reject Parquet dataset with a reason and lineage.

Acceptance:

- zero duplicate Silver keys;
- all retained rows pass OHLCV rules;
- every dropped row exists in rejects;
- sampled symbols match current Mongo service precedence;
- no API or MCP serving switch occurs.

### Phase 4: Shared Redis Rate Limiting

Status: Implemented and repository-verified; production shadow observation pending

Implementation:

- replace the active process-memory limiter with one Redis-backed implementation;
- retain current endpoint buckets and thresholds initially;
- use atomic Redis operations with expiring versioned keys;
- support `off`, `shadow`, and `enforce` modes;
- fail open during Redis outage while emitting an explicit error signal;
- preserve health-path exemptions, CORS behavior, and `Retry-After` on `429`;
- remove or retire duplicate inactive limiter wiring.

Rollout:

1. deploy `shadow` for seven days;
2. compare would-block counts by bucket and client class;
3. verify key increments and expiry;
4. enforce on the canary hostname;
5. promote after a green observation window.

Acceptance:

- two limiter instances share one quota;
- Redis expiry resets quota;
- unexpected `429` rates remain within the agreed threshold;
- Redis failures are measurable and do not silently create per-process quotas.

### Phase 5: Scheduler Isolation And Coordination

Status: Implemented and repository-verified; controlled OCI cutover pending

Implementation:

- add a scheduler-only process from the same immutable image;
- disable scheduler startup in the API only after the scheduler service is healthy;
- retain APScheduler and current schedules; do not add Celery or RQ;
- acquire Redis distributed locks for job executions;
- preserve one-shot job behavior and provider call budgets;
- leave WebSocket service ownership with the API in this phase.

Rollout:

1. deploy scheduler service with API scheduler still enabled but scheduler worker disabled;
2. verify worker startup and health behavior without running jobs;
3. stop API scheduler and enable the scheduler worker in one controlled change;
4. observe at least one full market and post-close cycle;
5. add API workers only in a separate measured change.

Acceptance:

- exactly one execution occurs per job ID and scheduled slot;
- no duplicate provider calls or writes occur;
- scheduler restart does not affect API liveness or readiness;
- Redis lock failure is visible and does not create overlapping jobs;
- rollback restores scheduler startup to the single API process without overlap.

## Verification Matrix

| Slice | Focused checks | Full gate |
|---|---|---|
| Product trust | frontend Jest tests, backend screener tests | `pnpm run ci:gate` |
| Migration/image/Compose | shell syntax, Compose render, image import checks | `pnpm run ci:gate` plus OCI canary smoke |
| Bronze | Ruff, script pytest, local fixture export/validate | `pnpm run ci:gate` plus n6v inventory/restore |
| Redis limiter | backend unit/integration tests with shared fake/real Redis | `pnpm run ci:gate` plus shadow metrics |
| Scheduler | scheduler lock tests and startup compile | `pnpm run ci:gate` plus one full live schedule cycle |

Required repository checks after implementation:

```text
pnpm --filter frontend lint
pnpm --filter frontend exec tsc --noEmit
python -m ruff check apps/api
pnpm run ci:gate
```

Required OCI release checks:

```text
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml config
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml run --rm migrate
BASE_URL=https://<stable-host> bash scripts/oracle/healthcheck.sh
BASE_URL=https://<stable-host> bash scripts/oracle/smoke_test.sh
BASE_URL=https://<stable-host> bash scripts/oracle/runtime_verify.sh
bash scripts/oracle/check_vnstock_premium.sh
```

## Rollback Rules

- Preserve the currently deployed image digest before every OCI rollout.
- Never overwrite deployment-local environment or Caddy files from repository examples.
- Never run destructive EOD deduplication as part of Bronze or Silver work.
- Never publish a staging Parquet run.
- Never automatically downgrade a production schema.
- Never run the scheduler in API and worker processes simultaneously after cutover.
- Revert application behavior before changing canonical data.

## Progress Log

- 2026-07-16: Original five product slices implemented locally: adjustment confidence, point-in-time backtesting, saved-screen entry alerts, portfolio concentration analytics, and Signal Summary evidence drill-down.
- 2026-07-16: Focused frontend/backend tests, frontend lint/typecheck, and the six-stage CI gate passed for the original slices; 516 backend tests passed.
- 2026-07-16: Read-only product, OCI, and n6v architecture audits completed.
- 2026-07-16: Detailed product trust, OCI hardening, n6v Bronze/backup, Redis limiter, and scheduler-isolation plan recorded.
- 2026-07-16: Product trust shipped in the repository: screener core-field/source metadata, profile-backed portfolio sector resolution and coverage, effective alert-channel truth, stale last-good prediction alerts, and saved-screen polling lifecycle recovery.
- 2026-07-16: OCI hardening shipped in the repository: explicit migration service, immutable BuildKit-secret image path, shared digest configuration, resource/log limits, profile-gated scheduler worker, Redis job locks, retained realtime stream leases, and admin-gated realtime controls.
- 2026-07-16: n6v tooling shipped in the repository: bounded/resumable Bronze EOD export, manifest/checksum validation, source-drift rejection, exact-snapshot Restic backup validation, and operator-safe native command failure handling.
- 2026-07-16: Redis Lua rate limiter shipped with `off`, `shadow`, and `enforce` modes; the Oracle example begins in `shadow`, while application defaults remain `off`.
- 2026-07-16: Final combined review found no unresolved repository implementation blocker after fixes. Focused Ruff, PowerShell parsing, shell syntax, default/scheduler Compose rendering, frontend focused tests, and backend focused tests passed.
- 2026-07-16: Final six-stage `pnpm run ci:gate` passed: frontend lint, typecheck, build, Jest, backend compile, and 545 backend tests.
- 2026-07-16: No live deployment, database mutation, backup, image publication, commit, or push was performed. Live rollout remains gated on OCI/n6v inventory, credentials, image build verification, backup ownership, RPO/RTO confirmation, and measured baselines.

## Deferred Work

- A numerical data-confidence score. Add only when the score inputs and user interpretation are defined and tested.
- Spark, Kafka, Delta Lake, Iceberg, MinIO, and streaming CDC. Add only when measured scale or consumer requirements exceed DuckDB/Parquet and batch exports.
- Parquet API or MCP serving. Add only after a separate read contract, latency benchmark, cache policy, and rollback design.
- Additional API workers. Add only after scheduler isolation, shared rate limits, and WebSocket state behavior are proven.
- Production email alert delivery. Add only with sender configuration, delivery receipts, retries, and user-visible delivery history.
