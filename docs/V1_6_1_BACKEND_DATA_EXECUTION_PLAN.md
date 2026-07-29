# v1.6.1 Backend And Data Reliability Execution Plan

Date started: 2026-07-28
Owner: VNIBB maintainers
Status: Repository verification complete; live rollout pending
Branch: `feature/v1.6.1-backend-data`

## Release Goal

Ship trustworthy market data and a predictable backend without changing the serving-store contract:

1. measure route, cache, database, provider, scheduler, and WebSocket behavior;
2. audit and improve EOD correctness, freshness, provenance, and range coverage;
3. optimize measured backend bottlenecks with bounded concurrency and shared resources;
4. harden expensive administrative and background operations;
5. preserve MongoDB and PostgreSQL as canonical stores and Redis as non-canonical coordination/cache.

## Release Boundary

- The outcome-first walkthrough remains v1.6.0 work on its existing branch.
- v1.6.1 does not re-enable Appwrite writes.
- v1.6.1 does not combine data repair with a Supabase/PostgreSQL platform upgrade.
- Live corpus mutation, destructive deduplication, and index creation require an audited report, backup evidence, an exact operator command, and explicit approval.
- Repository completion and live rollout completion are tracked separately.

## Success Measures

| Area | Exit target |
|---|---|
| Data integrity | Zero same-source duplicate EOD keys after approved repair; deterministic source precedence |
| Units | Every active EOD row reports or normalizes to VND |
| Coverage | Historical reads do not treat sparse Mongo results as complete; completeness is observable |
| Freshness | Supported market data is no more than one trading session stale under normal provider operation |
| Cached API | p95 below 500 ms and p99 below 1.5 s |
| Standard uncached API | p95 below 2 s and p99 below 5 s |
| Cache | Endpoint-weighted hit ratio measured; target at least 80% for cacheable dashboard reads |
| Database | Pool utilization below 80% for 99% of samples; acquire timeout rate below 0.1% |
| WebSocket | Broadcast cycle completes within five seconds at supported subscription capacity |
| Scheduler | No overlapping production writes; duration, skip, timeout, and failure are observable |

## Delivery Plan

### Phase 0: Baseline And Release Instrumentation

Status: Repository implementation complete; live baseline pending

- expose bounded-cardinality process-local metrics for route latency/status, active requests, cache outcomes, provider outcomes, scheduler runs, and WebSocket state;
- add a real `/metrics` endpoint matching the deployment health-check contract;
- correct benchmark response contracts and report p50/p95/p99 plus failure state;
- record baseline commands and keep health probes cheap.

Exit gate: optimization work has a reproducible before/after measurement path.

### Phase 1: Read-Only Corpus Audit

Status: Repository tooling complete; live audit pending

- inventory Mongo EOD counts, source/date ranges, indexes, units, invalid OHLCV values, missing provenance, and duplicate keys;
- store machine-readable and operator-readable reports without credentials;
- make the audit strictly read-only and bounded by database timeouts.

Operator command using a dedicated MongoDB read-only account:

```text
python apps/api/scripts/query_plan_preflight.py --audit-mongo-eod --require-mongo --mongo-max-time-ms 30000 --mongo-audit-sample-limit 20 --output-json artifacts/mongo_eod_audit.v1.6.1.json --output-markdown artifacts/mongo_eod_audit.v1.6.1.md
```

The audit uses only bounded `ping`, `listIndexes`, `explain`, `aggregate`, and `find` commands. It does not use collection mutation methods or aggregation write stages.

Exit gate: no repair or unique-index operation starts before an audit report and backup evidence exist.

### Phase 2: Data Correctness And Coverage-Aware Reads

Status: Repository reads and audits complete; live repair and uniqueness pending

- retire or block source-unaware destructive deduplication;
- prepare an approval-gated Vietcap-aware archive/reconciliation operation;
- add same-source Mongo uniqueness only after cleanup;
- verify requested historical range coverage before accepting Mongo as complete;
- merge or fall back for missing ranges while preserving deterministic source precedence;
- expose source, freshness, and completeness metadata without breaking existing response fields;
- add duplicate, unit, OHLC, provenance, and coverage checks to durable quality runs.

Exit gate: sparse Mongo data cannot suppress a complete fallback series, and every returned logical trading day is deterministic.

### Phase 3: Backend Hot-Path Optimization

Status: Repository-safe reliability slices complete; live tuning pending

- reuse shared HTTP clients for bounded RSS refreshes;
- add cache singleflight for expensive shared reads;
- bound WebSocket connections, symbol count, fetch/send concurrency, per-cycle duration, and fallback work;
- replace per-request technical-analysis executors with the shared asyncio thread path and reuse one cleaned OHLCV frame per request;
- bound RSS fan-out, aggregate duration, response size, and Mongo analytical query duration/materialization;
- set provider, PostgreSQL, and MongoDB sub-deadlines below the request deadline;
- defer stale-while-revalidate, sector-ratio query optimization, and pool sizing until live measurements justify them.

Exit gate: load tests meet the latency targets without pool saturation or unbounded task growth.

### Phase 4: Broad Reliability Hardening

Status: Repository-safe hardening complete; worker migration and live coordination pending

- move long data-sync and administrative work out of API-worker background tasks;
- require Redis coordination for production scheduler writes;
- add jittered, cancellation-aware retry budgets;
- stream CSV and cap export rows/bytes;
- constrain admin SQL to read-only execution with row and statement limits;
- keep expensive diagnostics outside frequent liveness/readiness polling;
- tune Uvicorn workers and pools only from measured capacity.

Exit gate: provider, Redis, and database degradation produce bounded and observable behavior.

### Phase 5: Verification And Rollout

Status: Repository gates pass; live rollout pending

Repository gates:

```text
python -m ruff check apps/api
python -m pytest apps/api/tests -q
python apps/api/verify_api.py
python apps/api/scripts/query_plan_preflight.py
pnpm run ci:gate
pnpm run gate:no502
pnpm run gate:widgets:strict
```

Live gates:

- seven-day baseline including at least three market sessions;
- cached, uncached, provider-outage, Redis-outage, and WebSocket load tests;
- read-only corpus audit reviewed before repair;
- canary release with rollback image retained;
- post-deployment freshness, quality, pool, cache, and scheduler verification.

## Progress Log

### 2026-07-28

- Created isolated worktree `vnibb-v161` and branch `feature/v1.6.1-backend-data` from `origin/main`.
- Confirmed v1.6.0 walkthrough changes remain isolated and uncommitted in the original worktree.
- Completed static architecture audits for data quality, backend bottlenecks, observability gaps, and the historical walkthrough template failure.
- Confirmed the old `Could not create workspace for template.` path is absent from current source and belongs to the already-fixed frontend release path.
- Started Phase 0 implementation.
- Added dependency-free process metrics for active HTTP requests, route-template status counters, and fixed-bucket latency histograms with bounded route cardinality.
- Added the Prometheus-compatible `/metrics` endpoint and made the optional Oracle metrics health check release-blocking.
- Corrected the full-stack benchmark to report p50/p95/p99, explicit failure state, and the current market-freshness bucket contract.
- Added focused regression coverage for metric rendering, dynamic route normalization, route overflow, endpoint output, percentile interpolation, partial failures, and freshness scoring.
- Extended the read-only query-plan preflight with an opt-in Mongo EOD corpus audit covering source/date inventory, units, exact duplicates, same-source logical-day duplicates, cross-source overlaps, timestamp variants, invalid OHLCV, and missing provenance.
- Added bounded JSON and Markdown audit reports with secret-safe connection failure handling and no mutation operations.
- Completed repository verification for the first two slices: full `ci:gate` passed with 651 backend tests, frontend lint/typecheck/build/tests, and backend compile.
- Confirmed repository-wide Ruff remains blocked by pre-existing violations in unrelated backend files; changed-file Ruff passes.
- Started Phase 2 by making bounded historical Mongo EOD reads apply limits to logical trading days after deterministic source deduplication.
- Added regression coverage for cross-source overlaps and timestamp variants in both lookback and explicit-range reads.
- Re-ran the full `ci:gate`: 655 backend tests passed, one skipped, and all frontend gates passed.

### 2026-07-29

- Completed coverage-aware historical resolution: trusted partial Mongo rows survive provider failure, sparse ranges merge with database/provider rows, newest logical-day fallback is deterministic, and response metadata reports source counts, bounds, freshness, units, fallback, completeness, and warnings without removing existing fields.
- Ranked EOD candidates by trusted VND unit, finite valid OHLCV, source precedence, newest lineage, and stable identity; bounded sorted Mongo cursors stop after the requested logical-day boundary instead of exhausting symbol history.
- Added durable bounded Mongo EOD quality checks for missing or empty provenance, units, invalid OHLCV, exact duplicates, same-source duplicates, cross-source overlap, and sampled range coverage; Mongo timeout or unavailability remains non-fatal to API workers.
- Added cancellation-safe cache singleflight, bounded cache outcome metrics, configured Redis pool capacity, and fixed-size prefix deletion batches.
- Reused one cleaned OHLCV frame for full technical analysis and removed per-request executors in favor of the shared asyncio thread path.
- Bounded WebSocket connections, symbols, fetch and send concurrency, cycle duration, control-message sends, and dead-client cleanup; cancellation now propagates through provider and endpoint paths.
- Bounded RSS refresh concurrency across requests, reused one client per refresh, enforced aggregate and response-size deadlines, preserved partial results, and detached bounded cleanup from the response deadline.
- Added truthful dashboard persistence state: cloud-eligible local IDs enter sync, skipped dashboards report local-only persistence, and stale-data banners expose source health with an accessible 44-pixel dismiss target.
- Added cancellation-aware distributed scheduler lock renewal, bounded formula-safe CSV/Excel exports, ownership-scoped dashboard export, constrained read-only admin SQL, and removed mutation from `GET /admin/sync-status`.
- Made release image manifests consume the digest atomically from Buildx metadata and made runtime digest verification fail closed when Docker inspection is unavailable; no image was built or pushed.
- Added browser-critical response-envelope contracts and CI guards for changelog drift and Ruff diagnostics introduced on changed lines while subtracting existing baseline debt.
- Pruned broad Ruff auto-fix churn from legacy-heavy files and re-reviewed the combined diff for API compatibility, cancellation, security, and data-loss risks.
- Focused backend, frontend, shell, Node syntax, TypeScript, and diff checks pass. The diff-aware Ruff gate passes while leaving unrelated repository-wide debt unchanged.
- Completed the expanded combined `pnpm run ci:gate`: frontend lint, typecheck, changelog generation and drift check, build, and tests passed; changed-line Ruff and backend compile passed; 717 backend tests passed with one environment-gated skip.

Baseline commands:

```text
python apps/api/scripts/full_stack_benchmark.py --base-url http://localhost:8000 --repeats 20 --output-json artifacts/full_stack_benchmark.v1.6.1.json --fail-on-error
CHECK_METRICS=1 bash scripts/oracle/healthcheck.sh http://127.0.0.1:8000
```

## Deferred Live Operations

These are deliberately not run as incidental development actions:

- Mongo EOD deletion, rescaling, reconciliation, or unique-index creation;
- production PostgreSQL schema/index changes;
- scheduler role or lock-mode changes;
- Uvicorn worker-count, database-pool, Redis-pool, TTL, WebSocket, RSS, or provider-concurrency tuning without measured baselines;
- container image build, registry push, digest-pinned deployment, canary, or rollback execution;
- production health, freshness, cache, pool, scheduler, and revision verification;
- Supabase/PostgreSQL image, gateway, or major-version upgrades.
