# Changelog

All notable changes to VNIBB are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
semantic versioning at the user-facing dashboard level.

Sections used: `Added`, `Changed`, `Fixed`, `Internal`. "Internal" covers
infra, observability, and developer-facing work that is invisible to users.

Every release passes the standard gate: `pnpm run ci:gate` (frontend lint,
build, Jest) plus backend `ruff` and `pytest`. Individual verification logs
live in `docs/`.

## [Unreleased]

### Fixed
- Backup verification now fails on artifact corruption, nonzero restore, missing equity history, or an existing scratch database; failed copies remove their partial staged dump without deleting a pre-existing one. An isolated off-box Postgres/Mongo restore utility verifies a paired set, representative data, and container cleanup before reporting success.
- The API reads durable scheduler-worker outcomes across processes and returns unavailable instead of empty healthy status when its observation store fails. Prediction-market query paths are bounded; terminal-market retention is archive-first, row-locked, batch-limited, dry-run by default, and gated on an operator-verified backup/isolated restore.
- A cached whole-market screener Universe requires a completed full-run symbol-coverage record; partial runs do not invalidate a previously complete partition. Screener provider failures without fallback are marked unavailable rather than zero matches, and quote failures no longer fabricate zero price or current timestamps.
- Heatmap responses and widgets expose constituent and price dates separately, including stale or unknown constituent provenance and cached data labeling.
- **Root cause of the nightly `daily_trading` failure: twelve unique
  constraints declared in the models were never actually created in the
  database.** Every writer using `get_upsert_stmt` emits `INSERT ... ON
  CONFLICT`, which Postgres rejects with `InvalidColumnReferenceError: there
  is no unique or exclusion constraint matching the ON CONFLICT specification`
  when the constraint is absent. `intraday_trades` had therefore failed for
  every symbol (0 success / 60 errors) for seven consecutive days, and several
  other feeds were silently frozen at their last successful load. A new
  migration restores all twelve constraints, deduplicating first (only
  `dividends` and `company_events` actually held duplicates).
- The intraday stage logged per-symbol failures at `debug`, so a stage failing
  for every symbol produced no operator-visible output at production
  `LOG_LEVEL=INFO`; the first few failures now log at `warning`, and the
  per-stage error breakdown and samples are persisted into the checkpointed
  sync payload instead of counts alone.
- **Prediction-market rows seeded from the offline fixture are now labelled as
  such.** `populate_prediction_markets` falls back to checked-in JSON fixtures
  whenever a live provider fetch fails or returns nothing, and the resulting
  rows were indistinguishable from live rows — a provider outage produced a
  populated dashboard and a source-health row reading `synced`. Rows now carry
  `is_synthetic`, fixture seeds set it, live ingests clear it, and
  `source-health` returns `synthetic_market_count` and refuses to report a
  source as synced when its whole population is synthetic.
- Scheduler job outcomes are recorded per job (`ok` / `failed` / `timeout` /
  `skipped`) with a consecutive-failure count, and exposed through
  `get_job_status`. Previously a job that ran and failed looked identical to
  one that never fired, and a job skipped because a lock was held was recorded
  nowhere — `missed_runs` only counted APScheduler misfires.
- The frontend health proxy no longer discards the backend's verdict: it
  hardcoded `status: 'ok'`, so a degraded backend reported itself as healthy to
  any monitor keying off `status`.
- Quant endpoints no longer serve empty price frames: the six historical
  loaders (`_load_historical_from_*`, `_load_corporate_actions_for_adjustment`,
  `_apply_corporate_action_adjustments`) are now re-exported from
  `vnibb.api.v1.equity` instead of being shadowed by no-op stubs in `quant.py`.
- Postgres connection hardening: `statement_timeout`, `lock_timeout`, and
  `idle_in_transaction_session_timeout` are now applied to every new DBAPI
  connection on both async and sync engines. Defaults are 30s / 5s / 60s and
  can be tuned via `DB_STATEMENT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`,
  `DB_IDLE_IN_TX_TIMEOUT_MS`.
- `sync_database_url` no longer corrupts passwords containing `+asyncpg` —
  it now uses a regex anchored to the URL scheme prefix.
- The detailed health endpoint's Redis probe reuses the shared `redis_client`
  instead of opening a new connection per request, which removes a leak under
  high health-check load.
- `AnalystEstimatesWidget` no longer renders "Coming Soon" placeholder rows
  for empty payloads; it now shows an honest empty-state explaining the
  Vietnam-market coverage gap.
- The screener request path no longer degrades the shared Screener Snapshot
  table (issue #8). `store_screener_data` is now insert-only for `source` and
  lets `NULL` win over nothing, so a live request bounded by its own `limit`
  can only add rows or fields, never blank a populated column or relabel the
  provenance the scheduled full-universe sync recorded.
- Screener freshness is derived from `snapshot_date` rather than
  `created_at`. Every scheduled pass rewrites the write timestamp, so a
  snapshot whose prices had stopped advancing was reported as "just
  refreshed" for an hour after each run.
- Screener snapshot writes and reads use one clock. The writer keyed rows by
  `date.today()` (host local) while stamping `datetime.utcnow()`, which on an
  `Asia/Ho_Chi_Minh` host split a single snapshot across two dates for seven
  hours each day and left the reader unable to find the row the writer had
  just created.
- `/api/v1/health/detailed` reports the newest Screener Snapshot's trade date
  and age, and marks the component degraded when the feed has genuinely
  stalled. The scheduled data-quality job already recorded this verdict in
  `data_quality_runs`, where no health watcher could see it. The date is
  coerced across drivers because `MAX()` over a Date column returns text
  under SQLite.
- The RS rating service no longer creates a Screener Snapshot row for a symbol
  it cannot carry valuation data forward for. When it reaches a date before the
  full sync has written that date it creates the missing rows itself, seeded
  from each symbol's most recent prior snapshot. A symbol whose prior snapshot
  has no price has nothing to seed from, so its row held an RS score and almost
  nothing else — leaving a snapshot day that looked complete by row count while
  the visible fields were empty for most of the market. Those rows are now
  skipped and written properly by the next full sync.
- The scheduled screener sync no longer writes rows with a silently unset
  price. Its optional fields were guarded with `hasattr`, which is true
  whenever a field is *declared*, so a provider model that declared `price`
  but left it unset wrote a NULL that no reader could distinguish from a
  symbol with no quote. Mapping now checks the value, the upsert coalesces
  instead of overwriting (so a sparse sync cannot blank another writer's
  column), `source` is insert-only there too, and `snapshot_date` is stamped
  in UTC rather than the host's local date.
- VNStock premium packages are no longer an implicit startup requirement.
  `VNSTOCK_RUNTIME_TIER=free` is the default operating contract: the
  entrypoint verifies only VNStock's free runtime, while `premium` retains
  strict module verification for premium-built images. Health metadata now
  exposes the configured tier, KBS fallback source, Vietcap-primary EOD
  contract, and premium capability availability.
- Screener snapshots now preserve the actual market `trade_date` attached to
  quote-history prices separately from the materialization `snapshot_date`
  and write timestamp. The nullable expansion does not guess historical
  values; freshness prefers proven trade dates and falls back to snapshot
  dates for legacy rows during rollout.

### Changed
- Appwrite has been removed from the product. Postgres (via SQLAlchemy) is now
  the single durable data store for every runtime read and write; MongoDB
  remains the analytical vnstock premium source and Redis the cache tier.
  `DATA_BACKEND` no longer accepts `appwrite`/`hybrid`, the `APPWRITE_*`
  settings and `vnibb.core.appwrite_client` module are gone, and the
  Appwrite population/price-mirror services and their sync hooks were deleted.
  Historical price, quote, and profile resolution now run cache -> Mongo ->
  Postgres -> provider, with no Appwrite rung in the ladder.
- The VNIBB read-only MCP server now reads Postgres directly. Its
  Appwrite-facing surface was renamed: `get_appwrite_status` ->
  `get_database_status`, `query_appwrite_collection` ->
  `query_database_collection`, the `vnibb://appwrite/*` resources ->
  `vnibb://database/*`, and the `appwrite_collection_audit` prompt ->
  `database_collection_audit`.
- System dashboard layout templates are SQL-only (`app_kv`); the optional
  Appwrite mirror and its connectivity requirements are gone, so template
  saves no longer depend on a second store being reachable.
- The copilot context contract renames `prefer_appwrite_data` to
  `prefer_database_data`; source precedence is now `postgres` then
  `browser_context`. The web client still sends the legacy key for one
  release so an older backend keeps working.
- Health and admin payloads drop the `appwrite` component and the
  `appwrite_configured`/`appwrite_write_enabled`/`appwrite_writes_active`
  provider flags. `X-Data-Source` always reports `postgres`.

### Internal
- Added `apps/api/tests/test_core/test_config.py` covering the new timeout
  settings and the regex-based `sync_database_url` derivation.
- Added `apps/api/tests/test_api/test_quant_loader_aliases.py` asserting that
  the quant module's helpers resolve to the canonical equity implementations.
- Added `apps/web/src/components/widgets/AnalystEstimatesWidget.test.tsx` and
  `apps/web/src/components/widgets/TickerProfileWidget.test.tsx` covering
  empty, loading, error, and data states.
- `scripts/ci-gate.mjs` now prints a final CI summary table with per-step
  duration, fails fast on the first error, and handles SIGINT/SIGTERM cleanly.
- `scripts/oracle/healthcheck.sh` retries each endpoint up to 3 times before
  reporting failure.
- `scripts/oracle/smoke_test.sh` validates JSON body shape (not just status
  codes) on critical endpoints and asserts the `providers.data_backend`
  field is present in `/api/v1/health`.
- `scripts/oracle/runtime_verify.sh` accepts an optional `MCP_HEALTH_URL` and
  asserts the MCP sidecar responds 200 alongside the API.
- Added `apps/api/tests/test_services/test_screener_snapshot_ownership.py`
  pinning the Screener Snapshot write-ownership and freshness invariants: a
  narrower writer cannot blank a populated column or relabel provenance, a
  row's `snapshot_date` agrees with its write date, and staleness tracks the
  trade date rather than the write time.
- Added `apps/api/tests/test_api/test_health_snapshot_freshness.py` covering
  the snapshot age and breach reported by `/api/v1/health/detailed`.
- Added `apps/api/tests/test_services/test_rs_rating_snapshot_rows.py` pinning
  when the RS rating service may create a Screener Snapshot row on its own:
  a carry-forward price must exist, an existing same-day row is enriched in
  place rather than duplicated, and a same-day row's provenance is preserved.
- Added `apps/api/tests/test_services/test_screener_sync_payload.py` covering
  the scheduled sync's row payload: a declared-but-unset price is omitted
  rather than written as NULL, a repeat sync cannot blank a populated column,
  and the row is keyed to the UTC snapshot date.
- Added `apps/api/tests/test_core/test_vnstock_runtime_tier.py` covering the
  explicit free/premium startup contract and health capability disclosure.
- Added `apps/api/tests/test_services/test_screener_trade_date.py` covering
  provider-date propagation, cache freshness precedence, legacy fallback,
  detailed-health metadata, and the nullable migration contract.

## [v1.5.0] - 2026-07-02

The "data flows again" release. End-of-day prices are unstuck, the quant and
global-markets workspaces gained new widgets, and the palette is now
colorblind-safe.

### Added
- Colorblind-safe palette preference in Settings → General. Gains/losses switch
  to a blue/orange scheme applied app-wide, including TradingView charts.
- GARCH(1,1) conditional-volatility widget, seeded into the default quant
  workspace.
- Polymarket prediction-market widget in the Global Markets dashboard, backed by
  the new `/prediction-markets` API.
- Frontend `/api/health` proxy that surfaces the active data backend without
  leaking backend internals.

### Fixed
- End-of-day prices were frozen for the whole universe: the premium provider no
  longer exposes the legacy quote class, so history now routes through the
  premium `Quote` path with a KBS→VCI fallback. Prices advance daily again.
- Mixed-unit EOD prices are normalized at the frame boundary, and fundamental
  market-cap now uses raw-VND close, so valuations stopped drifting by 1000x.
- Key Metrics widget occasionally rendered an unstable payload on slow backends.
- Dashboard grid no longer re-persists layout on unchanged drag echoes.
- Disabled sidebar menu items now expose their state to assistive tech.

### Internal
- Scheduler hardened against stale-data stalls; added the prediction-markets
  sync path.
- Smoke contracts cover the health and freshness endpoints.

## [v1.4.0] - 2026-05-22

The "stability + paper cuts" release. Templates always work, the Financial
Statement tab is no longer blank for stocks with partial provider data, and
the Seasonality Spiral got a real granularity selector.

### Added
- Spiral seasonality heatmap now supports both daily and weekly granularity in a single widget.
- Inline release notes panel renders the full `CHANGELOG.md` so users can
  scroll through historical changes without leaving the dashboard.
- Settings → General now includes a "Release Notes" card with a button to
  re-open the What's New panel on demand.
- In-process parity scripts under `apps/api/scripts/` for financial
  statements and technical analysis that bypass FastAPI rate limiting.

### Changed
- Applying a template on a locked default dashboard now silently creates a
  fresh editable workspace seeded with the template instead of routing the
  user through a confirmation modal. The "blacked out" template UX is gone.
- Quick-add and empty-tab starter cards on locked dashboards now follow the
  same "auto-create workspace" pattern.
- Seasonality Heatmap weekly columns no longer show the `W` prefix in cards,
  tooltips, or the average row. The number speaks for itself.
- What's New panel auto-dismisses after 5 seconds of inactivity and also
  closes when the user switches browser tabs. Hover or focus pauses the
  countdown.
- Sidebar version label is now driven from `lib/version.ts` so the sidebar,
  the panel, and analytics all agree on the current release.

### Fixed
- Financial Statement tab rendering blank for tickers where provider returned
  data only under camelCase or Vietnamese-diacritic field names.
- Period mismatch between frontend (`FY | Q1..Q4 | TTM`) and backend
  (`year | quarter | ttm`) that quietly dropped requests.
- TradingView wrappers occasionally rendering a blank panel when the
  external script timed out; they now retry once and fall back to a clear
  error card with a TradingView deep-link.
- Technical Snapshot widget hanging on slow backends without a retry
  affordance.

### Internal
- Bumped statement endpoint cache key prefix from `_v2` to `_v3` to evict
  empty-array entries written before the period normalization fix.
- Added concrete `data_quality.issues` strings (`"Only N bars (need >=30)"`,
  duplicate dates, stale latest bar) instead of opaque flags.
- Centralized release version in `apps/web/src/lib/version.ts`.

## [v1.3.0] - 2026-02-25

Sprint V46 - V72 consolidated. Data completeness and pipeline readiness.

### Added
- New backfill scripts for batch financial resync, screener enrichment, and
  ratio refresh under `apps/api/scripts/`.
- Peers, TTM aggregates, growth rates, and sector drill-down endpoints for
  parity with the dashboard's analytical surface.
- Dynamic `/sectors` symbol population from database metadata with
  market-cap ranking.

### Changed
- Peer selection now prioritizes same-industry peers, then same-exchange,
  then market-cap proximity with deterministic tie-breaking.
- Market heatmap aggregates real database-derived change percentages instead
  of mock values.
- Dividend payloads carry a normalized `cash | stock | mixed` payout type,
  annual DPS rollups, and computed yield.
- Header backend-status component requires repeated failures before
  flipping to the offline state, removing flicker on transient blips.

### Fixed
- Sector top movers crashing on null change values; payload key styles are
  now parsed defensively.
- Light-theme readability across header, sidebar, and copilot surfaces.
- Modal and command palette transparency artifacts ("dark stuck" issue).
- Financial period normalization that preferred ordinal counters over the
  reported fiscal year.

### Internal
- Hardened sector top movers against vnstock and vnai quota failures that
  raise `SystemExit`.
- Aligned CORS, health route, and websocket routing.
- Added `data_pipeline` and `comparison_service` ratio fallback hydration.

## [v1.2.0] - 2026-02-22

Sprint V46 - V52. Modal styling, peers/TTM/growth parity, and the first wave
of light-theme work.

### Added
- Peers, TTM aggregates, and growth-rate endpoints (V49 and V50 routes).
- Comparison path aliases plus no-trailing-slash compatibility.
- Custom dashboard templates stored in localStorage with category filtering
  and recommendation surfacing.

### Changed
- Modal and command palette surfaces moved to opaque theme tokens to fix
  transparency issues.
- Empty-tab quick-add actions and stale-tab cleanup at runtime.

### Fixed
- Hidden-container chart dimension warnings via mount guards.
- Heatmap stale-cache fallback and explicit provider timeout guard.

## [v1.1.0] - 2025-12-15

Pre-sprint groundwork. Internal release used to validate the dashboard
shell, widget registry, and the first ten widgets.

### Added
- Multi-tab workspaces with drag-and-drop layout.
- Widget library and template selector.
- TradingView native widget wrappers for chart, ticker tape, and stock
  heatmap.

### Changed
- Migrated from a single-page "stock screen" prototype to the full
  workspace shell.

## [v1.0.0] - 2025-08-10

Initial public preview. Single-stock screen with key metrics, a price chart,
and a basic financial summary.

---

## Conventions

- Versioning follows the dashboard product, not individual API versions.
- Sprint-level work is consolidated into the closest user-facing release.
- Verification details live in dated files under `docs/`.
