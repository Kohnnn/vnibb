# Auto Update Strategy

## Goal

Refresh supported Vietcap IQ/Trading data and supplementary free VNStock VCI data through bounded, resumable acquisition. Durable receipts describe work actually attempted; a timer firing, existing rows or a large returned sample never certify whole-population or full-session coverage.

## Operating model

The acquisition universe is the sorted confirmed active SQL STOCK set. Bootstrap actual Trading STOCK metadata before full-universe maintenance; DELISTED instruments remain explicit inactive rows rather than being silently treated as current listings. Native historical STOCK acquisition can include delisted instruments as a separate explicit scope. Universe changes are recorded, not concealed behind a fixed top-rank slice.

`FullMarketSync.run_maintenance_cycle` persists symbol × dataset progress in SQL `SyncStatus`: `expected_symbols`, counts/pairs, dataset `acquired_symbols`/`failed_symbols`/`pending_count`, per-symbol receipts and `last_symbol`/`last_stage` cursor. Receipts retain attempts, success times, outcomes, rows, errors and acquisition evidence. Partial runs resume successful pairs instead of starting over. A refresh starts only after the preceding full-universe cycle completes and its refresh interval expires; budget-limited continuation is not daily full-universe success. Source-confirmed empty responses are distinct from failures, and an empty acquisition does not establish complete history.

### Trading hours

`realtime_pipeline.run_intraday_sync` traverses the full sorted active symbol × ticks/depth universe using durable receipts, not the former market-cap top-60 slice. Its run budget is 210 seconds with at most `2 * SCHEDULER_LIVE_SYMBOLS_PER_RUN` pair attempts (default 120 pairs). A completed traversal restarts on a subsequent call; failures remain available for retry after the tail. Explicit caller subsets have separate hashed receipt scopes. Derivative acquisition has a separate 25-second receipt/budget.

Default `DataPipeline` foreign/intraday calls with `symbols=None` also resume durable full-universe cycles: 240 seconds and at most `INTRADAY_SYMBOLS_PER_RUN` attempts (default 200). Explicit symbol callers are not truncated to that default prefix. These are bounded traversal contracts, not claims that every symbol refreshes during one live interval.

Trading ticks preserve their declared source units/timestamps. Request expansion from 500 up to 30,000 rows is still a sample unless the provider independently certifies `full_session` and `completed_session=true`; exhaustion alone does not prove whole history. Transaction Flow exposes `observed_*` sample measurements but withholds `total_*`/`domestic_*` without that certification. Independent daily foreign/proprietary feeds are not sample-matched. Default SQL retention of seven days of ticks and three years of daily flow/foreign data is not historical replay proof. Free VCI depth support is not assumed; unsupported acquisition, unknown units and missing observation dates remain visible.

### After close and off hours

Daily jobs keep recent market data separate from long historical catch-up. Profiles receive a 600-second daily continuation of a seven-day full-universe cycle. Filing maintenance receives 1,200 seconds for annual statements, quarterly statements and annual ratios, also with a seven-day completed-cycle refresh. The daily runner clamps these slices to its remaining 7,080-second overall budget; the job deadline is 7,200 seconds. Default statement refresh is six annual/40 quarterly source periods, not complete history. Explicit historical `start_year` acquisition requests the full closed-period set without an artificial 40-quarter cap; missing source periods remain incomplete in durable receipts.

Quarterly ratios have a separate daily 4,500-second continuation, a 5,400-second job timeout and a 30-day completed-cycle refresh. A timeout/provider failure remains a failure even when other symbols committed successfully.

Supplemental maintenance covers all active SQL symbol × dataset pairs for `shareholders`, `officers`, `subsidiaries`, `company_news` and `insider_deals`. At 10:30 UTC it attempts at most the configured weekday/weekend symbol budget × five datasets (defaults 120/300 symbols), within 80 minutes. It does not rotate rank buckets or reset a partial cycle weekly. Completed cycles have a one-day refresh interval. Static sectors and dated sector performance each have a separate two-minute stage. News/insider history is bounded sample acquisition; an empty response preserves prior records, and insider upserts do not truncate history or invent dates/units. Sector volume/value includes all observed members, preserving genuine zero and withholding unknown/nonfinite totals; no close × volume estimate supplies turnover.

### IQ historical and reference owners

- **12:15 UTC historical EOD:** at most 50 symbols, one window of at most 30 calendar days per symbol. Default history begins `2000-01-01`, respects actual listing dates where known and ends at today minus 7 days. The separate incremental owner keeps a rolling bounded 7-day window ending today, so days 0-7 are covered there and the historical walk advances the adjacent gap from day 8 until it catches up. An explicit `end` still overrides the default boundary. Fair selection visits unattempted symbols then oldest attempts. `market_eod_catchup_receipts` records symbol/start/end acquisition outcomes; only succeeded windows advance. Empty/failed windows retain their cursor. These receipts certify acquired windows, not exchange-session completeness.
- **14:15 UTC IQ reference:** at most 50 symbol/dataset pairs within 600 seconds (660-second job timeout). The two physical Mongo stores, IQ company profile and shareholder structure, have a distinct durable cycle over the full active SQL universe; a seven-day refresh starts only after that cycle completes. Details-only profile refresh preserves search metadata; shareholder response/history lineage is retained. Explicit source-confirmed emptiness is recorded, while malformed/missing/error responses fail.

These owners do not certify that the entire active universe finishes within a day or week. The interval determines when a completed cycle becomes eligible for refresh, not a guaranteed completion deadline.

## Current automatic schedule

| Job | UTC schedule / bound |
|-----|----------------------|
| `daily_sync` | 09:00 / 16:00 Vietnam time; recent market acquisition and bounded profile/filing continuation |
| `rs_rating_sync` | 09:10 |
| `daily_trading_sync` | 09:20 |
| `daily_data_quality_check` | 09:40 |
| `hourly_news` | Hourly |
| `mongo_eod_sync` | 10:15; rolling bounded ≤7-day recent-tail window (incremental EOD owner) |
| `supplemental_company_sync` | 10:30; durable five-dataset continuation |
| IQ historical EOD catch-up | 12:15; 50 symbols × one ≤30-day window |
| IQ reference maintenance | 14:15; 50 pairs / 600 seconds |
| `financial_ratios_sync` | 18:00; quarterly-ratio continuation |

## Provider and runtime policy

```env
VNSTOCK_RUNTIME_TIER=free
VNSTOCK_SOURCE=VCI
API_SKIP_SCHEDULER_STARTUP=true
SCHEDULER_LIVE_SYMBOLS_PER_RUN=60
SCHEDULER_SUPPLEMENTAL_SYMBOLS_PER_RUN=120
SCHEDULER_WEEKEND_SYMBOLS_PER_RUN=300
ORDERFLOW_AT_CLOSE_ONLY=true
ORDERBOOK_AT_CLOSE_ONLY=true
STORE_INTRADAY_TRADES=false
INTRADAY_REQUIRE_MARKET_HOURS=true
INTRADAY_ALLOW_OUT_OF_HOURS_IN_PROD=false
```

The isolated scheduler worker owns execution; API replicas must not run duplicate schedules. Required Redis coordination skips jobs when unavailable rather than risking concurrent writers. Sponsor packages and alternate KBS/TCBS routing are rejected before VNStock authentication. Free VCI reaches the same upstream and is not independent outage protection.

Use existing client pacing, bounded attempts and observed provider responses. The configured client floor was one request per second per client/worker with bounded retries; it is neither a provider quota guarantee nor an aggregate ceiling, and overlapping concurrent phases are not additive throughput. Sequential continuation of a queued acquisition phase is claimed only after process containment is verified (see the dated containment-risk note in [Oracle Runbook](oracle_runbook.md#13-october-2026-concurrent-acquisition-containment-risk)). Do not reuse the historical paid-runtime 150,000/day or 100/minute recommendations. Inspect errors/partial receipts before increasing attempt budgets; no configured rate implies entitlement or full-universe completion.

## Manual inventory and acquisition

Exact `inventory`, `backfill` and `resume` examples are in [Oracle Runbook](oracle_runbook.md#durable-population-commands). Root inventory is provider-free; `--apply` enables listing bootstrap/acquisition/writes. Its `--datasets` selection is `financials`, `ratios`, `reference`, `market` and `eod`; `market` reuses universe-level index/sector writers with a sentinel receipt and makes no historical-depth claim. Native provider-history defaults to `--count-back 10000`; repeat the fixed source/start/cutoff/checkpoint contract rather than using daily freshness to skip historical work. Record returned ranges and unavailable fields, not an unverified full-history claim. CLI time limits stop new attempts; in-flight synchronous calls may finish after the deadline.

Manual trading writers call the existing backend pipeline directly; they are operator/investigation entrypoints, not proof of scheduled coverage. Intraday ticks accept `symbols`, `progress`, `live_session` and `retain_ticks`; `live_session=True` is valid only during market hours, and the close pass omits it. There is no historical `trade_date` replay: a source session mismatch prevents relabeling old ticks as current. Depth has a separate writer with its own `live_session` flag. Free VCI depth may be genuinely unsupported; that failure stays visible and does not block an independent tick/flow success receipt. Read back `observed_*` flow fields (and `coverage.scope`/`completed_session`) only as sample evidence, and `coverage.scope=full_universe_rotation` with `complete`/`pending_pairs` on the realtime status endpoint as bounded acquisition progress. Nominal SQL retention of three years foreign/order-flow, seven days ticks and 30 days depth is not historical replay or completeness proof.

Full-population and release acceptance remain separate from the implementation contract. Production observed on 13 October 2026 still exposed revision `2c57654277ef5546662afc3cc7ed4a4e355e441e` with KBS routing; current working-tree owners are not thereby deployed.


## Observability

A schedule is only as good as your ability to tell whether it ran. The
scheduler records a per-job outcome and exposes it through `get_job_status()`
(surfaced by the data-sync status endpoint):

- `last_outcome` is one of `ok`, `failed`, `timeout`, or `skipped`;
- `consecutive_failures` increments on `failed`/`timeout` and resets on `ok`;
- `last_detail` carries the exception type and message for the last failure;
- `failing_jobs` aggregates every job currently in a `failed`/`timeout` state.

`skipped` deserves attention: a job is skipped when a previous run still holds
the lock, when another scheduler owns the distributed lock, or when required
coordination is unavailable. Before this existed, a skipped job was recorded
nowhere — `missed_runs` counted only APScheduler misfires — so a job that was
scheduled, ran, and quietly returned without doing its work looked identical to
one that never fired. That is precisely how a seven-day intraday outage stayed
invisible while the job kept reporting itself as scheduled.

The lesson worth keeping: **a job that returns a count is not necessarily a job
that did anything.** Check `failing_jobs` after any provider incident, and treat
a rising `consecutive_failures` as the signal it is.

