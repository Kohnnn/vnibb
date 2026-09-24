# Root cause: `vnibb-scheduler` restart loop (wayfinder ticket #15)

- **Date:** 2026-09-22 (UTC)
- **Host:** OCI node `root@100.107.9.31` (Tailscale), compose project `vnibb`
- **Revision in production:** `b71f2d2b326e3fad58eb350e898dd099b97d4943`
- **Verdict:** **Root cause proven.** Not a crash, not a watchdog, not an external kill,
  not a Python exit path. The container is **OOM-killed by the kernel against its own
  2 GiB cgroup limit** while the `prediction_market_intraday_snapshot` job materialises
  all 13.2 M rows of `prediction_markets` into RAM.
- **No fix proposed here** — that is ticket #16.

---

## 1. Headline finding

`vnibb-scheduler` runs `prediction_market_intraday_snapshot` on a `*/15` cron. That job
executes an **unbounded `SELECT` of the entire `prediction_markets` table** and
materialises it into a Python list of SQLAlchemy ORM objects. The table holds
**13,267,787 rows / 9,352 MB**, of which **13,246,669 are `active = true`** — i.e. the
query returns essentially the whole table, and the `WHERE active` predicate filters out
almost nothing.

Measured live on the container (1 Hz cgroup sampling — §6):

```
13:00:01 cur=250MB   anon=182MB   peak=251MB     <- :00 cron fires, job starts
13:00:03 cur=400MB   anon=332MB   peak=400MB
13:00:05 cur=582MB   anon=513MB   peak=582MB
13:00:07 cur=760MB   anon=692MB   peak=761MB
13:00:09 cur=943MB   anon=874MB   peak=943MB
13:00:11 cur=1113MB  anon=1043MB  peak=1113MB
13:00:13 cur=1282MB  anon=1211MB  peak=1287MB
13:00:15 cur=1342MB  anon=1271MB  peak=1342MB
13:00:17 cur=1411MB  anon=1341MB  peak=1411MB
13:00:19 cur=1567MB  anon=1492MB  peak=1567MB
13:00:21 cur=1663MB  anon=1588MB  peak=1664MB
13:00:23 cur=1851MB  anon=1774MB  peak=1851MB
13:00:25 cur=1947MB  anon=1869MB  peak=1947MB
13:00:27 cur=1594MB  anon=1517MB  peak=1958MB   <- query returned
13:00:29 cur=1593MB  anon=1515MB  peak=1958MB
…     (flat ~1564MB for the rest of the hour)
```

**+1.79 GB of anonymous heap in 26 seconds, peaking at 1958 MB against a 2048 MB limit
(95.6 % of the ceiling), and the memory is never returned to the OS.** The cgroup sits
at ~76 % full for the rest of the cycle, so the next invocation that lands on top of a
still-resident working set is what crosses the line.

---

## 2. Two measurement artefacts that hid the cause

Both are why the ticket's "OOM is ruled out" premise was wrong. Neither is a Docker bug —
both are the *same* root error: reading a per-restart-scoped counter as if it were
lifetime data.

### 2.1 `memory.peak` / `memory.events` reset on every restart

`docker inspect` reported `OOMKilled: false` and the cgroup read `oom 0 / oom_kill 0`,
`memory.peak 230 MB`. Those readings were taken **after a restart, in the quiet interval
before the job next ran**. Docker **recreates the cgroup on every container start**, so
`memory.peak` is a high-water mark *since the current start*, and `memory.events` is
zeroed with it. Sampled at the right moment the numbers are unambiguous:

```
13:15:44 (post-restart, job not yet run)   peak=218MB    cur=164MB
13:11:52 (mid-cycle, job already ran)      peak=1958MB   cur=1566MB
```

### 2.2 `.State.ExitCode == 0` is Docker reporting, not a clean exit

`.State.ExitCode` and `.State.OOMKilled` **do not reflect kernel cgroup OOM kills.**
Verified directly at the 13:15:25 event:

```
$ docker inspect vnibb-scheduler --format "rc={{.RestartCount}} exit={{.State.ExitCode}} oomKilled={{.State.OOMKilled}}"
rc=35 exit=0 oomKilled=false
```

…while at that same instant:

```
$ docker events --since 6h --until 1s --filter event=oom --filter container=vnibb-scheduler
2026-09-22T13:15:25.  container oom  8236f180252c…

$ docker events --since 3h --until 1s --filter event=die --filter container=vnibb-scheduler
2026-09-22T13:15:25.454681108Z  container die  …  exitCode=137
```

Polling `.State` at 2 Hz across the event captures the mechanism in the act — the flag is
set, then cleared by the restart, leaving only `ExitCode 0`:

```
$ while :; do docker inspect vnibb-scheduler --format \
    '{{.State.StartedAt}}|{{.State.FinishedAt}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.RestartCount}}'
    sleep 0.5; done
13:13:02.772  2026-09-22T12:46:42Z|2026-09-22T12:46:42Z|0|false|34
13:15:23.766  2026-09-22T12:46:42Z|2026-09-22T12:46:42Z|0|true |34   <- OOMKilled flips true
13:15:25.722  2026-09-22T13:15:25Z|2026-09-22T13:15:23Z|0|false|35   <- restart clears it
```

`OOMKilled` is `true` only in the ~2 s window between the kill and the restart, and
`ExitCode` is `0` throughout. That is precisely why every inspection taken after a
restart — as the ticket's were — reports `ExitCode 0, OOMKilled false`.

and the kernel log for the same second:

```
Sep 22 13:15:24 instance-20260312-1441 kernel: Memory cgroup out of memory: Killed process 1044650 (python) total-vm:2971824kB, anon-rss:2090536kB, file-rss:63192kB, shmem-rss:0kB, UID:1000 pgtables:4640kB oom_score_adj:0
```

`exitCode=137` = 128 + SIGKILL(9). The kernel log is the authority; `.State` is not.

This also resolves the ticket's other two observations:

| Observation | Explanation |
|---|---|
| "exits cleanly with no SIGTERM handler fired" | Correct, and expected — the process is **SIGKILLed**. `SIGKILL` cannot be caught, so `loop.add_signal_handler(SIGINT/SIGTERM, stopped.set)` (`scheduler_worker.py:32-33`) never fires. |
| "its own `--check` healthcheck passes" | `--check` is a *separate* process (`scheduler_worker.py:39-44`) that only does `redis ping`. It says nothing about the long-lived process's heap. |
| "OOM is ruled out" | See §2.1 — the counters were read post-restart. |
| Host has 24.5 GB RAM, 16.9 GB available, zero swap | Irrelevant. The kill is **`CONSTRAINT_MEMCG`** — the cgroup limit, not host pressure. Zero swap only means nothing can absorb the spike. |

---

## 3. Decisive proof — kernel OOM kill

`journalctl -k` for the 12:45 event (the cgroup id resolves to `vnibb-scheduler`):

```
Sep 22 12:45:23 … kernel: python invoked oom-killer: gfp_mask=0xcc0(GFP_KERNEL), order=0, oom_score_adj=0
Sep 22 12:45:23 … kernel:  oom_kill_process+0x1cc/0x3f8
Sep 22 12:45:23 … kernel:  mem_cgroup_out_of_memory+0x100/0x148
Sep 22 12:45:23 … kernel:  try_charge_memcg+0x3e8/0x5c0
Sep 22 12:45:23 … kernel:  charge_memcg+0x50/0xa0
Sep 22 12:45:23 … kernel:  __mem_cgroup_charge+0x44/0x138
Sep 22 12:45:23 … kernel:  alloc_anon_folio+0x1c8/0x5c0
Sep 22 12:45:23 … kernel:  do_anonymous_page+0x104/0x5f0
Sep 22 12:45:23 … kernel:  handle_mm_fault+0xf8/0x278
Sep 22 12:45:23 … kernel: memory: usage 2097152kB, limit 2097152kB, failcnt 370
Sep 22 12:45:23 … kernel: swap: usage 0kB, limit 2097152kB, failcnt 0
Sep 22 12:45:23 … kernel: Memory cgroup stats for /system.slice/docker-8236f180252cceeea12bb1be9b55b2e918096eb1b04b9e400ffa4a9ec3f04949.scope:
Sep 22 12:45:23 … kernel: anon 2141011968
Sep 22 12:45:23 … kernel: file 0
Sep 22 12:45:23 … kernel: inactive_anon 2073026560
Sep 22 12:45:23 … kernel: oom-kill:constraint=CONSTRAINT_MEMCG,…,task=python,pid=1031028,uid=1000
Sep 22 12:45:23 … kernel: Memory cgroup out of memory: Killed process 1031028 (python) total-vm:2516720kB, anon-rss:2090700kB, file-rss:54964kB, shmem-rss:0kB, UID:1000 pgtables:4536kB oom_score_adj:0
```

Read this line by line:

- `docker-8236f180252c…scope` **is** `vnibb-scheduler` (`docker inspect vnibb-scheduler --format '{{.Id}}'`).
- `usage 2097152kB, limit 2097152kB` — pinned at exactly the `mem_limit: ${SCHEDULER_MEM_LIMIT:-2g}` from `docker-compose.oracle.yml:66`.
- `constraint=CONSTRAINT_MEMCG` — a **cgroup** kill, not host-wide.
- The `Call trace` terminates at `el0_da` → `do_page_fault` → `do_anonymous_page` →
  `alloc_anon_folio`: the kill happened **while Python was faulting in anonymous
  memory**, i.e. while building the large structure — not at exit.
- `file 0`, `inactive_anon 2073026560` — the pressure is pure anonymous heap.

### Kill tally over 48 h, by cgroup

```
    233  docker-f764c5ec2340…   (container no longer exists)
     34  docker-8236f180252c…   <- vnibb-scheduler
     34  docker-449e98a858b7…   (container no longer exists; 09-22 01:40 → 07:01)
      1  docker-9eafdf1ac293…   <- vnibb-api
```

`vnibb-scheduler` has been OOM-killed **34 times** between `07:15:21` and `12:46:42`, and
a 35th time at `13:15:24` during this investigation (`RestartCount` 34 → 35).

---

## 4. Cadence — deterministic, and why the kills are on a 15-minute grid

Restart timestamps (UTC) from the kernel OOM log, cross-checked against the container's
own startup banner:

```
07:15:21  07:16:34  07:30:23  07:31:36  07:45:23  07:46:36
08:15:21  08:16:34  08:30:23  08:31:35  08:45:23  08:46:35
09:15:24  09:16:38  09:30:22  09:31:35  09:45:23  09:46:35
10:15:24  10:16:44            10:45:22  10:46:33
11:15:23  11:16:36  11:30:24  11:31:47  11:45:23  11:46:38
12:15:22  12:16:35  12:30:23  12:31:35  12:45:23  12:46:42
13:15:24   (35th kill, observed live)
```

**Kills occur only at HH:15, HH:30 and HH:45 — never at HH:00.** The cadence is
deterministic, not random.

### 4.1 The job fires at `:00` too, and `:00` survives

`CronTrigger(minute="*/15")` fires at minute 0 as well. Verified live at 13:00:00:

```
2026-09-22T13:00:00.088052100Z {"level":"INFO","logger":"apscheduler.executors.default","message":"Running job \"Prediction Market Intraday Snapshot (15 min) (trigger: cron[minute='*/15'], next run at: 2026-09-22 13:15:00 UTC)\" …"}
```

The snapshot therefore runs **four times an hour**, but only the `:15`/`:30`/`:45`
instances are fatal — and the `:00` run *does* execute the full +1.79 GB spike
(measured above, peak 1958 MB) without being killed. So the trigger is not the job
alone; it is **the job plus the memory already resident when it starts**.

### 4.2 Per-boundary correlation over the whole 07:05 → 13:15 window

| Boundary | Ingest (`*/5`) | Intraday snapshot (`*/15`) | Death |
|---|---|---|---|
| :00 | RUN, completed | RUN (confirmed at 13:00) | **no** |
| :05, :10 | RUN, completed | — | no |
| :15 | RUN | RUN | **YES** |
| :20 | **SKIP** (Redis lock contended) | — | no |
| :25 | RUN, completed | — | no |
| :30 | RUN | RUN | **YES** |
| :35 | **SKIP** | — | no |
| :40 | RUN, completed | — | no |
| :45 | RUN | RUN | **YES** |
| :50 | **SKIP** | — | no |
| :55 | RUN, completed | — | no |

Two facts fall out of this table:

1. The `Skipping prediction_market_ingest because another scheduler owns its lock`
   warnings appear **only at `:20`/`:35`/`:50`** — the *next* 5-minute tick after each
   kill, when the freshly restarted container finds the dead container's Redis lock still
   alive. They are a **consequence** of the restart (proof the container died mid-job),
   not a cause.
2. The `:15`/`:30`/`:45` instances start the snapshot while the process has already
   faulted in the working set left by the `:00`–`:10` ingest runs; the `:00` instance
   starts from the quiet end of the cycle. With a 2048 MB ceiling and a 1958 MB spike,
   that few-hundred-MB difference decides the outcome. This is a **margin** effect: the
   container is living at 95.6 % of its limit, so scheduling coincidence determines which
   runs die. It is consistent with the two alternating uptime values
   (`[591, 72, 829, 73, 827, 73, 1725, 73, …]` s) — the job's variable duration shifts the
   kill by a few seconds relative to the cron boundary.

### 4.3 The startup one-shot produces a characteristic *second* kill ~70 s later

Most fatal boundaries in §4 show a **pair** of kills ~70 s apart (12:30:23 + 12:31:35,
12:15:22 + 12:16:35, 11:45:23 + 11:46:38, 07:15:21 + 07:16:34, …). The second is the
restarted container's own **startup one-shot** re-running the same unbounded query and
dying again.

`_maybe_populate_prediction_markets_on_startup()` (`core/scheduler.py:646-688`) schedules
`populate_prediction_markets_now` 15 s after every start:

```python
    scheduler.add_job(
        _populate_now,
        trigger="date",
        run_date=datetime.utcnow() + timedelta(seconds=15),
        id="populate_prediction_markets_on_startup",
        name="One-shot populate prediction markets",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    logger.info("Scheduled: populate_prediction_markets_on_startup in 15s")
```

and `populate_prediction_markets_now` (`services/populate_prediction_markets.py:58-141`)
calls the same unbounded snapshot **twice**:

- step 6, `counts["nightly_snapshot"] = await snapshot_active_prediction_markets(session)` (line 111) — `prediction_market_snapshot_service.py:36` and `:109` use the *same* unbounded `select(PredictionMarket).where(PredictionMarket.active.is_(True))`
- step 8, `intraday = await snapshot_active_prediction_markets_intraday(session)` (line 134)

Correlation across every restart in the log window:

```
   startup  one-shot ran  next death
  07:15:26           YES   07:16:34
  07:30:27           YES   07:31:36
  07:45:27           YES   07:46:36
  08:15:25           YES   08:16:34
  08:30:27           YES   08:31:35
  …                  YES   …
  12:30:27           YES   12:31:35
```

The one-shot fires **32-37 s** after each restart and the second kill follows **~70 s**
after the first. **The pairing is not uniform, and that non-uniformity is itself the
strongest evidence of how marginal this is.** Observed directly during this
investigation:

- 13:15:24 — the `:15` boundary kill (35th, `RestartCount` 34 → 35).
- 13:15:25 — restart; one-shot scheduled for 13:15:40.
- 13:15:40 onward — the one-shot runs and **survives**: `memory.peak` for that instance
  reached only **1742 MB**, i.e. **306 MB below** the 2048 MB ceiling.

So the same one-shot that killed the container after every earlier restart this hour came
within ~15 % of doing so here and did not. Survival is decided by a few-hundred-MB margin
that varies run to run, not by a fixed condition — consistent with §4.2 and with the
alternating uptimes (`[591, 72, 829, 73, 827, 73, 1725, 73, …]` s). It also explains the
`Skipping populate_prediction_markets_on_startup because another scheduler owns its lock`
lines: when the one-shot is skipped, no second kill occurs.

---

## 5. The offending code

**Job registration** — `apps/api/vnibb/core/scheduler.py:500-512`:

```python
    scheduler.add_job(
        guarded_intraday_prediction_market_snapshot,
        trigger=CronTrigger(
            minute=f"*/{PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES}",   # = 15
            timezone="UTC",
        ),
        id="prediction_market_intraday_snapshot",
        name="Prediction Market Intraday Snapshot (15 min)",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,
    )
```

`core/scheduler.py:39` → `PREDICTION_MARKET_INTRADAY_CADENCE_MINUTES = 15`.

**The unbounded query** — `apps/api/vnibb/services/prediction_market_intraday_snapshot_service.py:101-143`:

```python
async def snapshot_active_prediction_markets_intraday(
    session: AsyncSession,
) -> IntradaySnapshotResult:
    """Snapshot every active market into a fresh intraday row. …"""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)

    result = await session.execute(
        select(PredictionMarket).where(PredictionMarket.active.is_(True))
    )
    markets = list(result.scalars().all())          # <-- 13,246,669 ORM objects in RAM

    rows: list[PredictionMarketIntradaySnapshot] = []
    for market in markets:
        yes_price = 0.0
        if isinstance(market.outcome_prices, list) and len(market.outcome_prices) > 0:
            first = market.outcome_prices[0]
            if isinstance(first, (int, float)):
                yes_price = float(first)
        rows.append(
            PredictionMarketIntradaySnapshot(
                market_id=market.id,
                source=market.source,
                source_id=market.source_id,
                category=market.category,
                question=market.question,
                url=market.url,
                yes_price=yes_price,
                volume=market.volume if isinstance(market.volume, (int, float)) else None,
                liquidity=market.liquidity if isinstance(market.liquidity, (int, float)) else None,
                captured_at=now,
                extra={
                    "raw_outcome_prices": market.outcome_prices,
                    "raw_outcomes": market.outcomes,
                },
            )
        )
```

**No `LIMIT`, no `.yield_per()`, no `stream()`.** All ~13.2 M fully-populated ORM
instances are held simultaneously, *and* a second full list of ~13.2 M snapshot objects
is built from them before anything is written.

**Data scale** (read-only queries against `vnibb-db`):

```
prediction_markets_total     | 13267787
prediction_markets_active    | 13246669
intraday_snapshots           | 8394847
prediction_markets                       | 9352 MB
prediction_market_intraday_snapshots     | 6390 MB
prediction_market_snapshots              | 1510 MB
```

Note the ingest job's own log line reports `polymarket=100 kalshi=2000` — ~2,100 markets
per 5-minute cycle — yet the table holds 13.2 M rows: the corpus is dominated by
accumulated rows that were never pruned, and every one of them is `active`.

**The job has never once succeeded.** Across the whole log buffer:

```
prediction_market_intraday_snapshot complete:   0 occurrences
prediction_market_intraday_snapshot failed:     6 occurrences
```

and the 6 failures are this same query cancelled by Postgres:

```
"prediction_market_intraday_snapshot failed after 26.1s: (sqlalchemy.dialects.postgresql.asyncpg.Error)
 <class 'asyncpg.exceptions.QueryCanceledError'>: canceling statement due to statement timeout
[SQL: SELECT prediction_markets.id, prediction_markets.source, prediction_markets.source_id,
      prediction_markets.question, prediction_markets.slug, prediction_markets.description,
      prediction_markets.category, prediction_markets.url, prediction_markets.end_date,
      prediction_markets.active, prediction_markets.closed, prediction_markets.volume,
      prediction_markets.liquidity, prediction_markets.outcomes, prediction_markets.outcome_prices,
      prediction_markets.extra, prediction_markets.created_at, prediction_markets.updated_at
 FROM prediction_markets …"
```

The 25 s timeout is `db_statement_timeout_ms: int = 25000` (`core/config.py:121`),
applied at `core/database.py:90` (`SET statement_timeout = 25000`). `_run_guarded_job`
catches and swallows it (`core/scheduler.py:157-165`), so the *cancelled* runs are
harmless — and the *runs that complete* are the ones that kill the container. The job's
own 5-minute budget (`PREDICTION_MARKET_INTRADAY_SNAPSHOT_TIMEOUT_SECONDS = 5 * 60`) is
not the binding constraint; the cgroup is.

---

## 6. Direct measurement of the spike

1 Hz sampling of the live cgroup (read-only), capturing one full cycle:

```bash
C=/sys/fs/cgroup/system.slice/docker-8236f180252cceeea12bb1be9b55b2e918096eb1b04b9e400ffa4a9ec3f04949.scope
while :; do
  echo "$(date -u +%H:%M:%S) cur=$(( $(cat $C/memory.current)/1048576 ))MB \
    anon=$(( $(awk '/^anon /{print $2}' $C/memory.stat)/1048576 ))MB \
    peak=$(( $(cat $C/memory.peak)/1048576 ))MB"
  sleep 1
done
```

```
12:59:59 cur=185MB  anon=119MB  peak=239MB
13:00:01 cur=250MB  anon=182MB  peak=251MB
13:00:03 cur=400MB  anon=332MB  peak=400MB
13:00:05 cur=582MB  anon=513MB  peak=582MB
13:00:07 cur=760MB  anon=692MB  peak=761MB
13:00:09 cur=943MB  anon=874MB  peak=943MB
13:00:11 cur=1113MB anon=1043MB peak=1113MB
13:00:13 cur=1282MB anon=1211MB peak=1287MB
13:00:15 cur=1342MB anon=1271MB peak=1342MB
13:00:17 cur=1411MB anon=1341MB peak=1411MB
13:00:19 cur=1567MB anon=1492MB peak=1567MB
13:00:21 cur=1663MB anon=1588MB peak=1664MB
13:00:23 cur=1851MB anon=1774MB peak=1851MB
13:00:25 cur=1947MB anon=1869MB peak=1947MB
13:00:27 cur=1594MB anon=1517MB peak=1958MB
13:00:29 cur=1593MB anon=1515MB peak=1958MB
…    (flat ~1564MB through 13:01:07)
```

This single trace settles the remaining questions:

1. **The job causes the spike** — 185 MB idle → 1958 MB in 26 s, starting at the exact
   cron boundary.
2. **The limit is the wall** — peak 1958 MB vs `memory.max` 2048 MB = 95.6 %. There is no
   headroom, which is why a few hundred MB of pre-existing load decides life or death.
3. **The memory is never released** — after the query returns the cgroup stays at
   ~1.56 GB. CPython does not return these large intermediate allocations to the OS, so
   the container is permanently ~76 % full.
4. **`:00` survives the identical spike**, confirming the differentiator is pre-existing
   occupancy plus concurrent jobs, not the spike in isolation.

---

## 7. Why `vnibb-api` restarted once — the same defect, a different caller

`journalctl -k`:

```
Sep 22 11:40:31 … kernel: python invoked oom-killer: gfp_mask=0xcc0(GFP_KERNEL), order=0, oom_score_adj=0
Sep 22 11:40:31 … kernel: oom-kill:constraint=CONSTRAINT_MEMCG,…,
    oom_memcg=/system.slice/docker-9eafdf1ac29326aab840426b10c0db5b02dd59f812bac681502354586e755c6b.scope,task=python,pid=750180,uid=1000
Sep 22 11:40:31 … kernel: Memory cgroup out of memory: Killed process 750180 (python) total-vm:6802216kB, anon-rss:4166504kB, file-rss:53456kB, shmem-rss:0kB, UID:1000 pgtables:8940kB oom_score_adj:0
```

`docker-9eafdf1ac293…` **is** `vnibb-api`. `anon-rss 4166504kB` ≈ 4.0 GiB against
`API_MEM_LIMIT: 4g` (`docker-compose.oracle.yml:35`) — the api needs twice the
scheduler's footprint to die only because its limit is twice as large.

It reaches that via the **same unbounded pattern** in request handlers
(`select(PredictionMarket).where(PredictionMarket.active.is_(True))`, no limit):

- `apps/api/vnibb/api/v1/prediction_markets.py:547` — `.scalars().all()` over all active markets
- `apps/api/vnibb/api/v1/prediction_markets.py:642` — same, inside a `try/except (OperationalError, ProgrammingError)`
- `apps/api/vnibb/api/v1/prediction_markets.py:934` — same
- `apps/api/vnibb/services/prediction_market_estimator.py:170` — same

`:547` is the clearest statement of the defect — it reads the whole table and then
discards nearly all of it:

```python
    stmt = select(PredictionMarket).where(PredictionMarket.active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()      # 13.2 M ORM objects
    matching: list[PredictionMarket] = []
    for market in rows:
        haystack = f"{market.question} {market.description or ''} {market.slug or ''}".lower()
        if any(marker in haystack for marker in markers):
            matching.append(market)
    matching = matching[:limit]                          # ...only to keep `limit` rows
```

The container's last log lines before the kill are ordinary traffic — `GET
/api/v1/screener/` at `11:40:06`, `GET /api/v1/equity/VNM/profile` at `11:40:15`, a Redis
cache write at `11:40:18` — then silence until the `11:40:34` restart banner. Its
`oom_kill 0 / peak=300MB` reading today is the same post-restart artefact as §2.1: the
current instance started at `11:40:32` and has not been hit since.

---

## 8. Candidates explicitly ruled out

| Candidate | Verdict | Evidence |
|---|---|---|
| Host memory exhaustion | **No** | Kill is `constraint=CONSTRAINT_MEMCG`, scoped to the container cgroup; host has 16.9 GB available. |
| Application bug causing a clean `return` | **No** | `scheduler_worker.py:28-36` blocks forever on `await stopped.wait()`; nothing else can return. No `sys.exit`/`os._exit`/`raise SystemExit` on the worker path, no `--once`, no idle-shutdown, no self-watchdog. |
| Uncaught `SystemExit` from a fire-and-forget task (would produce a *genuine* exit 0) | **No** | Real mechanism (CPython re-raises `SystemExit`/`KeyboardInterrupt` out of `Handle._run` → `asyncio.run`; the repo documents vnstock/vnai raising `SystemExit`). Ruled out here: it would leave **no** kernel OOM record, but 35 kernel OOM records exist for this cgroup, and zero `SystemExit`/`Traceback` lines appear in 31,066 log lines. |
| APScheduler `shutdown` triggered | **No** | Zero occurrences of `shutdown` in 31,066 log lines. |
| Unhandled exception / swallowed error | **No** | `_run_guarded_job` (`core/scheduler.py:157-165`) catches and logs; zero `Traceback`/`MemoryError` lines. The kernel kills before CPython can raise `MemoryError`. |
| External kill: `migrate` service | **No** | `migrate` (`docker-compose.oracle.yml:106-113`) is `restart: "no"`, `entrypoint: [alembic]`, and ran `11:36:48`–`11:38:41`, before the `11:40:31` api kill. Never touches the scheduler. |
| External kill: compose recreate / deploy | **No** | Kills land on a strict 15-minute cron grid, not on deploy boundaries. The container's `Created` timestamp is unchanged (5 h old) across 35 restarts — Docker restarts the **same** container. |
| External kill: Caddy / api `depends_on` chain | **No** | `depends_on` gates startup only; no dependency can stop a running sibling. |
| External kill: OCI unified-monitoring-agent / host watchdog | **No** | No watchdog, systemd timer or cron entry targets containers. The kernel attributes the kill to the scheduler's own cgroup with a page-fault trace, not to a signal from a supervisor. |
| Zero swap | Contributing, not causal | `swap: usage 0kB` means nothing absorbs the spike, so the cgroup limit is a hard wall. Removing the swap deficit alone would not help. |
| `restart: unless-stopped` | Not causal | It is the recovery mechanism, and the reason the loop shows up only as a climbing `RestartCount`. |
| Redis lock / `SCHEDULER_LOCK_MODE=required` | Not causal | `_run_guarded_job` returns early on `contended` (`core/scheduler.py:128-130`). The lock-skip warnings are a *consequence* of dying mid-job. |
| `DOCKER_LOG_MAX_SIZE=10m` log rotation | Not causal | `local` driver, 10 MB × 3 files; the buffer retained 31,066 lines back to 07:05, covering every restart. |

---

## 9. Reproduction commands (all read-only)

```bash
# Kernel OOM kills per container cgroup, over 48 h
journalctl -k --since "48 hours ago" --no-pager \
  | grep -oE "oom_memcg=/system.slice/docker-[a-f0-9]+\.scope" | sort | uniq -c | sort -rn

# Map a cgroup id to a container
docker inspect vnibb-scheduler --format '{{.Id}}'

# The die event carries the real status (137) — unlike .State.ExitCode
docker events --since 5h --until 0s --filter container=vnibb-scheduler \
  | grep -v exec_ | grep -oE "container (die|oom) [a-f0-9]{12}|exitCode=[0-9]+"

# Current cgroup high-water mark — resets on every restart
C=/sys/fs/cgroup/system.slice/docker-8236f180252cceeea12bb1be9b55b2e918096eb1b04b9e400ffa4a9ec3f04949.scope
cat $C/memory.peak $C/memory.max $C/memory.events

# Table scale
docker exec vnibb-db psql -U postgres -d vnibb -t -c \
  "SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class \
   WHERE relkind='r' AND relname LIKE 'prediction%'"

# No graceful shutdown has ever been logged
docker logs vnibb-scheduler 2>&1 | grep -ci "shutting down\|sigterm\|shutdown"
```

State at time of writing (2026-09-22 13:19 UTC):

```
vnibb-scheduler  rc=35  StartedAt=2026-09-22T13:15:25.491942376Z
                 peak=1742MB (job cycle complete)  memory.max=2048MB
                 memory.events: oom 0 oom_kill 0   <- reset at 13:15:25 by the restart
vnibb-api        rc=1   StartedAt=2026-09-22T11:40:32.375080927Z
                 peak=300MB   memory.max=4096MB
/proc/vmstat     oom_kill 6281
```

## 10. Summary

`vnibb-scheduler` is OOM-killed by the kernel against its own 2 GiB cgroup limit at
`:15`, `:30` and `:45` (35 kills so far), by the `prediction_market_intraday_snapshot`
job's unbounded `SELECT` of all 13,246,669 `active` rows in `prediction_markets`, which
allocates **+1.79 GB of anonymous heap in ~26 seconds and never releases it**. The `:00`
instance of the same job survives, because it starts from the quiet end of the cycle;
the `:15`/`:30`/`:45` instances start on top of a ~76 %-full cgroup. Each restart's own
startup one-shot (`populate_prediction_markets_on_startup`, which calls the same
unbounded snapshot **twice**) usually dies again ~70 s later, producing the
characteristic double kill — though it survived the 13:15 cycle with a 1742 MB peak,
306 MB under the ceiling, which is why the pairing is not uniform.

`vnibb-api`'s single restart is the identical defect reached through the unbounded
`select(PredictionMarket)` calls in its request handlers, against a 4 GiB limit.

The reason this went unnoticed is a measurement error, not a Docker bug:
`memory.peak`/`memory.events` are **per-cgroup and Docker recreates the cgroup on every
restart**, so they read `0` / `~230 MB` whenever sampled in the quiet interval between
kills; and `.State.ExitCode`/`.State.OOMKilled` do not reflect kernel cgroup OOM kills
(they read `0`/`false` at the very second the kernel log records the kill). The
authoritative signals are `journalctl -k`, `docker events` (`container oom`, then
`die exitCode=137`), and `memory.peak` sampled **after** the job has run.

**Fix is out of scope (ticket #16.)**
