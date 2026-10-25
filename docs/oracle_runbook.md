# Oracle Runbook

## Database recovery and local startup

Inspect the existing production host before changing anything: `hostname`, `df -h`, `docker ps -a` and the mounts on `vnibb-db`, `vnibb-mongo`, `vnibb-redis`. If these are the verified serving containers and are stopped, `docker start vnibb-db vnibb-mongo vnibb-redis` preserves their volumes. Do not create replacement stores, run `down -v`, overwrite credentials, or enable the scheduler before provider routing and database health are verified. SSH approval does not connect an unauthenticated workstation: `tailscale status` must show a running tailnet connection before MagicDNS/SSH can work.

For a separate local development database, create a private environment file outside the repository (mode `0600`) with unique `LOCAL_POSTGRES_PASSWORD` and `LOCAL_MONGO_PASSWORD`. Configure the backend with:

```dotenv
ENVIRONMENT=development
DEBUG=true
DATABASE_URL=postgresql+asyncpg://vnibb:<local-password>@127.0.0.1:55432/vnibb
DATABASE_URL_SYNC=postgresql+psycopg2://vnibb:<local-password>@127.0.0.1:55432/vnibb
MONGODB_URL=mongodb://vnibb:<local-password>@127.0.0.1:57017/?authSource=admin
MONGODB_DATABASE=vnibb-market
MONGODB_ENABLED=true
VNSTOCK_RUNTIME_TIER=free
VNSTOCK_SOURCE=VCI
CACHE_BACKEND=memory
REDIS_URL=
SKIP_SCHEDULER_STARTUP=true
```

```bash
docker compose --project-name vnibb-local-data --env-file /private/data.local.env \
  -f docker-compose.data.local.yml up -d --wait
# Export backend variables from the private file without printing credentials.
set -a
. /private/data.local.env
set +a
(cd apps/api && .venv/bin/python -m alembic upgrade head)
```

Ports bind only to loopback; named volumes survive restarts. This stack is not the production corpus. The local migration observed on 13 October 2026 reached `f8c3a102d679`; adding nullable flow coverage does not certify existing rows or complete market sessions.

### Mongo health-probe reaping and bounded connections

Both data compose files use Docker `init: true` so PID 1 reaps adopted probe children. The health shell `exec`s `mongosh`, uses explicit 2-second server-selection and connection deadlines, and retains Docker's 5-second outer timeout. Credentials, image, volumes and resource limits are unchanged. Apply the fix with an approved Mongo-only recreation (not a restart) to preserve the existing named volume; recreating removes already orphaned probes. Never run `down -v`.

Compose validation (do not publish rendered secrets):

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml config --quiet
docker compose --env-file /private/data.local.env -f docker-compose.data.local.yml config --quiet
```

Run this **disposable local** check before production recreation. It uses the local compose's actual health command, generated temporary credentials, no network, and tmpfs rather than production volumes. It checks a healthy real Mongo probe, a failed connection under the outer deadline, and orphan adoption/reaping; cleanup removes only its generated container.

```bash
python3 - <<'PY'
import json, os, secrets, subprocess, time

def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()

env = os.environ | {'LOCAL_POSTGRES_PASSWORD': secrets.token_hex(16), 'LOCAL_MONGO_PASSWORD': secrets.token_hex(16)}
mongo = json.loads(run('docker', 'compose', '-f', 'docker-compose.data.local.yml', 'config', '--format', 'json', env=env))['services']['mongo']
name = 'vnibb-mongo-reaping-' + secrets.token_hex(6)
probe = mongo['healthcheck']['test'][1].replace('$$', '$')
try:
    run('docker', 'run', '-d', '--name', name, '--init', '--network', 'none',
        '--tmpfs', '/data/db', '--tmpfs', '/data/configdb',
        '-e', 'MONGO_INITDB_ROOT_USERNAME=vnibb', '-e', 'MONGO_INITDB_ROOT_PASSWORD=' + env['LOCAL_MONGO_PASSWORD'],
        '--health-cmd', probe, '--health-interval', '2s', '--health-timeout', '5s', '--health-retries', '20', mongo['image'])
    for _ in range(60):
        if run('docker', 'inspect', '--format', '{{.State.Health.Status}}', name) == 'healthy':
            break
        time.sleep(1)
    else:
        raise AssertionError('disposable Mongo did not become healthy')
    assert 'init' in run('docker', 'exec', name, 'cat', '/proc/1/comm')
    started = time.monotonic()
    failed = subprocess.run(['docker', 'exec', name, 'sh', '-c', probe.replace('127.0.0.1:27017', '127.0.0.1:1')], capture_output=True, timeout=5)
    assert failed.returncode != 0 and time.monotonic() - started < 5
    for _ in range(20):
        run('docker', 'exec', name, 'sh', '-c', '(sleep 0.1 &) ; exit 0')
    time.sleep(3)
    processes = run('docker', 'top', name, '-eo', 'pid,ppid,stat,args')
    assert not any('Z' in line.split()[2] for line in processes.splitlines()[1:]), processes
    assert run('docker', 'inspect', '--format', '{{.State.Health.Status}}', name) == 'healthy'
    print('PASS: real probes bounded; PID 1 reaped 20 orphan children; no zombies')
finally:
    subprocess.run(['docker', 'rm', '-f', '-v', name], check=True)
PY
```

After the approved Mongo recreation, confirm `docker inspect --format '{{.HostConfig.Init}}' vnibb-mongo` reports `true`, health returns `healthy`, and `docker top vnibb-mongo -eo pid,ppid,stat,args` has no zombie or accumulating `mongosh` processes across multiple probe intervals. This is a targeted maintenance operation, separate from application-only rollout commands below.


New Vietnamese ingestion uses Vietcap IQ/Trading as primary and free vnstock VCI as the only supplementary provider. Do not enable historical premium mounts, KBS or TCBS routing. Preserve historical release evidence below; its old premium runtime instructions are not the new provider policy.

### Exact frontend origin and screener freshness gates

`CORS_ORIGINS` in the private serving `deployment/env.oracle` overrides source defaults. Preserve the effective approved list and append `https://web.vnibb.xyz` exactly; do not broaden the regex, add a wildcard, or duplicate CORS in Caddy. Save the environment, Compose files, proxy configuration and immutable container identities privately before an approved configuration-only rollout. Recreate only the API with its existing digest and `--no-deps --no-build --pull never`; keep MCP, scheduler, Auth, PostgreSQL, MongoDB, Redis and Caddy unchanged. Roll back using the saved environment and the same API-only command if the gate fails.

Verify the exact FPT income-statement GET and OPTIONS separately for the current origin, both approved Vercel aliases and an unrelated denied origin. Include validation responses and native browser response consumption. Successful CORS transport does not certify financial values or freshness.

Detailed health uses the consumer's certified screener Universe partition and its oldest actual constituent trade date, not independent global maxima. A missing receipt or trade date remains degraded. `screener_expected_session` uses the configured ICT close and `MARKET_HOLIDAY_DATES`; its calendar limitation is explicit, not official exchange-calendar certification. Before declaring recovery, compare the completed exchange session, active Universe membership, successful full-run receipt and every constituent trade date. Keep acquisition failures and stale disclosure visible; do not restamp dates, relax thresholds, fabricate completion markers or rewrite history.

For the QA release, set `PREDICTION_MARKET_POPULATE_ON_STARTUP=false` in the private serving environment before replacing the scheduler. This disables only the immediate restart-population task; normal daily and recurring prediction ingestion remain scheduled. The application default remains `true` for existing installations. Preserve the explicit release setting during rollback so a restart does not introduce an unrequested acquisition.

Auth has a separate native CORS policy. For GoTrue v2.177, map `GOTRUE_CORS_ALLOWED_HEADERS=${GOTRUE_CORS_ALLOWED_HEADERS:-apikey}` into the Auth service and set the matching private environment value. The missing `apikey` allowance can produce OPTIONS 204 without CORS headers and prevent the password POST. Preserve issuer, keys, redirects and the existing GoTrue origin behavior; `GOTRUE_URI_ALLOW_LIST` controls redirects, not CORS. Before an approved Auth-only recreation, save effective configuration and all container identities privately. Recreate only Auth on its retained image with `--no-deps --no-build --pull never`, verify the real sorted browser preflight and genuine password login, and confirm the other seven container identities/images are unchanged. Restore the saved Auth mapping/environment and use the same Auth-only command for rollback. No database restore or broader proxy policy is required.

### Auth image/schema compatibility maintenance

The issuing database must be resolved from the running Auth container's `GOTRUE_DB_DATABASE_URL`, without printing credentials. On 24 October 2026 it is `vnibb`, namespace `auth`, not a sibling database. Its `auth.sessions` includes `oauth_client_id`, `refresh_token_hmac_key`, `refresh_token_counter` and `scopes`; the served v2.177.0 model lacks all four and its `SELECT *` session read fails during genuine refresh. Do not remove columns, reset Auth, rewrite migration history or substitute frontend signed-out recovery.

The pinned official stable v2.188.1 image contains the matching session model and migrations through `20260302000000`; every one of its 69 migration versions is already present in this database. The multi-platform digest is `sha256:87db8c737af49a64236c461882ed3925f8b1e5c2c47176c64694dedc65153573`; its Linux ARM64 manifest is `sha256:220d95f056474405bed60681442aadf458aa722371ec5561a9d86a0603f9f2f9`. Sources: [session model](https://github.com/supabase/auth/blob/v2.188.1/internal/models/sessions.go), [migration inventory](https://github.com/supabase/auth/tree/v2.188.1/migrations) and [stable release](https://github.com/supabase/auth/releases/tag/v2.188.1). This deliberately matches the existing schema instead of introducing newer migrations.

Before authorized maintenance, retain the verified paired full-`vnibb`/Mongo backup and a separate private custom-format `pg_dump -d vnibb -n auth`, globals, validated TOC, checksums, effective configuration, migration versions, session columns and all container identities. TOC/checksum verification is not a restore test. Require no pending candidate migration and an effective Auth configuration diff restricted to the image. Use the current base Compose project and private environment, not dated runtime overrides; recreate only `auth` with `--no-deps --no-build --pull never`. Abort on changed environment, schema/migration versions or non-Auth identities/mounts. Verify genuine owned-account password login, refresh, online identity, protected access and logout/revoked-refresh rejection; delete only the owned fixtures. Native automatic refresh requires separate real browser afterproof, not a token/date simulation.

Rollback only Auth to the retained `supabase/gotrue@sha256:6a916b47af0386b7e0152ca84f3d45d050bf056e449a75a5460b48742fd67822` with unchanged configuration and the same service-only flags. That restores the prior service, including its known broken refresh; it is not a recovery claim. No database restore or downgrade is automatic. Unexpected startup migrations require a separate approved recovery decision using the retained backups.

### Bounded database optimization observation (24 October 2026)

Read-only cloud-01 diagnostics at 09:16–09:25 UTC used 5-second SQL statement and 1-second lock deadlines, Mongo `maxTimeMS: 3000`, and query-planner-first execution. The restored `ix_stock_price_date_only` remained valid and ready: global/daily latest-date reads took 0.132/0.098 ms with 5/4 cached blocks. Existing indexed VNM recent-price and per-source prediction reads took 0.431 ms and 0.145–3.021 ms respectively. These measurements do not justify another PostgreSQL index or configuration change. Preserve all current active and natural-key indexes; historical cumulative scan/dead-tuple counters alone do not justify destructive maintenance.

The metric-map reference reader now explicitly includes the existing partial index's string-symbol predicate: `symbol: {$eq: normalized_symbol, $type: "string"}`. The old unhinted query planned a collection scan over 6,972 documents (165.6 MB logical); the qualified query used `uq_metric_map_symbol_type_section_source` and examined 5 keys / 4 documents in 0 ms for each of VNM, ANI and FPT. Ordered full-document SHA-256 identities and field sets matched for all three symbols; the old comparison read was hinted to the same existing partial index to avoid executing a collection scan. Source, schema, sort, projection, cap and Mongo's existing matching-array semantics remain unchanged. The small retained sort needs no new index. No DDL, index removal, acquisition or production configuration write was performed. Rollback is an application-image rollback only; there is no database migration to reverse.

Private evidence is under `/home/compute_01/.config/vnibb/qa-main-release-20261024/database/` (`postgres-fresh-readonly.json`, `postgres-indexed-executions.json`, `fresh-readonly.json`, `mongo-indexed-experiment.json`, `mongo-result-equivalence.json`). The retained 05:51 UTC backup pair and manifest were present with matching manifest identity; this investigation did not perform a restore. Application tests and post-rollout actual-reader acceptance remain release gates, not claims from these diagnostics.

The subsequent bounded native listing attempt exposed separate schema drift, not a query-tuning issue: `ON CONFLICT (symbol)` failed because `public.stocks` retained only its ID primary key. At 09:39 UTC, all 1,754 rows had distinct non-null symbols, with no duplicate repair required; the ORM and actual listing writer both require symbol uniqueness. Migration `d47b2a61f903` (`20261024_1400_restore_stock_symbol_key.py`) restores only `CREATE UNIQUE INDEX CONCURRENTLY ix_stocks_symbol ON stocks (symbol)`, with 5-second lock and 120-second statement bounds, timeout restoration and fail-closed validation of an existing same-name index. It performs no row writes, deduplication or Alembic stamping. The downstream price natural key `(symbol, time, interval)` was already valid, ready, immediate and backed by its validated unique constraint.

Before approved live application, independently review the exact migration hash and `database/stock-key-maintenance.py`; its read-only `stock-key-preflight.json` rechecks the full stock-row hash, distinct/null counts, blockers, long transactions, protected container identities and both fresh 09:27 UTC backup payload checksums. Only explicit `--apply` runs the reviewed migration, then verifies the same row hash, unchanged revision and preserved old indexes. Keep this natural key during application rollback; automatic downgrade refuses removal, and dropping a newly created index requires separate provenance-checked schema approval. Preflight and source inspection are not live-application or test-pass claims.

After independent review and explicit parent approval, that exact migration was applied once on 24 October 2026. The wrapper exited 1 only during its post-apply hash lookup: setting `search_path` to `public` hid `pgcrypto`'s `extensions.digest`. No DDL retry was run. Independent bounded read-only inspection at 09:55 UTC confirmed the new symbol index was unique, valid, ready and immediate; all 1,754 complete rows retained the same ordered SHA-256, the prior primary-key index and all seven protected container identities were unchanged, and the Alembic revision stayed `f8c3a102d679`. No row DML or stamp occurred. `database/stock-key-acceptance.json` preserves both the failed wrapper and the actual-state adjudication; do not reapply the failed wrapper. A later full migration must validate the existing index idempotently rather than recreate it.

### Off-source recovery and independent key custody (25 October 2026)

Paired snapshot `20261024T100501Z` passed the existing strict, networkless
restore utility on a workstation distinct from cloud-01: 42 PostgreSQL public
tables, 1,754 stocks, 1,413,263 prices and all 17 populated Mongo collections
(8,086,310 documents, zero failures). Local verification/restore took 164.9 s;
authenticated transfer and full-hash verification took 689.267 s. The combined
855.130 s excludes application rebuild, DNS and traffic cutover; it is not a
full-service RTO or a recurring RPO guarantee. Scratch containers/volumes were
removed; serving containers and volumes were unchanged.

An additional age-encrypted copy is retained with private permissions. Its
recovery identity is independently retained on the existing deploy-01 account
in a 0700 directory with a 0600 identity file. Distinct-machine streaming decrypt
exited successfully in 419.281 s: the full encrypted hash and all three decrypted
member sizes/hashes matched the originals. No plaintext or encrypted archive
persisted on the custody host; temporary decrypt tooling was removed. This
establishes separate-host/store recovery, not a separate human custodian or
credential-compromise independence. Private plaintext originals remain retained;
retiring them needs a separately approved retention decision.

Exact artifact hashes, private custody location and observed receipts are in
`remaining-completion-20261025/offbox/drill-20261025T001456Z-536a67/` under the
existing private VNIBB evidence root. Never put the recovery identity in source,
chat, command arguments or the encrypted archive's storage location.

### Historical pre-release observation (13 October 2026)

Trusted public TLS and authorized read-only MCP were available on 13 October 2026 at `https://129.150.58.64.sslip.io`; `/mcp-health` and API health reported production revision `2c57654277ef5546662afc3cc7ed4a4e355e441e`. Production still reported source `KBS`, so readiness is not proof that the current IQ/free-VCI source policy is deployed. Strict known-host public SSH timed out and Tailscale reported `NeedsLogin`; host deployment, production migration and current backup inspection were not established.

Working-tree acceptance is based on source baseline `552e29678164eba168b90a0b64fff779bac84e55` plus uncommitted changes. That baseline is not a published image identity. Choose the expected revision from the reviewed, published release independently of endpoint responses; never set it to the observed old production revision to make a release gate pass.

Actual local PostgreSQL and MongoDB exports were preserved under `/home/compute_01/.config/vnibb/backups/qa123-20261013T084208Z/` as `postgres.dump`, `mongo.archive.gz` and a SHA-256/size manifest. Export success is not restore proof. Do not restore, downgrade or replace serving volumes as part of read-only acceptance.

### PR #125 production release observed (14 October 2026 UTC)

- Reviewed merge `701004108a0f03d0180cfc3a8eb4495af8d5fbcc` is deployed as `ghcr.io/kohnnn/vnibb-api@sha256:2289546802ea7a91a06417efd336acd297950d743da2d6b5020cf90577763604`, with IQ/Trading primary and free VCI supplementation. The parent's nine-step release gate passed: backend **2,908 / 4 skipped**, frontend **163 suites / 1,104 tests**. API, MCP and scheduler were healthy at that revision; API/scheduler recreation resumed serving at `20:33:23Z`. At `20:34:36Z`, the scheduler reported a running worker, **24 jobs, 0 missed** and an 8.2-second-old heartbeat. Five historical job failures remain recorded; deployment does not erase them.
- The reviewed plan/index/apply each exited 0. Apply inserted **1,256 income SQL rows, 23,193 reference SQL rows, 6,608 premium records, 6,968 metric maps and 10 profiles**, with actual count deltas verified. All **167,561 prior SQL rows, 1,459,585 premium records, 4 metric maps and 1,732 profiles** remained hash-identical; no prior observation was deleted or overwritten. Script SHA-256 `33a3668cffb2cfbf0d71e72c1e168ba9985d0682f2f2109050eca0e4a415f681`; frozen bundle SHA-256 `247452f5e3e8adf5eafa8c63232655439cbf76f7211e17151570359bb914750f`. Private evidence: `/home/compute_01/.config/vnibb/release-701004108a0f/structured-transfer-evidence-20261015-a.json`.
- Official MCP SDK over normal public TLS discovered **20 tools, 7 prompts, 5 resources and 1 template**; unauthenticated initialization returned 401 and authenticated SQL/Mongo status reads succeeded. All **27** fresh post-apply named reads passed: explicit EPS reached SQL as `VND/share`, raw records/descriptors remained retained, and unknown monetary units stayed withheld. Annual raw balance/cash and ratio reads remained honestly empty; unknown fiscal dimensions and preserved SQL conflicts were not inferred away. This is scoped read proof, not an all-gate or full-population acceptance claim.
- Actual production browser reads loaded VNM annual widgets and FY/Q transitions; ANI annual EPS showed **1,909.00 (2018)** and **3,166.00 (2019)** while revenue/net income remained dashes. The validation-degraded banner and stale validation dates remained visible; VNM fundamental-analysis timed out at 20 seconds. Do not claim every widget is healthy.
- Legacy **62** targets were exactly revalidated (**30 succeeded, 22 empty, 10 failed**) with all originals preserved. The later local reference bound changed **271** receipts (**129 succeeded, 41 empty, 100 failed, 1 deferred**) and retried **0** prior terminal receipts. At `20:26:35Z`, canonical **1,521** symbols still had **7,226** first-pass attempts pending; both first-pass and acquisition completion were false. No second bound ran. These local post-export changes are not claimed in the original production bundle; transfer a later delta before claiming them served. Matrix JWT/session and source-unit prerequisites remain unmet. Detailed checkpoints: [MCP/database QA plan](../mcp-database-qa-plan.md).

### 13 October 2026 concurrent-acquisition containment risk

The concurrent whole-STOCK run observed on 13 October 2026 is a bounded, cancelled-and-contained phase, not evidence of an aggregate one-request-per-second acquisition rate. Concurrent 09:00..09:12 UTC phases overlapped, so the observed request pressure is not additive throughput. Process containment on this host used a child exit and exact PID/fd selection; a `pidwait`-based wait is unsupported here and must not be used to conclude that queued phases ran sequentially. Preserve the existing native and root checkpoints; re-run `resume` with the same checkpoint/source/start/cutoff contract after containment before starting any further acquisition. Existing checkpoints remain valid and no observed run deleted data. The configured per-client floor (one request per second) applies per client/worker and does not by itself bound an aggregate rate; sequential continuation of a queued phase is claimed only after containment is confirmed. Do not add aggregate-rate or full-population claims to release evidence from this run.

The 685 terminal `failed` outcomes from that run were physically audited rather than assumed lost: raw 2,103,267 provider rows, 2,054,978 admitted to SQL, 48,289 rejected (48,195 OHLC bounds, 94 missing/negative/nonfinite), with **zero admitted-valid SQL rows missing across every symbol**; the follow-up 721-failure audit likewise found zero valid-missing. A real new-process admission of AAA returned 4,049 source rows against 4,048 persisted with a single `invalid_ohlc_bounds` rejection, classifying `partial_source_invalid` on an actual database. The writer therefore did not drop valid bars, raw rows remain retained, and the generic full-window error is reclassified as partial/source-invalid rather than valid-bar rejection. The native CLI records this per pair under `price_admission` (`source_rows`, `admitted_rows`, `rejected_rows`, `rejected_reasons`, `persisted_rows` and actual admitted/persisted bounds); a rejected window remains receipted `failed` behind the strict full-returned-window guard, so `resume` retries it and no short window is certified. Admitted persistence is not a claim of market truth, oldest-history coverage or complete exchange sessions.

### Durable population commands

Run from the repository root with private database credentials already loaded. Inventory is provider-free/read-only; `--apply` explicitly permits acquisition and writes. The SQL inventory reflects confirmed active SQL stocks, not every historical instrument or proof of populated datasets.

```bash
PYTHONPATH=apps/api apps/api/.venv/bin/python scripts/backfill_prices_to_2019.py inventory \
  --datasets financials,ratios,reference,market,eod
PYTHONPATH=apps/api apps/api/.venv/bin/python scripts/backfill_prices_to_2019.py resume \
  --apply --bootstrap-listing --start 2000-01-01 \
  --datasets financials,ratios,reference,market,eod --max-pairs 50 \
  --budget-seconds 300 --window-days 30
```

The root CLI supports `inventory`, `backfill` and `resume`. Applied runs without `--symbols` bootstrap actual Trading-confirmed STOCK listings before selecting the active SQL universe. Cached `--universe-file` input requires explicit `--bootstrap-listing` and retains its source/observation date. Financial acquisition requests closed annual/quarterly periods since `--start`; ratios expose only available provider history; reference and `market` reads remain current/universe-level rather than historical-depth acquisition. EOD catch-up windows are at most 30 calendar days and 50 symbols per run. Its omitted-`--end` default is today minus 7 days, keeping the recent ≤7-day tail with the separate incremental owner while the historical walk covers the older span up to that boundary; pass an explicit `--end` to override it. Receipts, not existing row counts, determine pending and failed work.

`--symbols` selects work, not a smaller SQL maintenance cycle. Per-symbol SQL datasets retain the full active universe in `expected_symbols`; subset runs preserve acquired/failed progress outside the selection, and SQL inventory reports canonical-cycle completion rather than subset completion. `market` retains its universe sentinel scope. The report lists the selection separately as `universe.work_symbols`.

SQL inventory reconciles saved receipts against the current canonical active universe without changing the saved cycle. Newly active symbols are pending even when the saved cycle status is `completed`; removed symbols no longer affect current acquisition completion.

`--datasets` accepts `financials`, `ratios`, `reference`, `market` and `eod` and defaults to all five; request one dataset per bound run when isolating evidence. Financials and ratios retain annual+quarterly stage receipts per symbol; reference issues eight stage receipts per active symbol. `market` is universe-level: existing `sync_market_indices`, `sync_market_sectors` and `sync_sector_performance` write one sentinel receipt for the latest indices plus sector taxonomy/performance, with no historical-depth claim. EOD records one symbol/window pair. Cycle names are `universe_backfill_<dataset>_2000` for historical financials and `..._current` for current-scope datasets.

The bounded root `--max-pairs` attempt budget applies per invocation. Both CLIs distinguish never-attempted work (no receipt, or a `pending` outcome) from terminal outcomes (`succeeded`/`failed`/`empty`). Root inventory additionally reports `deferred_count`, `incomplete_attempt_count` and `first_pass_complete`: zero unattempted alone does not exhaust an interrupted first pass. Use `resume --first-pass-only` to acquire pending/deferred/interrupted pairs without retrying terminal failures; stop only when `first_pass_complete` is true. `pending_count` counts every pair not acquired, including failures; `acquisition_complete` and historical completeness are separate. Never treat process exit 0 or row count as completeness proof.

Legacy empties require an exact audited manifest, not a blanket reset. `resume --apply --datasets reference --revalidate-empty-file /private/pairs.json --max-pairs 62 --budget-seconds 3300` uses the existing strict provider boundary without listing bootstrap. Each manifest row requires `symbol`, `stage`, `expected_last_attempted_at` and `expected_last_succeeded_at`. Only timestamp-matching empty receipts, or interrupted revalidations retaining that original receipt, are attempted; changed/terminal revalidated pairs are skipped. Original evidence remains in `previous_empty_receipts`. Other succeeded/empty pairs remain untouched; failed revalidations are explicit failures, not confirmed empty. Pin normal continuation with explicit SQL-confirmed `--symbols` to avoid a fresh listing bootstrap. Use unique logs and an outer timeout longer than the invocation budget; do not restart a mixed financial/reference launcher merely to resume references.

Before any bounded revalidation request starts, every timestamp-matched target is checkpointed as outstanding, with its original empty evidence retained. Unattempted targets have outcome `pending` and `revalidation_pending: true`; attempt/time bounds cannot certify them as acquired. Resume the same manifest to finish pending/deferred/interrupted targets; successful revalidation clears the marker without duplicating the original evidence.

For native provider-history STOCK acquisition, preserve one checkpoint contract and captured Trading universe across invocations:

```bash
PYTHONPATH=apps/api apps/api/.venv/bin/python apps/api/scripts/vietcap/backfill_vietcap.py inventory \
  --symbols STOCK --datasets listing,ohlc --count-back 10000 \
  --start 2000-01-01 --cutoff 2026-10-13 \
  --universe-file /private/trading-getAll-envelope.json \
  --checkpoint-file /private/stock-ohlc-checkpoint.json
PYTHONPATH=apps/api apps/api/.venv/bin/python apps/api/scripts/vietcap/backfill_vietcap.py resume \
  --apply --symbols STOCK --datasets listing,ohlc --count-back 10000 \
  --start 2000-01-01 --cutoff 2026-10-13 --max-pairs 1754 --budget-seconds 3300 \
  --universe-file /private/trading-getAll-envelope.json \
  --checkpoint-file /private/stock-ohlc-checkpoint.json
```

The dated native example uses the observed 1,754-STOCK inventory, including 232 DELISTED instruments; delisted rows persist inactive, while 1,522 listed STOCK form that observation's active set. Do not freeze those counts as an enduring provider guarantee. `backfill` also accepts the same native options; retry `resume` with the same source, start, cutoff, count-back and checkpoint. Successful symbol/dataset pairs skip; empty/failed pairs retry fairly. `--max-pairs` bounds attempts, not universe size, and the time budget stops new pair starts rather than cancelling an in-flight synchronous call. Checkpoint success requires the applicable Mongo/SQL writes; it does not establish full-history or exchange-session completeness. Native `--datasets all` includes `ohlc,financials,ratios,company,shareholders,listing,indices,icb`; support and unit limitations remain dataset-specific.

Read-only native history probes observed MSR `2015-09-17..2026-10-13` (2,766 bars), VCB `2009-06-30..2026-10-13` (4,316) and VNM `2006-01-19..2026-10-13` (5,167). These are returned provider ranges, not verified oldest available dates, all-symbol coverage or complete exchange sessions. Acquisition launched for the whole STOCK scope is not completion evidence. See [Auto Update Strategy](AUTO_UPDATE_STRATEGY.md) for recurring durable-cycle owners; detailed acceptance evidence stays in `mcp-database-qa-plan.md`.


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
- `DATA_BACKEND=postgres`
- `ALLOW_ANONYMOUS_DASHBOARD_WRITES=true`
- `MONGODB_URL` for shared market/raw analytical records used by microstructure widgets
- `MONGODB_DATABASE=vnibb-market`
- `MONGODB_ENABLED=true`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`
- `VNIBB_MCP_URL=http://mcp:8001/mcp`
- `VNIBB_MCP_SHARED_BEARER_TOKEN`
- `MCP_PUBLIC_BIND=127.0.0.1`
- `MCP_PUBLIC_PORT=8001`
- `VNSTOCK_RUNTIME_TIER=free` and `VNSTOCK_SOURCE=VCI`; paid tiers and alternate source routing are rejected
- `REDIS_URL` if the cache tier remains enabled
- `MEMORY_CACHE_MAX_ENTRY_BYTES=1048576` or larger if the cache tier is disabled and microstructure payloads must fit memory fallback
- `SENTRY_DSN`
- `ADMIN_API_KEY`
- `ADMIN_USER_IDS` (comma-separated verified immutable Supabase operator UUIDs; empty denies interactive admin access)
- `ADMIN_REVOKED_SESSION_IDS` (comma-separated denied session UUIDs)
- `ADMIN_SESSION_MAX_TTL_SECONDS=3600` (maximum accepted signed token lifetime, `exp - iat`)
- `LOG_FORMAT=json`
- `CORS_ORIGINS`
- `VNIBB_API_IMAGE_REPOSITORY` as the registry repository and `VNIBB_API_IMAGE_DIGEST` as the published `sha256:<digest>`
- resource and log limit values from `deployment/env.oracle.example`, adjusted only after a measured baseline

### System layout templates

No manual layout-store setup is required. Draft and published system layouts live in the Postgres `app_kv` table under the `system_layout_template` key prefix. Interactive draft/publish additionally requires a verified, allowlisted Supabase session.

### Admin session migration — production BLOCKED

Interactive `/api/v1/admin/*` requests require a Supabase access JWT in `Authorization: Bearer ...`; shared keys no longer authorize these requests. Verify the operator's immutable user UUID through the existing Supabase project/admin interface and add it to backend `ADMIN_USER_IDS` as a comma-separated string. Never use email, browser role flags, or a query against the serving PostgreSQL `auth` schema as authority: the existing authentication service is separate from serving PostgreSQL.

Backend JWT verification uses the existing project's HS256 `SUPABASE_JWT_SECRET`, issuer `${SUPABASE_URL}/auth/v1` (normalize the URL's trailing slash), and audience `authenticated`. Tokens must include `exp`, `iat`, `sub`, `session_id`, `iss`, and `aud`; `sub` and `session_id` must be UUIDs. `ADMIN_SESSION_MAX_TTL_SECONDS` (default 3600, ceiling 86400) rejects tokens whose signed lifetime exceeds that bound and must be kept at or above the Auth service's JWT expiry (`GOTRUE_JWT_EXP`); a shorter backend bound denies every operator once the issuer lifetime is longer. Every interactive request additionally queries `${SUPABASE_URL}/auth/v1/user` with `SUPABASE_ANON_KEY` and the caller bearer token; require HTTP 200 and matching immutable user UUID. Never expose signing secrets to the frontend. Missing online authority configuration or unavailable Auth fails closed (503); account for Auth latency/load and the dependency in monitoring.

Supabase sign-out removes the session row, so the online Auth check denies subsequent admin requests after sign-out completes; a signed JWT itself remains valid until expiry and must not be treated as proof of an active session. Validate this behavior with the configured Auth project before production enablement. Emergency backend controls remain: add a session UUID to comma-separated `ADMIN_REVOKED_SESSION_IDS`, or remove the operator UUID from `ADMIN_USER_IDS` for all their admin sessions. An empty allowlist denies access. Roll **all API workers/replicas** after policy or signing changes; stale workers retain old authorization state. Auth outages/timeouts deny all interactive admin operations rather than falling back to JWT-only access.

`ADMIN_API_KEY` is now a **server-only automation/operations secret**. Layout publishers use `GET` / `PUT /api/v1/admin/automation/system-layouts/{dashboard_key}` with `X-Admin-Key` and fixed actor `automation:layout-publisher`; do not send `X-Admin-Actor`. Retained `/data`, realtime start/stop, and metrics/debug operational routes still consume this secret. Never put it in browser settings or `NEXT_PUBLIC_*` variables. The two `apps/api/scripts/publish_*_markets_layout.py` publishers read `ADMIN_API_KEY` from their execution environment.

Before cutover, clear the formerly stored platform admin key from every operator browser profile/site storage, rotate the formerly browser-exposed key in backend and authorized automation/operational secret stores, and roll all workers. Clearing browser storage is not revocation, and the stored value must never be read out or pasted into analytics, tickets, or chat; verify the old key fails and the rotated key works only on authorized automation/operational routes.

If that historical value was also assigned to `VNIBB_APPS_SCRIPT_KEY` or
`VNIBB_MCP_SHARED_BEARER_TOKEN`, rotate all affected scopes to independent secrets;
changing only the admin variable does not revoke the other grants. Keep each
delivery file `0600` in private custody and verify old-key rejection, own-scope
success and cross-scope denial without logging headers or secret values. Retain
new credentials during an image rollback; restoring the old environment would
reactivate an exposed credential. External Apps Script/MCP callers need their
respective new secret, not the admin automation key.

The October 25 continuation explicitly keeps `ADMIN_USER_IDS` empty. Rotation
does not enable interactive admin or authorize silent account promotion. Actual
serving Compose labels decide the recreation commands: application services use
the base file, while Caddy uses base plus runtime override. Do not combine them
when the runtime override changes application mounts. An authorized same-image,
same-config Caddy recreation removes obsolete inherited secret copies; it does
not change proxy routing. Auth, PostgreSQL, MongoDB and Redis stay untouched.

Interactive admin production acceptance remains **BLOCKED** until operator UUID verification, key rotation, authenticated live acceptance (including completed sign-out/revocation), and documented Auth availability/latency operations are recorded. Acceptance must cover allowlisted draft/publish and published reload, non-allowlisted and expired/denied-session rejection, shared-key rejection on interactive routes, and rotated-key automation. See `docs/admin_global_system_layouts.md` for the full rollout checklist.

### 2026-10-04 interrupted-session release recovery

- After renewed SSH approval, API, MCP and scheduler were deployed at `ffc322e3cdc097977a4dfdb90581a466e7912e66`, pinned to `ghcr.io/kohnnn/vnibb-api@sha256:9431643d277b6163e20bcf12b672da73521bf07e4c4ced86474e242d70b0c4f0`. Hosted CI run `37196945853` passed all four jobs; ARM64 publication run `37197003854` passed. Migration head remains `b7312f0c4e88`.
- Release scope and evidence are tracked in [issue #97](https://github.com/Kohnnn/vnibb/issues/97). Existing untracked Matrix readability artifacts belong to a separate acceptance investigation and must not enter the release upload.
- All three application containers passed health-gated replacement with zero restarts. PostgreSQL, MongoDB, Redis, Auth and Caddy container IDs were unchanged. The shared `vnibb_vnstock_runtime_8fb090c` mount remains attached to all three services. Private rollback configuration is retained under `deployment/backups/recovery-20261004-ffc322e/`; previous image digest is `sha256:0f29208a5a86893b21ffb143d7cb049eef63f6cd77753a5eb0e089cb9d63905d`.
- On cloud-01, preserve the premium runtime mount by including both `-f docker-compose.oracle.yml` and `-f deployment/docker-compose.oracle.runtime.yml`, plus `--env-file deployment/env.oracle`, in every rollout command. Keep existing database/proxy containers untouched. Back up the environment, pull the pinned digest, run the one-shot migration check, then replace only `api`, `mcp`, and the profiled `scheduler` with health-gated rollback.
- The canonical frontend project is `apps/web/.vercel/project.json` (`vnibb-web`), not the obsolete root `.vercel` link. Verify the actual production browser and release identity after deployment.
- Public readiness, VNM profile/quote, screener, microstructure, dashboard, CORS and WebSocket smoke passed. Authenticated MCP initialization exposed 18 tools; database connectivity and symbol-scoped analytical reads passed. Depth returned empty for the legacy SSI record with no flat price/volume fields, matching storage; this rollout does not restore overwritten levels or claim a fresh premium provider fetch.
- Durable scheduler status reports a running worker and 22 jobs. Startup logs contain prediction-source failures for PredictIt, Limitless and Manifold; durable status also retains `daily_sync` and `financial_ratios_sync` failures. These outcomes remain visible rather than being reported as successful ingestion. API and MCP startup logs had no error lines in the reviewed 15-minute window.
- Production frontend readiness and a real Fundamental Analyst starter draft passed after backend replacement; no prompt was sent. Frontend deployment remains `dpl_789A8Gc5UziYCD4PxFc23dKPhaVZ`; subsequent documentation-only commits are not backend image revisions.

**2026-10-05 financial-ratio natural-key repair (deployed):** Before the repair,
a production census found only `financial_ratios_pkey` in `pg_constraint` and
`pg_indexes` for `financial_ratios`; `uq_financial_ratio_symbol_period` was absent.
The initial migration, `20260125_0842_1aaa2a1cf198_initial_schema.py:258`, already
declares `UNIQUE (symbol, period, period_type)`. This establishes live-schema drift,
not when or why it occurred. Without the constraint, the ratio writer's
`INSERT ... ON CONFLICT (symbol, period, period_type)` fails with
`InvalidColumnReferenceError: there is no unique or exclusion constraint matching
the ON CONFLICT specification`.

This is distinct from the recorded `financial_ratios_sync` durable failure above,
whose `last_detail` is `exceeded 5400s` (a timeout, not a constraint error). The
missing constraint is a separate, proven write hazard that would block ratio
persistence even after the timeout is resolved; no production log line attributing
the timeout to the constraint was observed.

- Migration `e5f1a7c9d2b4` (``apps/api/migrations/versions/20261004_1700_restore_financial_ratio_natural_key.py``) restores the constraint losslessly and idempotently: it scopes its existence probe to the target relation, deduplicates only where duplicate keys exist (production measured zero across 17,400 rows, keeping the newest `id`), and adds the `UNIQUE` constraint. Downgrade drops it.
- Verified against a disposable PostgreSQL: full migration chain to `e5f1a7c9d2b4` from both an empty database and a simulated drift state (constraint dropped, row present); the exact production `get_upsert_stmt` writer then updated the existing row in place. The PostgreSQL contract test (`apps/api/tests/test_contract/test_financial_ratio_natural_key_migration.py`) and the full release gate pass.
- Deployed 2026-10-05. API, MCP and scheduler run `2c57654277ef5546662afc3cc7ed4a4e355e441e`, pinned to `ghcr.io/kohnnn/vnibb-api@sha256:c87b372fc0416a7369a2a01ba58c56d6fb79d9435ac1dcc33b6512362f7bda4e` (publication run `37222432293`). The one-shot `migrate` applied `b7312f0c4e88 -> e5f1a7c9d2b4`; `migrate current` reports `e5f1a7c9d2b4 (head)`. `uq_financial_ratio_symbol_period` now exists, all 17,400 `financial_ratios` rows are preserved with zero duplicate keys, and a natural-key upsert was accepted inside a rolled-back transaction. API/MCP health and the scheduler heartbeat pass at the new revision. Databases, Caddy and the premium runtime mount (`vnibb_vnstock_runtime_8fb090c`) were untouched; only `api`, `mcp` and `scheduler` were recreated.
- Rollback: restore `deployment/env.oracle` from `deployment/env.oracle.bak-ratio-natural-key-20261004T180818Z` (previous digest `sha256:03e2b18758840932515094c5e13ded9b60a3e558a98512b42e3c1101f6d5eb4e`), `docker compose ... pull`, then `up -d --no-build --force-recreate api mcp` and the profiled `scheduler`. `alembic downgrade b7312f0c4e88` drops the constraint if a code rollback requires it. The `financial_ratios_sync` 5400s timeout is a separate open issue that this release does not claim to fix.

### Build and publish the release image

Build the credential-free image outside OCI. The Docker build rejects discoverable sponsor packages, including `vnii`; never reuse historical premium runtime mounts or supply sponsor installer credentials. Existing dated rollout evidence above is historical, not the current build policy.

```bash
export IMAGE_RELEASE_REVISION="$(git rev-parse --verify HEAD)"
bash scripts/oracle/build_release_image.sh registry.example.com/vnibb/api:<release-tag>
```

After publishing, resolve the registry's manifest digest and set `VNIBB_API_IMAGE_REPOSITORY=registry.example.com/vnibb/api` plus `VNIBB_API_IMAGE_DIGEST=sha256:<published-digest>` in `deployment/env.oracle`. Compose joins these fields as `repository@digest`, so a mutable tag cannot enter the release path. The image stores its build revision in `/app/.release-revision`; stale `RELEASE_REVISION` runtime keys cannot override health, logs, or Sentry. The identical image value is used by API, MCP, scheduler, and the one-shot migration service.

Release smoke scripts use normal HTTPS certificate validation. A certificate or trust-chain failure blocks verification; repair the certificate/trust configuration instead of adding `--insecure`. `CURL_CA_BUNDLE` can select an explicitly trusted CA bundle when the deployment uses a private CA.

### Bound local release and CI image storage

Run this on the Docker host **after pulling the prepared immutable release**, after a successful rollout, and after each local CI build batch. Install the approved daily timer below so cleanup also runs when no release occurs. Build/publish off production; this procedure removes accumulated local artifacts, not registry images. Keep the independent rollback digest from the prior verified release, not a tag or a value copied from current health. Both protected images must already resolve locally; a missing prepared/rollback image stops even the plan. Do not substitute the current image for a missing rollback.

```bash
# Set these from reviewed release records; do not copy the literal placeholders.
ROLLBACK_IMAGE='ghcr.io/kohnnn/vnibb-api@sha256:<verified-rollback-digest>'
PREPARED_IMAGE='ghcr.io/kohnnn/vnibb-api@sha256:<reviewed-prepared-digest>'
retention=(--repository ghcr.io/kohnnn/vnibb-api --workdir /app/VCIDataPlatform
  --rollback-image "$ROLLBACK_IMAGE" --prepared-image "$PREPARED_IMAGE" --keep 2)
python3 scripts/oracle/cleanup_images.py "${retention[@]}"
# Review every full ID, references, WorkingDir and remove/keep decision above.
# Save both JSON inventories in the private release evidence directory.
python3 scripts/oracle/cleanup_images.py "${retention[@]}" --apply
docker system df
```

The default is **plan only**. Explicit apply inventories full IDs before the first removal, rechecks all container references before each removal, and uses only `docker image rm --no-prune <full-ID>` without force. Mutable tags or digest references are never removal operands. Images with multiple local references are withheld for separate manual review, not automatically untagged. Every running **or stopped** container image, the configured rollback, and the pulled prepared release are protected. Each selected repository retains its newest two additional eligible unused images; the exact `/app/VCIDataPlatform` WorkingDir family retains its newest two **untagged** unused CI images. Unknown families, tagged CI images and images also referenced by an unselected repository are untouched. Count retention, not age, bounds eligible artifacts even during frequent builds. Protected/stopped-container images, multiple-reference images and excluded families can still grow: inspect the printed inventory and resolve those owners explicitly instead of widening scope silently. Pause builds/tag changes while reviewing/applying; Docker removal conflicts fail visibly and must be investigated before rerunning. Do not add `--force` to bypass Docker's guards.

This procedure never removes containers, volumes, build cache, database history or backup sets. Do not replace it with `docker system prune`, `docker image prune -a` or any volume prune. Backup retention remains seven verified sets and is independent of image retention.

#### Install the approved daily native timer

The checked-in service is a bounded oneshot, not a daemon: Docker must be available, the required private environment file must exist, both immutable images must resolve, and failure remains visible in systemd/journal. It applies the same explicit repository and untagged CI WorkingDir scope as the reviewed plan, with a 300-second timeout and idle I/O/low CPU priority. The daily `Persistent=true` timer catches a missed run after boot; installation itself requires operator approval and is not performed by the source changes.

After the plan above has been reviewed, confirm the reviewed checkout/helper is installed at `/srv/vnibb` and `/usr/bin/python3` is available. Install the units and a root-only file with the **actual** protected image values; no default digest is provided:

```bash
# ROLLBACK_IMAGE and PREPARED_IMAGE must be the reviewed local immutable images above.
# PREPARED_IMAGE is the image selected by deployment/env.oracle, pulled before enabling.
sudo install -d -m 0700 /etc/vnibb
sudo install -m 0600 /dev/null /etc/vnibb/image-retention.env
printf 'VNIBB_ROLLBACK_IMAGE=%s\nVNIBB_PREPARED_IMAGE=%s\n' \
  "${ROLLBACK_IMAGE:?Set the verified rollback image}" \
  "${PREPARED_IMAGE:?Set the pulled deployment image}" | \
  sudo tee /etc/vnibb/image-retention.env >/dev/null
sudo install -m 0644 deployment/vnibb-image-retention.service deployment/vnibb-image-retention.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/vnibb-image-retention.service /etc/systemd/system/vnibb-image-retention.timer
sudo systemctl daemon-reload
sudo systemctl start vnibb-image-retention.service
sudo systemctl status vnibb-image-retention.service --no-pager
sudo journalctl -u vnibb-image-retention.service -n 30 --no-pager
sudo systemctl enable --now vnibb-image-retention.timer
sudo systemctl list-timers vnibb-image-retention.timer --no-pager
```

The service journal contains the full-ID inventory and successful removals. Treat nonzero/failed units, missing protected images, growing withheld families or a missed daily run as operator failures to investigate, not successful retention. Check `systemctl --failed` and the service journal with routine host monitoring. Bound applies to the selected eligible families, not to live/stopped containers, manually withheld images or unrelated Docker data.

Before a release pull or rollback, stop the timer and wait for any active oneshot to finish (`systemctl is-active vnibb-image-retention.service` must no longer report `active` or `activating`). Pull the new prepared image, update both entries in the root-only environment file from the independently reviewed release/rollback records, rerun the plan, then restart the timer. After successful deployment, leave `VNIBB_PREPARED_IMAGE` at the current selected deployment digest and retain the explicitly verified rollback digest. Never resume the timer with stale rollback/prepared configuration; the file does not auto-read Compose or infer release identity. To suspend automated application, use `sudo systemctl disable --now vnibb-image-retention.timer`; this does not remove images or volumes.



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

Load `VNIBB_MCP_SHARED_BEARER_TOKEN` from the private secret store without printing it. Export `EXPECTED_REVISION` as the full SHA of the independently reviewed/published target release, not a value copied from production health. A dirty source baseline cannot identify a deployed image. The MCP wrapper requires this value; a mismatch is a failure, not a reason to change the target.

```bash
bash scripts/oracle/healthcheck.sh
bash scripts/oracle/smoke_test.sh
bash scripts/oracle/runtime_verify.sh
EXPECTED_REVISION="$EXPECTED_REVISION" BASE_URL=http://127.0.0.1:8001 bash scripts/oracle/mcp_smoke_test.sh
BASE_URL=https://oracle-api.example.com bash scripts/oracle/healthcheck.sh
CORS_TEST_ORIGIN=https://vnibb.vercel.app BASE_URL=https://oracle-api.example.com bash scripts/oracle/smoke_test.sh
BASE_URL=https://oracle-api.example.com bash scripts/oracle/runtime_verify.sh
EXPECTED_REVISION="$EXPECTED_REVISION" BASE_URL=https://oracle-api.example.com bash scripts/oracle/mcp_smoke_test.sh
```

Notes:

- The scripts default to `http://127.0.0.1:8000`, which is useful for local VM rehearsal before DNS is live.
- The MCP smoke script now defaults to `http://127.0.0.1:8001`, which matches the host-published `vnibb-mcp` port on OCI.
- Override `CORS_TEST_ORIGIN` when validating a non-default frontend origin.
- Set `VNIBB_MCP_SHARED_BEARER_TOKEN` in the shell before running the MCP smoke script against a protected deployment.

### Read-only MCP acceptance gates

The wrapper reuses `scripts/oracle/mcp_acceptance.py` for narrow smoke checks. Full acceptance uses the SDK client, current source-derived schemas/catalogue and actual call ledger; it performs no provider ingestion, Matrix writes, fixture creation or revocation. Run the full audit separately for local and deployed targets, retaining distinct report files and independently selected revision identities:

```bash
apps/api/.venv/bin/python scripts/oracle/mcp_acceptance.py \
  --expected-revision "$EXPECTED_REVISION" \
  --mcp-url https://oracle-api.example.com/mcp \
  --health-url https://oracle-api.example.com/mcp-health \
  --report /private/mcp-production-acceptance.json \
  --identity-url "${SUPABASE_URL%/}/auth/v1/user" \
  --matrix-fixtures /private/matrix-existing-fixtures.json
```

For local acceptance, use `--mcp-url http://127.0.0.1:8001/mcp`, `--health-url http://127.0.0.1:8001/health` and a separate report/expected build identity. The eight gates cover OHLC window/session/unit safety; financial period/source/unit/scale/basis; Mongo shape/scope; bounded discovery and schemas; authorization/scope/revision; redaction; verified-user Matrix ownership/selection/denials; and actual large nested results/arguments. Reports distinguish executed and unexecuted identifiers, preserve complete redacted nested responses and record source SHA-256; no advertised call count substitutes for observed execution. Defaults are 30 seconds per request and a finite 1,800-second whole-run deadline. Revision mismatch still permits read auditing but fails release identity.

`VNIBB_MATRIX_OWNER_JWT` and `VNIBB_MATRIX_OTHER_JWT` must be distinct real active user sessions, verified through the issuing Auth `/auth/v1/user` endpoint; optional `VNIBB_MATRIX_AUTH_API_KEY` is supplied only through environment. Existing fixture JSON carries `owner_id`, `other_id`, `positive`, `expected_positive`, `revoked`, `invalid` and `export_denied`; selection arguments use `snapshot_id`/`result_ids`, and `expected_positive` is the exact expected packet. A service key, signing secret or shared deployment bearer cannot replace active user sessions. Missing sessions/fixtures keep mandatory Matrix acceptance BLOCKED. Unknown financial units/basis remain PARTIAL; empty results do not pass content gates, and unsupported TTM/provider-history claims remain separate from successful reads.


### Log review

```bash
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs api --tail=200
docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml logs caddy --tail=200
```

### What to confirm

- `/live`, `/ready`, `/health/`, and `/api/v1/health` return `200`
- `/health/` reports `providers.data_backend=postgres`
- `/health/` reports `providers.allow_anonymous_dashboard_writes=true`
- `/api/v1/dashboard/` returns `200` when called with `X-VNIBB-Client-ID`
- `/mcp-health` returns `200`
- `/mcp` accepts MCP initialization and `get_database_status`
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

### 2026-09-26 capacity incident handoff

**Update, 2026-09-26:** the operator chose snapshot cleanup instead of volume
expansion. With the scheduler stopped, both prediction snapshot tables had no
referencing foreign keys or user triggers. An authorized `TRUNCATE` of only
`prediction_market_intraday_snapshots` and `prediction_market_snapshots`
(`CONTINUE IDENTITY RESTRICT`, no cascade) reduced them from 115,951,763,456 and
1,582,907,392 bytes to 48 KiB and 40 KiB. Both tables were verified empty; root
usage fell from 182 GiB to 72 GiB, with 121 GiB available. The market catalogue,
equity data and verified off-host pair were untouched. Online snapshot history
after the September 24 backup was discarded with this cleanup. The scheduler
remains paused pending deployment and smoke proof of bounded writers. The
expansion-only handoff below records the earlier decision, now superseded.

The portable backup producer passed 42 script regressions and then completed
paired set `20260926T053513Z` on the host (PostgreSQL 1,292 MiB, Mongo 375 MiB).
Mongo's stopped container was restarted after disk recovery; API readiness and
PostgreSQL/Mongo container health were verified. Although the transfer command
timed out during renewed SSH authorization, independent local byte-count and
SHA-256 checks verified both complete artifacts: PostgreSQL 1,355,316,151 bytes
and Mongo 393,300,936 bytes. The fresh off-host pair and the older restored pair
are both retained. The new pair passed isolated restore with exit 0 and
`RECOVERY OK` in 376.0 seconds: 42 public tables, 1,754 stocks, 1,748,069 prices;
7,983,753 Mongo documents, zero failures and 16 populated collections. Both
recovery containers were removed before success.

Local PostgreSQL smoke proved the new migration's historical UTC bucket
backfill, unchanged measurement timestamps, repeat upgrade, duplicate bucket
rejection, concurrent writer serialization, capacity refusal and independent
pruning. These proofs do not mean the new image is deployed. Tailscale SSH
authorization expired before rollout; scheduler and backup cron remain paused.

Final local release gate passed all nine steps: 611 frontend tests and 896
backend tests passed, one backend test skipped; frontend lint/typecheck/build,
changed-lines Ruff and backend compile passed. One earlier full-suite capacity
test failure did not recur in the scoped/prefix checks or either subsequent
complete backend run; no storage guard was weakened to obtain a pass.

All nine CI gates passed (896 backend tests passed, one skipped). The frozen
release context is `/tmp/vnibb-bounded-release-20260926`; `source-manifest.json`
records its exact SHA-256 and base commit. Revision
`20fa4c392e22a42b2d150de22989bb2331a98adb+workspace.1d2ed1c1dca42ecd`
explicitly identifies uncommitted workspace content, not a committed release.
The ARM image is published at
`ghcr.io/kohnnn/vnibb-api@sha256:731f2845278e3c8d61de6689fb19e729ea1ca48826ba92adb74ad98ef6704d6d`.
The clean build could not obtain pinned `vnstock` from PyPI, so this code-only
release preserves dependencies from production digest `sha256:49c167d79177453c2962953022f9cf0ecb072646c48c504d13b1271f49349ed3`.
An actual ARM container imported the new module from `/app/vnibb`, reported the
expected revision, and exposed limits 5,000 / 1,000 / 4,294,967,296 bytes.
`release-manifest.json` and `Dockerfile.release` in the frozen context record
the reproducible inputs. After renewed SSH authorization, this exact digest
was deployed to API, MCP and scheduler with the runtime Compose override intact.
Migration head is `a926b4d87501`; all three application containers and both
databases reported healthy with zero restarts. Backup cron was restored at
`/etc/cron.d/vnibb-backup`; production root has 120 GiB free.

Production smoke ingested 20 live Kalshi markets, wrote 120 genuine daily and
intraday snapshots, and repeated both writes with zero duplicates. Startup
population brought the bucket to 1,000 Kalshi plus 100 Polymarket rows. The
09:30 UTC scheduled intraday capture wrote 1,100 rows in 0.4 seconds, while its
independent prune completed successfully. Daily prune was exercised directly;
its scheduled cadence is 10:45 UTC. Combined snapshot allocation measured
1,904 KiB after the scheduled run, not the previous 108 GiB. Public `/ready`
returned true. PredictIt 403, Limitless 404 and Manifold 400 remain explicit
provider failures; they do not prevent the working sources from refreshing.

A separately prepared candidate (not the deployed digest recorded above) is
`ghcr.io/kohnnn/vnibb-api@sha256:1bef9b2e40fdbd38aae7ffa019129e86b518c3bae3283c68ffad0ba7ad12734c`,
revision `workspace-275585246b26fc436831273cb1517e912688f7ea43cecb4ddf76906fc2a9ab43`.
Its provenance and verification manifest is
`/tmp/vnibb-prediction-release-manifest.json`. It uses the same pinned production
dependency base, installs the current application with `--no-deps`, and passed
an actual ARM64 appuser import/revision/source-digest smoke including real
`vnstock 4.0.4` and migration `a926b4d87501`. That candidate is not the image
selected for the verified rollout above; always use the live container digest
and `/health/` revision rather than candidate naming to identify production.

**2026-09-27 fresh-cap follow-up (historical observation):** Kalshi filled
the historical 10,000-row source quota, refusing new markets. The follow-up
code counts only fresh eligible contracts toward that quota while retaining
older catalogue history; the then-current independent physical guard was 16 GiB.
At that session, 52 prediction tests and a full backend run (976 passed,
one skipped) passed. The existing `(source, updated_at DESC, id)` partial
index served the fresh-cap query without a new migration; catalogue-retention
index migration `b7312f0c4e88` applied during the earlier cutover.

The recorded ARM64 follow-up image was
`ghcr.io/kohnnn/vnibb-api@sha256:6f560d3d6cdda1f631907a44c206f2e30aa3cb30572d2cd5a8b542609de13968`
(revision `d3a6fdf1b6856cc9238deef6fb15cffe667655a3961f870c8764f9fa0acf0675`),
with source/dependency manifest `/tmp/vnibb-fresh-cap-release-manifest.json`.
The earlier session recorded runtime verification and a scheduled ingest of
400 Kalshi and 100 Polymarket markets, with 400 recently created non-combo
Kalshi rows and approximately 66.8 MB combined snapshot allocation. Its
rollback environment copy was
`deployment/env.oracle.pre-fresh-cap-20260927T141447Z` on the host. These are
historical observations, not a current production pin; the other three
providers had explicit upstream 403/404/400 failures.

**Current-serving check (2026-09-27 19:14 UTC):** `/api/v1/health/detailed`
reported revision `7c9274e6a060615484832b9838804eb53eb4cc9b`; API, MCP and
scheduler were healthy on digest
`ghcr.io/kohnnn/vnibb-api@sha256:b5b2ab435ff1c3bd290adadd4a67a4a6dcadb7ac8824521bca8bd694bb6c6af8`.
The fresh-cap image above is therefore not currently serving. Do not treat
the candidate manifest or previous smoke as proof of a live fresh-cap rollout;
verify the container pin, migration head and actual ingestion after deployment.

**Prediction storage policy hardening (source change, not deployment proof):**
The catalogue admission ceiling is now **4 GiB**, and the combined daily plus
intraday snapshot ceiling is **1 GiB**, measured with `pg_total_relation_size`
including indexes/TOAST plus conservative mutation reserves. Both fail closed;
an already allocated relation near its ceiling can stop writes even after deletes.
These are application admission guards, **not filesystem quotas**. Archives,
WAL, backups, unrelated data and direct-SQL bypasses remain outside them.

The stable `prediction_market_catalogue_retention` job now runs hourly at
**:40 UTC**, independently of provider ingestion, with the same maximum
**12 × 5,000 = 60,000 rows per sweep** and 30-minute timeout. Eligibility is
unchanged: real rows unrefreshed for seven days, excluding inactive-and-closed,
synthetic and archive-owned rows. Daily history remains 30 days and intraday
history seven days. Copied observations survive catalogue pruning. A final
bounded existence probe marks unfinished cleanup `partial`; failure/timeout
remain distinct. Inspect this job in `/api/v1/data/sync/status` and inventory
relation allocation and host free space before any operator-approved deletion.
Prediction-only dry run: `python -m vnibb.services.prediction_market_catalogue_retention --limit 5000`.
Ordinary deletion only makes PostgreSQL pages reusable; it does not guarantee
filesystem shrinkage. Do not raise guards, automatically archive terminal rows,
or run `VACUUM FULL` as a workaround. See [retention policy](data_retention_partitioning.md#prediction-market-storage-limits).


The 200 GB boot volume filled; PostgreSQL could not start and Redis AOF writes
failed with `ENOSPC`. Reclaiming unused build caches and an off-host-verified
backup duplicate restored API readiness. The intraday prediction snapshot table
was approximately 108 GB; ordinary row deletion does not immediately reclaim
that allocation from the filesystem. A separate repository's self-hosted
Actions runner also consumed several GB rebuilding images during recovery.

Intentional pauses, pending the operator-selected storage expansion:

- `vnibb-scheduler` is stopped; scheduled market updates are not running.
- Backup cron is preserved at `/root/vnibb-backup.cron.paused-disk-20260925`,
  outside `/etc/cron.d`. The guarded producer is installed at
  `/usr/local/sbin/vnibb-backup.sh`; it refused on real available disk before
  creating a set. Its previous version is retained at
  `/root/vnibb-backup.sh.pre-disk-preflight-20260926`.
- `actions.runner.Kitkitkittt-vietcap_datalake.cloud-01-vietcap-datalake.service`
  is stopped and disabled; do not re-enable on the production disk without a
  build-space budget. Its in-flight BuildKit container was paused, not deleted.

The paired `20260924T175056Z` set is retained on the workstation at
`../backups/20260924T175056Z`; both payload byte counts and SHA-256 values match
the transferred manifest. Its on-host duplicate was removed with approval.
The isolated restore completed on 2026-09-26 with exit 0: 39 public PostgreSQL
tables, 1,753 stocks, 1,748,069 price rows; MongoDB restored 7,983,753 documents
with zero failures into 16 populated collections. Local verification through
restore assertions took 2,860.5 seconds; both recovery containers were removed.
See `BACKUP_RESTORE_DRILL.md` for artifact hashes and image versions. The
PostgreSQL TOC's 87 TABLE DATA entries are not the public-table count.

OCI instance-principal authentication succeeds but listing boot-volume
attachments returns `NotAuthorizedOrNotFound`. Expand the boot volume for
`instance-20260312-1441` in `ap-singapore-1` using an authorized OCI identity,
then rescan and grow the guest partition/filesystem and verify `lsblk`/`df`.
Only after measured headroom covers a new paired backup plus its safety reserve
should backup cron and the reviewed scheduler release resume. Keep the API
serving during the pause; HTTP readiness alone does not prove jobs are running.

Validation on 2026-09-26: `env PYTHON=/tmp/vnibb-verify/bin/python pnpm run ci:gate`
passed all nine steps, including frontend lint/typecheck/build/tests and backend
Ruff/compile/tests (870 passed, one skipped). The two revised backup sizing
boundary tests passed separately. A real SQL-session retention smoke deleted
expired rows over two budget-bounded invocations and preserved both current
rows. Production backup preflight exited nonzero before dumping: required
17,984,371,922 bytes versus 11,728,355,328 available. The installed producer's
SHA-256 matches the repository source. These checks do not mean the backend
retention release is deployed or storage has been expanded.

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
