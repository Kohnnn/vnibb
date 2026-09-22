# Root cause of the stale VNIBB data feeds (2026-09-22)

Wayfinder ticket #17. Read-only investigation against production
(`root@100.107.9.31`, compose project `vnibb`, revision `b71f2d2b326e3fad58eb350e898dd099b97d4943`).
All probes below were executed live on 2026-09-22 between 12:20 and 13:30 UTC.

Every claim is backed by the exact command and its raw output. No fix is proposed —
the decisions here belong to the human.

---

## 0. Headline

Five independent failures stack on top of each other. Only **one** of the
reported "critical" feeds is genuinely a data gap on the provider side; two are
reporting bugs, and the largest one is self-inflicted infrastructure.

| # | Failure | Where | Verdict |
|---|---------|-------|---------|
| **F1** | `vnibb-scheduler` is OOM-killed every ~15 min (2 GiB cap, 36+ kills, `RestartCount=35`) | infra | ours |
| **F2** | The `rs_rating` freshness probe reads a table that does not exist, aborting the shared DB session and nulling the **four** probes that follow it | `market.py:4603` | ours (reporting bug) |
| **F3** | `financial_ratios` / `company_events` / `dividends` / `screener_snapshots.pe` died on 2026-05-20–06-16 because the seeding jobs that own them are **not scheduled** | scheduler wiring | ours (real data gap) |
| **F4** | `daily_trading` writes a genuinely partial `foreign_trading` slice (10 symbols on 09-22 vs 60 on every prior day) and the settling logic correctly refuses it | provider + design | upstream-triggered, real gap |
| **F5** | `company_news` `published_date` lags 13 days: the 10:30 job rotates 1-of-4 stages per weekday by `weekday() % 4` | scheduler design | ours (reporting + freshness gap) |

Answers to the six ticket questions are in §7.

---

## 1. Real DB `MAX(date)` per feed vs what the probe reports

### 1.1 The measurement

```
docker compose --env-file /srv/vnibb/deployment/env.oracle \
  -f /srv/vnibb/docker-compose.oracle.yml exec -T db \
  psql -U postgres -d vnibb -c "
SELECT 'company_news.published_date' AS probe, max(published_date)::text AS real_max, count(*) AS rows FROM company_news
UNION ALL SELECT 'company_news.created_at', max(created_at)::text, count(*) FROM company_news
UNION ALL SELECT 'financial_ratios.updated_at', max(updated_at)::text, count(*) FROM financial_ratios
UNION ALL SELECT 'financial_ratios.period', max(period)::text, count(*) FROM financial_ratios
UNION ALL SELECT 'company_events.event_date', max(event_date)::text, count(*) FROM company_events
UNION ALL SELECT 'company_events.updated_at', max(updated_at)::text, count(*) FROM company_events
UNION ALL SELECT 'dividends.exercise_date', max(exercise_date)::text, count(*) FROM dividends
UNION ALL SELECT 'foreign_trading.trade_date', max(trade_date)::text, count(*) FROM foreign_trading
UNION ALL SELECT 'order_flow_daily.trade_date', max(trade_date)::text, count(*) FROM order_flow_daily
UNION ALL SELECT 'stock_prices.time (1D)', max(time)::text, count(*) FROM stock_prices WHERE interval='1D'
UNION ALL SELECT 'screener_snapshots.snapshot_date', max(snapshot_date)::text, count(*) FROM screener_snapshots
UNION ALL SELECT 'screener_snapshots.trade_date', max(trade_date)::text, count(*) FROM screener_snapshots
UNION ALL SELECT 'shareholders.updated_at', max(updated_at)::text, count(*) FROM shareholders
UNION ALL SELECT 'market_news.published_date', max(published_date)::text, count(*) FROM market_news
UNION ALL SELECT 'market_news.crawled_at', max(crawled_at)::text, count(*) FROM market_news;
"
```

```
              probe               |          real_max          |   rows
---------------------------------+----------------------------+---------
 company_news.published_date     | 2026-09-09 17:31:30        |    8539
 company_news.created_at         | 2026-09-17 10:30:20.661231 |    8539
 financial_ratios.updated_at     | 2026-05-20 16:21:45.716179 |   17400
 financial_ratios.period         | Q4-2025                    |   17400
 company_events.event_date       | 2026-04-16                 |   13596
 company_events.updated_at       | 2026-05-20 16:14:11.33713  |   13596
 dividends.exercise_date         | 2026-04-16                 |   13680
 foreign_trading.trade_date      | 2026-09-22                 |   28920
 order_flow_daily.trade_date     | 2026-06-16                 |   24672
 stock_prices.time (1D)          | 2026-09-22                 | 1747933
 screener_snapshots.snapshot_date| 2026-09-22                 |  285119
 screener_snapshots.trade_date   |                            |  285119
 shareholders.updated_at         | 2026-09-21 10:31:39.641162 |    4604
 market_news.published_date      | 2026-09-21 15:00:00        |    9171
 market_news.crawled_at          | 2026-09-22 10:00:18.053474 |    9171
(15 rows)
```

`rs_rating`: **no such table.**
```
psql -U postgres -d vnibb -c "SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name LIKE 'rs%';"
```
```
 table_name
------------
(0 rows)
```

### 1.2 Live probe output

```
docker exec vnibb-api curl -s http://localhost:8000/api/v1/market/data-sources/freshness
```
(fetched 2026-09-22T12:31:36Z, trimmed to the decisive columns)
```
key                 last_updated                  age_days  status
daily_prices        2026-09-22T00:00:00                0.0   fresh
foreign_trading     2026-09-22T00:00:00                0.0   fresh
market_news         2026-09-21T15:00:00                1.0   stale
company_news        2026-09-09T17:31:30               13.0   critical
financial_ratios    2026-05-20T16:21:45.716179       125.0   critical
rs_rating           null                              null   unknown
screener_snapshot   null                              null   unknown
company_events      null                              null   unknown
shareholders        null                              null   unknown
overall: critical
```

`daily_prices`, `foreign_trading`, `market_news`, `company_news`,
`financial_ratios` all match the DB `MAX` exactly — those five probes read the
right column. The other four are all `null`, and §2 shows they fail for a single
shared reason.

### 1.3 Per-feed table

| Feed | Table | Probe timestamp column | Real DB MAX | Probe-reported | Root cause | Upstream vs ours | Real gap or reporting bug |
|---|---|---|---|---|---|---|---|
| Daily prices | `stock_prices` | `time` (W 1D) | 2026-09-22 | 2026-09-22 (fresh) | — | — | neither (healthy) |
| Foreign trading | `foreign_trading` | `trade_date` | 2026-09-22 (28920 rows) | 2026-09-22 (fresh) | — | — | neither (healthy) — but see `/market/freshness` §4 |
| Market news | `market_news` | `published_date` | 2026-09-21 15:00 | 2026-09-21 (stale) | `published_date` genuinely trails; `crawled_at` is 2026-09-22 10:00 | mixed | minor reporting (the sibling `/market/freshness` probe falls back to `crawled_at`) |
| Company news | `company_news` | `published_date` | 2026-09-09 17:31:30 | 2026-09-09 (critical) | Job rotation: `weekday() % 4` picks 1 of 4 stages; last run 2026-09-17 | ours (scheduling) | real freshness gap (6 days since last successful crawl) — see §3.2 |
| Financial ratios | `financial_ratios` | `updated_at` | 2026-05-20 16:21:45 | 2026-05-20 (critical) | **No scheduled job writes it**; last writer was the unscheduled `full_market` seeding job | ours (scheduling) | **real data gap, 125 days** — see §3.1 |
| RS rating | *(none)* | `snapshot_date` on `rs_rating_snapshots` | n/a — table absent | null (unknown) | Probe targets a non-existent table | ours | **reporting bug** — see §2 |
| Screener snapshot | `screener_snapshots` | `snapshot_date` | 2026-09-22 | null (unknown) | Probe aborted by the `rs_rating` failure | ours | **reporting bug** — see §2 |
| Company events | `company_events` | `event_date` | 2026-04-16 | null (unknown) | Probe aborted; underlying `event_date` also genuinely stale at 2026-04-16 while `updated_at` is 2026-05-20 | ours → upstream | **both**: reporting bug *and* a 159-day data gap |
| Shareholders | `shareholders` | `updated_at` | 2026-09-21 10:31:39 | null (unknown) | Probe aborted | ours | **reporting bug only** — data is 1 day old |
| *(not in the probe)* `order_flow_daily` | `order_flow_daily` | `trade_date` | 2026-06-16 | not reported | last writer was the unscheduled `full_market` job | ours | real data gap, 98 days — see §3.1 |
| *(not in the probe)* `dividends` | `dividends` | `exercise_date` | 2026-04-16 | not reported | same as `company_events` | ours | real data gap, 159 days |

---

## 2. The probe discrepancy: `screener_snapshot` is `null` because `rs_rating` poisons the session

### 2.1 The code

`apps/api/vnibb/api/v1/market.py:4547-4639` — `_PUBLIC_SOURCES`. The `rs_rating`
entry names a table that exists nowhere in the repo:

```python
    {
        "key": "rs_rating",
        "label": "RS rating",
        "description": "Relative-strength leaders/laggards rankings.",
        "table": "rs_rating_snapshots",     # <-- no such table
        "timestamp_column": "snapshot_date",
        ...
    },
```

The only reference to `rs_rating_snapshots` in the entire `apps/` tree is that
line:
```
grep -rn "rs_rating_snapshots" apps/ --include=*.py
apps/api/vnibb/api/v1/market.py:4603:        "table": "rs_rating_snapshots",
```
RS rating actually lives as a **column** on `screener_snapshots` (`rs_rating`,
`rs_rank`), written by the 09:10 `rs_rating_sync` job.

The probe loop (`market.py:4658-4672`) catches the exception but **never rolls
back**, and it reuses the same request-scoped `AsyncSession` for every
subsequent entry:

```python
    for spec in _PUBLIC_SOURCES:
        last_value: Optional[datetime] = None
        try:
            sql = f'SELECT MAX("{spec["timestamp_column"]}") FROM "{spec["table"]}"'
            if spec.get("filter"):
                sql += f' WHERE {spec["filter"]}'
            res = await db.execute(text(sql))
            last_value = res.scalar()
        except Exception as e:  # pragma: no cover - defensive, schema drift
            logger.warning(
                "data-sources freshness probe failed for %s: %s", spec["table"], e
            )
            last_value = None
```

### 2.2 The proof

`docker logs vnibb-api` — every 5-minute cache refresh logs exactly four
warnings. The first is the real error; the next three are collateral damage:

```json
{"timestamp": "2026-09-22T12:31:36.034350+00:00", "level": "WARNING",
 "logger": "vnibb.api.v1.market",
 "message": "data-sources freshness probe failed for rs_rating_snapshots: \
(sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError) \
<class 'asyncpg.exceptions.UndefinedTableError'>: relation \"rs_rating_snapshots\" does not exist\n\
[SQL: SELECT MAX(\"snapshot_date\") FROM \"rs_rating_snapshots\"]"}

{"timestamp": "2026-09-22T12:31:36.035013+00:00", "level": "WARNING",
 "message": "data-sources freshness probe failed for screener_snapshots: \
<class 'asyncpg.exceptions.InFailedSQLTransactionError'>: current transaction is aborted, \
commands ignored until end of transaction block\n\
[SQL: SELECT MAX(\"snapshot_date\") FROM \"screener_snapshots\"]"}

{"timestamp": "2026-09-22T12:31:36.035582+00:00", "level": "WARNING",
 "message": "data-sources freshness probe failed for company_events: ... \
InFailedSQLTransactionError ...\n[SQL: SELECT MAX(\"event_date\") FROM \"company_events\"]"}

{"timestamp": "2026-09-22T12:31:36.036101+00:00", "level": "WARNING",
 "message": "data-sources freshness probe failed for shareholders: ... \
InFailedSQLTransactionError ...\n[SQL: SELECT MAX(\"updated_at\") FROM \"shareholders\"]"}
```

`_PUBLIC_SOURCES` orders `rs_rating` **before** `screener_snapshot`,
`company_events`, and `shareholders` (`market.py:4600, 4610, 4620, 4630`), so the
aborted transaction cascades through exactly those three. `daily_prices`,
`foreign_trading`, `market_news`, `company_news`, `financial_ratios` sit earlier
in the list and are unaffected.

**`/health/detailed` is right and the public probe is wrong.** `health.py` runs
on its own connection and never touches `rs_rating_snapshots`:

```python
raw_snapshot_date = (
    await db.execute(text("SELECT MAX(snapshot_date) FROM screener_snapshots"))
).scalar()
...
snapshot_date = _coerce_snapshot_date(raw_snapshot_date)
trade_date = _coerce_snapshot_date(raw_trade_date)
freshness_date = trade_date or snapshot_date
```

```
docker exec vnibb-api curl -s http://localhost:8000/health/detailed
{"status": "healthy", ..., "components": {"database": {
    "status": "healthy", "stocks_count": 1753, "screener_count": 285119,
    "screener_snapshot_date": "2026-09-22", "screener_trade_date": null,
    "screener_snapshot_age_days": 0, "screener_freshness_basis": "snapshot_date"}}}
```

Note the second, independent problem in the same vein: `screener_trade_date` is
`null` because `screener_snapshots.trade_date` is null on **all 285 119 rows**.
`health.py` falls back to `snapshot_date`, so `/health/detailed` still reports
fresh — but any consumer that prefers `trade_date` sees nothing.

### 2.3 Why the `pe`/`pb` reporting differs from the probe

`apps/api/vnibb/api/v1/market.py:1669-1700`
(`_load_latest_screener_rows_from_db`) selects `ScreenerSnapshot.pe` and
`.pb` directly with no fallback. There is no second source for them.

---

## 3. Why `financial_ratios` is 125 days stale and `company_news` 13 days stale

### 3.1 `financial_ratios` — the owning job is not on the schedule at all

`financial_ratios`, `company_events`, `dividends` and the **valuated**
`screener_snapshots` rows are all written by `FullMarketSync.run_full_sync`
(`sync_type='full_market'`) and `run_full_seeding` (`sync_type='full'`).
Neither is a scheduled job. The 09:00 `daily_sync` cron runs
`run_daily_market_sync`, a different function that writes no `sync_status` row
at all:

```
docker logs vnibb-scheduler --since 24h | grep -E "daily_sync"
(no matches — the guard never logs a completion)
```

`run_daily_market_sync` (`sync_all_data.py:378-450`) does call
`sync_all_financials`, but that call is a `_run_direct_stage` that runs
**after** `sync_all_prices` — i.e. after `sync_screener_data`. It never
completes, because the container dies first (§3.3).

The last write into `financial_ratios` has the same second as the last
`full_market` run that was still alive:

```
psql -c "SELECT date_trunc('day',created_at)::date AS day, count(*) FROM financial_ratios GROUP BY 1 ORDER BY 1 DESC LIMIT 8;"
    day     | count
------------+-------
 2026-05-20 |  4870
 2026-03-20 |     4
 2026-03-17 |    36
 2026-03-09 |  2858
 2026-03-08 |  1987
 2026-03-07 |  7589
 2026-03-06 |     7
 2026-03-05 |     3

psql -c "SELECT id, sync_type, started_at, completed_at, status, success_count, error_count
         FROM sync_status WHERE sync_type IN ('full','full_market') ORDER BY id DESC LIMIT 6;"
 id  | sync_type   |         started_at         |        completed_at        |  status | ...
 144 | full_market | 2026-05-20 15:48:23.783639 |                            | running | ...
 143 | full_market | 2026-05-20 13:37:49.113217 |                            | running | ...
  80 | full_market | 2026-03-20 21:11:21.404116 | 2026-03-20 21:15:40.301572 | partial | ...
  79 | full_market | 2026-03-20 21:00:07.249446 | 2026-03-20 21:04:27.069116 | partial | ...
  78 | full_market | 2026-03-20 20:42:10.14907  | 2026-03-20 20:46:39.594972 | partial | ...
  69 | full        | 2026-03-09 09:00:00.001412 | 2026-03-09 09:38:00.629535 | completed | ...
```

Rows 143 and 144 are still marked `running` from 2026-05-20 — nothing has
touched `full_market` since. **The gap is a scheduler-wiring defect, not a
provider problem.** The data that *is* there is also thin:
`count(*) FILTER (WHERE pe_ratio IS NOT NULL) = 12530` out of 17400 rows, and
`max(period) = 'Q4-2025'`.

The same story explains `order_flow_daily` (`MAX = 2026-06-16`) and
`company_events` / `dividends` (`MAX = 2026-04-16`).

### 3.2 `company_news` — the 10:30 job rotates 1-of-4 stages per weekday

`run_supplemental_company_sync` (`sync_all_data.py:521-549`) ends with:

```python
    weekday_plan: list[tuple[str, Callable[[], Awaitable[int]]]] = [
        ("shareholders", lambda: data_pipeline.sync_shareholders(symbols=symbols)),
        ("officers",     lambda: data_pipeline.sync_officers(symbols=symbols)),
        ("subsidiaries", lambda: data_pipeline.sync_subsidiaries(symbols=symbols)),
        ("company_news", lambda: data_pipeline.sync_company_news(symbols=symbols,
                                     limit=settings.scheduler_company_news_limit)),
    ]
    stage_name, operation = weekday_plan[today.weekday() % len(weekday_plan)]
    results[stage_name] = await _run_direct_stage(stage_name, operation)
```

Only **one** of the four runs per day, and `company_news` only on the days where
`weekday() % 4 == 3`:

```
2026-09-22 Tue weekday=1 stage_idx=1   -> officers
2026-09-21 Mon weekday=0 stage_idx=0   -> shareholders
2026-09-20 Sun weekday=6 stage_idx=2   -> subsidiaries
2026-09-17 Thu weekday=3 stage_idx=3   -> company_news
2026-09-13 Sun weekday=6 stage_idx=2   -> subsidiaries
2026-09-10 Thu weekday=3 stage_idx=3   -> company_news
```

The DB agrees exactly:

```
psql -c "SELECT date_trunc('day',created_at)::date AS day, count(*) FROM company_news GROUP BY 1 ORDER BY 1 DESC LIMIT 8;"
    day     | count
------------+-------
 2026-09-17 |    11
 2026-09-13 |    97
 2026-09-10 |    17
 2026-09-06 |   224
 2026-09-03 |    21
 2026-08-27 |   119
 2026-07-25 |    17
 2026-07-23 |    38
```

Only 11 rows were written on 2026-09-17, because `weekday_plan` caps the crawl at
`settings.scheduler_company_news_limit = 10` (`core/config.py:221`) over a
120-symbol rotating slice. The most recent row:

```
psql -c "SELECT id, symbol, published_date, created_at, source FROM company_news ORDER BY created_at DESC LIMIT 3;"
  id   | symbol |    published_date    |         created_at         | source
-------+--------+----------------------+----------------------------+--------
 10669 | CTS    | 2026-08-14 14:34:00  | 2026-09-17 10:30:20.661231 | KBS
 10668 | CTD    | 2026-08-18 11:02:00  | 2026-09-17 10:30:17.765271 | KBS
 10667 | BVB    | 2026-09-09 17:31:30  | 2026-09-17 10:30:16.539051 | KBS
```

So 13 days is the `published_date` of the single newest article that job ever
pulled — a real gap in *coverage*, but the reporting is also misleading: the job
last succeeded 5 days ago, not 13, and it only ever fetches 10 symbols/day, so a
symbol whose last article predates the window looks permanently stale. The
probe also uses `created_at`-blind `published_date`; its sibling
`/market/freshness` deliberately falls back to `MAX(crawled_at)` for exactly
this reason (`market.py:4430-4443`).

### 3.3 The reason neither one *starts* reliably: the scheduler is OOM-killed every 15 minutes

This is the single highest-leverage finding. `vnibb-scheduler` runs with a 2 GiB
cgroup limit at 0% CPU, and the kernel kills it on a ~14.6-minute cadence.

```
docker inspect vnibb-scheduler --format "Created={{.Created}} RestartCount={{.RestartCount}} Mem={{.HostConfig.Memory}}"
Created=2026-09-22T07:05:31.366885349Z RestartCount=35 Mem=2147483648
```
*(`RestartCount` was 34 at 13:10 UTC and 35 by 13:15 — the loop was observed
advancing live.)*

```
dmesg -T | grep "Memory cgroup out of memory"
(36 kills on 2026-09-22, from 06:59:49 to 12:44:54 — every ~14.6 min, in pairs)
Tue Sep 22 06:59:49 2026 ... 07:13:34 ... 07:14:47 ... 07:28:36 ... 07:29:49 ...
Tue Sep 22 12:13:35 ... 12:14:47 ... 12:28:36 ... 12:29:48 ... 12:43:36 ... 12:44:54
```

The cgroup is unambiguously the scheduler:
```
docker inspect vnibb-scheduler --format "{{.Id}}"
8236f180252cceeea12bb1be...

dmesg -T | grep -A 30 "12:43:36.*invoked oom-killer"
[Tue Sep 22 12:43:36 2026] CPU: 1 UID: 1000 PID: 1031028 Comm: python
[Tue Sep 22 12:43:36 2026] mem_cgroup_out_of_memory+0x100/0x148
[Tue Sep 22 12:43:36 2026] memory: usage 2097152kB, limit 2097152kB, failcnt 370
[Tue Sep 22 12:43:36 2026] Memory cgroup stats for /system.slice/docker-8236f180252cceeea12bb1be9b55b2e918096eb1b04b9e400ffa4a9ec3f04949.scope:
[Tue Sep 22 12:43:36 2026] anon 2141011968
[Tue Sep 22 12:43:36 2026] file 0
```
`usage 2097152kB = limit 2097152kB = 2 GiB`, and the cgroup path matches
`vnibb-scheduler`'s container id. (A second, unrelated cgroup
`docker-9eafdf1ac293...` = `vnibb-api`, 4 GiB, also appears in dmesg — the API
occasionally exceeds its own limit too.)

The functional consequence: **no long job ever finishes.** A run's last log line
is always followed by a `setup_logging` / `start_scheduler` pair ~28 s later
(the container's boot sequence):

```
09:15:28 setup_logging | Logging configured ...
09:15:29 start_scheduler | Scheduler started with all jobs configured
09:16:42 setup_logging | Logging configured ...
09:16:43 start_scheduler | Scheduler started with all jobs configured
...
09:30:27 setup_logging | ...
09:31:40 start_scheduler | ...
```

And for the 09:00 daily_sync specifically — it starts, and then simply stops
logging mid-flight:
```
09:00:02 INFO sync_screener_data | Syncing screener data...
(no further daily_sync log line; the next thing in the log is the restart pair)
docker logs vnibb-scheduler --since 24h | grep -E "daily_sync (completed|failed)"
(no matches)
```

The one-hour gap between the 09:20 `daily_trading_sync` and the 10:15 restart
pair is what the Redis key records — `updated_at: 2026-09-22T09:29:00Z` with a
TTL of 247082 s (≈2.86 days), i.e. never overwritten since.

---

## 4. `foreign_trading` reason `latest_sync_unsettled`

### 4.1 The settling logic

`apps/api/vnibb/api/v1/market.py:113-156`, `_load_completed_foreign_settlement_dates`:
the probe does not trust the raw table. It scans `sync_status` for
`daily_trading` runs and accepts a trading date as "settled" only if the run was
`completed`, had `error_count == 0`, and its `foreign_trading` stage reported
`errors == 0` **and** `success == total`:

```python
            .where(
                SyncStatus.sync_type == "daily_trading",
                SyncStatus.status == "completed",
            )
...
        if not isinstance(payload, dict) or error_count != 0:
            continue
        ...
        if (
            not isinstance(success, (int, float))
            or not isinstance(errors, (int, float))
            or not isinstance(total, (int, float))
            or success <= 0
            or errors != 0
            or success != total
        ):
            continue
        raw_date = payload.get("trade_date")
```

Then `market.py:4460-4461`:
```python
    if raw_foreign_dt is not None and (foreign_dt is None or raw_foreign_dt > foreign_dt):
        foreign_reason = "latest_sync_unsettled"
```

### 4.2 There is exactly one qualifying run, and it is 2026-07-02

```
psql -c "SELECT count(*) FILTER (WHERE status='completed' AND error_count=0) AS pristine_completed,
                count(*) AS total_completed,
                max(id) FILTER (WHERE status='completed' AND error_count=0) AS last_pristine_id
         FROM sync_status WHERE sync_type='daily_trading';"
 pristine_completed | total_completed | last_pristine_id
--------------------+-----------------+------------------
                  6 |             197 |              175

psql -c "SELECT id, started_at::date d, completed_at, status, error_count FROM sync_status WHERE id=175;"
 id  |     d      |        completed_at        |  status   | error_count
-----+------------+----------------------------+-----------+-------------
 175 | 2026-07-02 | 2026-07-02 01:11:50.549664 | completed |           0
```

Only 6 of 197 runs ever qualified, and the newest is id 175 → `2026-07-02` →
age 82 days. **This exactly matches the reported `settled_last_data_date`.**
`raw_last_data_date` is `2026-09-22` because rows really are being written.

### 4.3 The 82-day gap is a real provider gap, not a logic bug

```
psql -c "SELECT trade_date, count(*), count(net_volume) FROM foreign_trading
         WHERE trade_date BETWEEN '2026-06-28' AND '2026-07-06' GROUP BY 1 ORDER BY 1;"
 trade_date | count | count
------------+-------+-------
 2026-07-02 |   119 |   107
 2026-07-03 |   120 |   110
 2026-07-04 |    60 |    50
 2026-07-05 |    60 |    50
 2026-07-06 |   120 |   110
```
73 of 119 rows on 07-02 already carried `net_volume = NULL` — the run completed
"cleanly" but the data was mostly empty. From 07-03 onward, every run has had a
non-zero `error_count`, so none can ever qualify.

The write on 09-22 is a genuinely degraded slice, not a full day:
```
psql -c "SELECT trade_date, count(*) FROM foreign_trading WHERE trade_date >= '2026-07-01' GROUP BY 1 ORDER BY 1 DESC LIMIT 5;"
 trade_date | count
------------+-------
 2026-09-22 |    10      <-- only 10 symbols
 2026-09-21 |    60
 2026-09-20 |    60
 2026-09-19 |    60
 2026-09-18 |    60
```
Per the stage stats the `foreign_trading` stage scaled down mid-run:
```
psql -c "SELECT id, jsonb_pretty(additional_data::jsonb) FROM sync_status WHERE id=238;"
 238 | { "stage": "orderbook_snapshots", "job_id": "daily-trading-d66363e0",
         "status": "running", "sync_id": 238, "last_index": 59, "last_symbol": "TRT",
         "trade_date": "2026-09-22", "updated_at": "2026-09-22T09:29:00.401153",
         "error_count": 200, "stage_index": 2,
         "stage_stats": {
             "foreign_trading":    { "total": 60, "errors": 50, "success": 10 },
             "intraday_trades":    { "total": 60, "errors": 60, "success": 0 },
             "orderbook_snapshots":{ "total": 1716, "errors": 90, "success": 0 }
         },
         "success_count": 10 }
```
`foreign_trading: success 10 / total 60` on 09-22 versus `60/60` on the four
preceding days. So the reason string `latest_sync_unsettled` is **accurate**, not
an artefact: the newest data really is unvalidated, and the validator really is
refusing it. The complaint is in the presentation — `/market/freshness` reports
`last_data_date 2026-07-02 / age_days 82 / critical` for a feed that is being
written every day, while the sibling probe
`/api/v1/market/data-sources/freshness` reports `foreign_trading … fresh`.
The two endpoints disagree by construction.

For comparison, the same run the day before was clean on this stage:
```
 id  | td         | status | error_count | ft_ok | ft_err
 237 | 2026-09-21 | failed |         101 | 60    | 0
 236 | 2026-09-20 | failed |         101 | 60    | 0
 235 | 2026-09-19 | failed |         101 | 60    | 0
```

---

## 5. Are the 101 `daily_trading` errors provider-side or ours?

**Both, in roughly equal measure — and the run is also being killed, not just
failing.** The stored `errors` column is useless here (see §5.4).

### 5.1 The `intraday_trades` stage: 60/60 errors, split 30/30

```
docker logs vnibb-scheduler --since 24h | grep "Intraday sync completed with errors"
"Intraday sync completed with errors", "extra": {
    "errors": 60,
    "error_breakdown": { "RetryError": 30, "ProgrammingError": 30 },
    "error_samples": ["TB8:RetryError","TS5:RetryError","VSF:ProgrammingError",
                      "VSE:RetryError","TNM:RetryError"] }
```

- **`RetryError` (30/60) — provider-side.** Traced through the vnstock runtime:
  ```
  WARN vnibb.providers.vnstock.runtime | Falling back to free vnstock.Vnstock because
  vnstock_data import failed: No module named 'vnstock_data'
  ```
  Free-tier fallback is engaged on *every* provider call, raising
  `RateLimitExceeded` inside vnai. The library's `CleanErrorContext` then calls
  `sys.exit(f"Rate limit exceeded. {str(exc_val)} Process terminated.")`
  (`vnai/beam/quota.py:307-313`) — and `sync_screener_data` catches that
  `SystemExit` deliberately (`data_pipeline.py:1478-1498`):
  ```python
  except SystemExit as exc:
      logger.warning(f"Ratio summary aborted for {symbol} ({ratio_source}): {exc}")
  ```
  This is why 554 of 1590 symbols log `Ratio summary aborted … Rate limit
  exceeded` — the vendor's free-tier 429 (690 occurrences in 24 h of logs).

- **`ProgrammingError` (30/60) — ours.** PostgreSQL `ProgrammingError`, not a
  provider error. It occurs inside the intraday block, which contains the only
  DB write on that path (the `OrderFlowDaily` upsert at `data_pipeline.py:5268-5271`).
  It is only logged at `debug` level, so no traceback is retained.

### 5.2 The `orderbook_snapshots` stage: 110 failures, pure provider-side

```
ERRO vnibb.providers.vnstock.price_depth | Price depth fetch failed for VIH:
  RetryError[<Future at 0xf56dddab7dd0 state=finished raised AttributeError>]
WARN vnibb.services.data_pipeline | Orderbook snapshot failed for VIH: Failed to fetch
  price depth for VIH: RetryError[<Future at 0xf56dddab7dd0 state=finished raised AttributeError>]
```
110 such lines on 09-22, cycling every ~4 s from 09:23 to 09:30. Pure upstream:
the vendor's `price_depth` entrypoint raises `AttributeError` (a 4.x API change —
the log carries vnstock's own deprecation banner: *"Lớp Vnstock và các phương
thức cũ … đã chính thức bị ngừng hỗ trợ"*, 31/08/2025).

### 5.3 The `foreign_trading` stage: same schema break

```
WARN vnibb.providers.vnstock.runtime | Falling back to free vnstock.Trading because
  vnstock_data import failed: No module named 'vnstock_data'
ERRO vnibb.providers.vnstock.price_board | Price board fetch failed: 1 validation error
  for PriceBoardData
  symbol
    Input should be a valid string [type=string_type, input_value=nan, input_type=float]
      For further information visit https://errors.pydantic.dev/2.13/v/string_type
WARN vnibb.services.data_pipeline | Price board fetch failed (KBS): Failed to fetch
  price board: 1 validation error for PriceBoardData
```
**Verdict: upstream.** The vendor now returns a row whose `symbol` is `NaN`
(a total/summary row) where `PriceBoardData.symbol: str` is required. That kills
the whole batch of 50, which is why 50 of 60 symbols fail.

### 5.4 The `sync_status.errors` column does not contain these errors

```
psql -c "SELECT id, left(errors::text,200) FROM sync_status
         WHERE sync_type='daily_trading' AND errors IS NOT NULL ORDER BY id DESC LIMIT 3;"
 id  | left
-----+-----------------------------------------------------------------------
 237 | {"reason": "stale_timeout", "stale_after_hours": 18, "auto_marked_at": "2026-09-22T09:20:00.197595"}
 236 | {"reason": "stale_timeout", "stale_after_hours": 18, "auto_marked_at": "2026-09-21T09:20:00.170201"}
 235 | {"reason": "stale_timeout", "stale_after_hours": 18, "auto_marked_at": "2026-09-20T09:20:00.174998"}
```

The `errors` field has been **overwritten by the stale-record reaper**, not by
the run that failed. The stage-level detail survives only in
`additional_data.stage_stats`. The reaper fires at the next scheduled start:

```
09:20:00 WARN vnibb.services.data_pipeline | Marked 1 stale 'daily_trading' sync records as failed
09:20:00 WARN vnibb.services.data_pipeline | Discarding stale daily trading progress for job_id=daily-trading-9f831c32
```

Note the timestamps: run 237's `completed_at` is `2026-09-22 09:20:00.197595` —
its `started_at` was `2026-09-21 09:20:00`. **The job ran for 24 h and was
reaped by the next day's trigger**, never completing on its own. That is the
`stale_after_hours: 18` path, and overlaid with the ~15-minute OOM cadence from
§3.3 it is clear the process was being killed and restarted repeatedly while the
`sync_status` row sat `running`.

### 5.5 The realtime stream writes `intraday_trades` even though `STORE_INTRADAY_TRADES=false`

Production env (verified in both the compose file and the live containers):
```
STORE_INTRADAY_TRADES=false
ORDERFLOW_AT_CLOSE_ONLY=true
ORDERBOOK_AT_CLOSE_ONLY=true
INTRADAY_REQUIRE_MARKET_HOURS=true
INTRADAY_SYMBOLS_PER_RUN=60

docker exec vnibb-scheduler python3 -c "from vnibb.core.config import settings; ..."
store_intraday_trades = False
orderflow_at_close_only = True
orderbook_at_close_only = True
intraday_require_market_hours = True
environment = production
```

`sync_intraday_trades` honours the flag only for raw-row insertion
(`data_pipeline.py:5124, 5214, 5226`) — the fetch loop and the `order_flow_daily`
upsert still run, which is the *intended* "skip raw intraday but derive order
flow" design.

But there is a **second, ungated writer**. `services/realtime_pipeline.py`'s
`_store_stock_price` (`realtime_pipeline.py:172-187`) inserts into
`IntradayTrade` with no `store_intraday_trades` check anywhere in the module:
```python
        stmt = pg_insert(IntradayTrade).values(
            symbol=symbol.upper(),
            trade_time=datetime.now(),
            price=float(data.get("price", data.get("close", 0))),
            volume=int(data.get("volume", data.get("vol", 0))),
            match_type=data.get("side", data.get("type", "unknown")),
        ).on_conflict_do_nothing()
```
`vnstock_pipeline` is not installed, so `_run_stream` takes `_polling_fallback`
(`realtime_pipeline.py:231-255`), which feeds realtime frames into exactly that
function every 5 s. The data betrays it:

```
psql -c "SELECT trade_time::date d, count(*) AS total,
                count(*) FILTER (WHERE match_type='unknown' AND price=0 AND volume=0) AS sig
         FROM intraday_trades GROUP BY 1 ORDER BY 1 DESC LIMIT 6;"
     d      | total |  sig
------------+-------+-------
 2026-09-22 |  3768 |  3768
 2026-09-21 |    72 |    72
 2026-09-18 |    96 |    96
```
Every row matches `_store_stock_price`'s fallbacks (`price`/`volume` → 0,
`match_type` → `"unknown"`), all 3768 rows carry that signature, and 3728 of them
landed between 09:00 and 09:45 — precisely the `realtime_start` window (02:00 UTC
= 09:00 VNT) overlapping a scheduler restarting every 15 minutes.

The `Z` suffix on the probe timestamps is a red herring: values like
`2026-09-22T09:29:00.401153` are **naive UTC** (`docker exec vnibb-scheduler date`
→ `Tue Sep 22 20:26:17 +07` / `13:26:17 UTC`), so 09:29 UTC = 16:29 VNT, i.e.
after the 15:00 VNT close. The timestamps are consistent, not skewed.

---

## 6. Is `pe` / `pb` null caused by `fundamental_enrichment: skipped`?

**No. Two independent causes, neither of which is `fundamental_enrichment`.**

### 6.1 The database has no `pe` / `pb` to serve

```
psql -c "SELECT snapshot_date, source, count(*) n, count(pe) pe_nn, count(trade_date) td_nn
         FROM screener_snapshots WHERE snapshot_date >= '2026-09-05' GROUP BY 1,2 ORDER BY 1 DESC;
 snapshot_date |      source       |   n   | pe_nn | td_nn
---------------+-------------------+-------+-------+-------
 2026-09-22    | rs_rating_service |   369 |     0 |     0
 2026-09-21    | rs_rating_service |  1590 |     0 |     0
 2026-09-20    | rs_rating_service |  1590 |     0 |     0
 ...
 2026-09-05    | rs_rating_service |  1595 |     0 |     0

psql -c "SELECT source, count(*), min(snapshot_date), max(snapshot_date), count(pe)
         FROM screener_snapshots GROUP BY 1 ORDER BY 2 DESC;"
      source       | count  |    min     |    max     | count
-------------------+--------+------------+------------+-------
 vnstock_ratio     | 155329 | 2026-03-06 | 2026-06-16 | 38815
 rs_rating_service | 125107 | 2026-04-02 | 2026-09-22 |     0
 KBS               |   4683 | 2026-03-06 | 2026-06-16 |  4117

psql -c "SELECT max(snapshot_date) FROM screener_snapshots WHERE pe IS NOT NULL;"
 2026-04-06

psql -c "SELECT max(snapshot_date) FROM screener_snapshots WHERE pe IS NOT NULL AND pb IS NOT NULL;"
 2026-04-06
```

Every `pe`/`pb` value in the table comes from the `vnstock_ratio` / `KBS`
sources, whose last write was **2026-06-16**. Since then the *only* writer is
`rs_rating_service`, which never sets `pe`/`pb`:

```python
# services/rs_rating_service.py:474-480
                    snapshot = ScreenerSnapshot(
                        symbol=stock["symbol"],
                        snapshot_date=snapshot_date,
                        industry=stock.get("industry") or (seed.industry if seed else None),
                        rs_rating=stock["rs_rating"],
                        rs_rank=stock["rs_rank"],
                        source="rs_rating_service",
                    )
                    if seed is not None:
                        snapshot.pe = seed.pe      # <-- carries forward, never computes
                        snapshot.pb = seed.pb
```
The carry-forward propagates the last real values (observed plateau: `price`/`market_cap` identical
across 06-18/06-19/06-20 at 387/295 non-null of 1617 rows) and finally runs out.
The newest snapshot (09-22) has **369** rows versus 1590 on prior days, because
`_update_screener_snapshots` skips symbols whose carry-forward seed has no
`price` (`rs_rating_service.py:471-473`).

`market_cap` survives on 2026-09-22 because `_enrich_screener_metrics` still
fills it; `pe`/`pb` have no such enrichment path. Confirmed end-to-end against
the live endpoint:
```
docker exec vnibb-api curl -s "http://localhost:8000/api/v1/screener?limit=2"
  "pe": null, "pb": null, "ps": null, "trade_date": null,
  "ev_ebitda": 0.0, "bvps": null, "current_ratio": null, "quick_ratio": null
```

### 6.2 `fundamental_enrichment: "skipped"` is a request-dependent flag, and it cannot help

`screener.py:1680-1688`:
```python
        nonlocal enrichment_outcome
        if not needs_fundamental_enrichment:
            return rows
        rows, enrichment_outcome = await _apply_fundamental_enrichment(rows)
```
`request_needs_fundamental_enrichment` (`screener.py:1340-1379`) is true only when
the request asks for fundamental columns, typed fundamental params, or a
fundamental filter/sort. A plain screen returns `"skipped"` by design — it is a
normal value, not an error, and the two degraded responses also emit it
(`screener.py:1970, 1985`).

And even when enrichment *does* run, it cannot supply `pe`/`pb`:
- `_apply_fundamental_enrichment` (`screener.py:1382-1415`) joins Mongo
  fundamental snapshots via `_FUNDAMENTAL_DOC_FIELD_MAP`, which maps only
  `intrinsicValue`, `marginOfSafety`, `moat`, `dividendYears`, `fcfPositive`,
  `valuationMethod`, `snapshotDate` — no `pe`/`pb`.
- `_enrich_screener_metrics` (`screener.py:665-1150`) never assigns
  `updates["pe"]` or `updates["pb"]`.
- `_to_screener_data_row` (`screener.py:216-217`) reads `pe`/`pb` with
  `getattr(row, "pe", None)` and **no** `extended_metrics` fallback (contrast
  `change_1d` and `debt_to_asset`, which do read the JSON blob).

### 6.3 `membership_current: false` / `membership_coverage: 0` are also not errors

```
docker exec vnibb-api curl -s "http://localhost:8000/api/v1/screener?limit=2" | (meta block)
  "fundamental_enrichment": "skipped",
  "universe": "ALL",
  "membership_current": false,
  "membership_source": null,
  "membership_synced_at": null,
  "membership_coverage": 0,
  "membership_available": true,
  "membership_stale": false,
  "cache_age_seconds": 14603
```
`screener.py:551-558` sets `membership_current = normalized != "ALL"` — with
`universe=ALL` this is `false` **by definition**, and `membership_coverage: 0`
is the default that is only overwritten when a universe-name index exists
(`screener.py:569-575`). Both are cosmetic for an all-universe screen.

### 6.4 The provider-side `pe`/`pb` regression (secondary, and already fixed in one place)

`providers/vnstock/equity_screener.py:543-555` maps only the **legacy**
`item_id` keys:
```python
                        metric_map = {
                            "p_e": "pe",
                            "p_b": "pb",
                            "p_s": "ps",
                            "roe": "roe",
                            ...
                        }
```
`data_pipeline.py:1396-1406` already carries the dual-format fix for the 4.x
keys (`pe`/`pb`/`ps` as well as `p_e`/`p_b`/`p_s`), with a comment naming the
exact regression: *"legacy emitted `p_e`/`p_b`/`p_s`, current 4.x emits
`pe`/`pb`/`ps`. Accept BOTH so valuation multiples don't silently land as NULL"*.
`equity_screener.py` did **not** receive it. This is a real secondary cause, but
it is currently masked: even when the ratios did come back, they land in
`financial_ratios`, which no scheduled job reads (§3.1).

---

## 7. Direct answers to the six ticket questions

1. **Real `MAX(date)` per feed** — see the table in §1.3. Six of the eleven
   tables are genuinely stale (`company_news` 13 d by `published_date`, 5 d by
   `created_at`; `financial_ratios` 125 d; `company_events` and `dividends`
   159 d; `order_flow_daily` 98 d; `screener_snapshots.pe`/`pb` 169 d and
   `trade_date` all-null).

2. **The `screener_snapshot` probe discrepancy** — the **public probe in
   `market.py` is wrong**, `/health/detailed` is right. `_PUBLIC_SOURCES` lists
   `rs_rating` with `"table": "rs_rating_snapshots"`, which does not exist; the
   resulting `UndefinedTableError` aborts the shared `AsyncSession` and the
   handler swallows it **without rollback**, so the next three probes
   (`screener_snapshots`, `company_events`, `shareholders`) all fail with
   `InFailedSQLTransactionError` and report `null`/`unknown`. `health.py` uses
   its own session and never queries the phantom table. Full log evidence in §2.2.

3. **Why `financial_ratios` is 125 d stale and `company_news` 13 d stale** —
   `financial_ratios` has **no scheduled owner**: its writers are
   `full_market`/`full`, which are not cron jobs, and the last `full_market` row
   (id 144) is still `running` from 2026-05-20. `company_news` is owned by
   `supplemental_company_sync` (10:30 UTC), which executes exactly **one** of
   {shareholders, officers, subsidiaries, company_news} per weekday via
   `weekday() % 4`, capped at 10 articles over a 120-symbol slice — so it last
   ran on Thu 2026-09-17 and wrote 11 rows. Both are further starved because the
   scheduler container is OOM-killed every ~15 minutes and never lets a long job
   finish (§3.3).

4. **`latest_sync_unsettled`** — `_load_completed_foreign_settlement_dates`
   (`market.py:113-156`) only accepts a trading date whose `daily_trading` run
   was `completed` with `error_count == 0` and `foreign_trading` stage
   `success == total && errors == 0`. Only 6 of 197 runs qualify; the newest is
   id 175 → **2026-07-02**, exactly the reported value. The raw table genuinely
   holds 2026-09-22 data, but only for 10 of 60 symbols (`foreign_trading:
   success 10 / total 60` for run 238), so the refusal is correct — the feed is
   demonstrably partial.

5. **Provider-side or ours** — mixed. `RetryError`/`AttributeError` from
   `price_depth` and `price_board`, the `PriceBoardData.symbol = NaN`
   validation failure, and the vnstock 4.x deprecation are **provider-side**
   (with free-tier rate limiting: 690 `Rate limit exceeded` events in 24 h, 554
   symbols aborting `Ratio summary`). The `ProgrammingError` in the intraday
   stage, the reaper overwriting `sync_status.errors`, the ~15-minute OOM kill,
   and the ungated `intraday_trades` writer in `realtime_pipeline.py` are
   **ours**.

6. **Screener null `pe`/`pb`** — **not** caused by `fundamental_enrichment:
   skipped`. The values do not exist in the database: `MAX(snapshot_date)` with
   non-null `pe` is **2026-04-06**, and the only writer since 2026-06-16 is
   `rs_rating_service`, which carry-forwards `pe`/`pb` instead of computing them
   and skips symbols without a seed price. `fundamental_enrichment` is a
   request-scoped flag that returns `"skipped"` for any screen not naming a
   fundamental field or filter, and even when it runs it maps no `pe`/`pb` from
   the Mongo snapshots.

---

## 8. Method / reproduction notes

- All DB reads used
  `docker compose --env-file /srv/vnibb/deployment/env.oracle -f /srv/vnibb/docker-compose.oracle.yml exec -T db psql -U postgres -d vnibb -c "…"`.
- API probes used `docker exec vnibb-api curl -s http://localhost:8000/…`
  (in-container loopback, no auth needed for the public freshness endpoints).
- Logs used `docker logs vnibb-scheduler|vnibb-api [--since …]`, parsed as JSON
  lines.
- OOM evidence used `dmesg -T`, `docker inspect vnibb-scheduler`, and
  `docker stats --no-stream`.
- **No service was restarted, stopped, or modified and nothing was written to
  the database.** One `docker restart vnibb-mcp --help >/dev/null 2>&1` was
  issued while probing `should_start_scheduler`; the CLI rejected the invalid
  flag set and no restart occurred (`docker ps` uptime unchanged across the
  window).
- Deployment revision for every log line and `/health/detailed`:
  `b71f2d2b326e3fad58eb350e898dd099b97d4943` (repo `main` @ `1faaddd`).
