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

### Added
- Personal workspace JSON backup with multi-tab layouts, widget configuration, nested folders, isolated ticker-group snapshots and linked TradingView ticker snapshots. Imports preview contents and restore as local copies without replacing existing dashboards or syncing them to the backend.
- Copilot chart/table actions can target a named personal dashboard and tab, including from a system dashboard. Promoted widgets with a source ticker retain it locally without mutating the shared workspace ticker.
- Ticker scope is explicit and reversible: a widget shows whether its ticker is shared with its group or kept locally, can be detached without leaving the group, and can rejoin by adopting the group's current ticker.
- Statement tables support chartable metric selection with labeled series; period headers retain sortable columns. Active metric context reaches the copilot through the widget runtime payload.
- Purpose-bound research starters pair a template with its VniAgent prompt. Applying one discloses how its widgets handle tickers and primes the agent through the same seam the onboarding walkthrough uses.
- Copilot artifact placement remembers the chosen dashboard/tab for the rest of the response and across reloads, records artifact provenance inside the created widget, and can save a table artifact to the research notebook once.
- Investment Thesis now retains citation identity when notebook originals change, links due-for-review theses to their editor, and transfers selected theses with matching source originals in a separate research bundle. Imported research dashboards remain browser-local.
- Investor Home connects watchlists, holdings, alerts, activity, and notebook navigation, with persisted alert validation and labeled controls.
- VniAgent offers grounded follow-up questions under a completed answer. Symbol-scoped eligibility, ranking evidence, and citations use only sources identified with the requested ticker; other tickers and unknown-symbol evidence cannot back its prompts. Market-scoped suggestions retain market sources. Suggestions backed by an artifact or the active tab rank first.
- Widget requirements expose catalogue-owned ticker scope, reviewed inputs, VniAgent evidence mappings, and limits. Agent context follows the focused widget ticker and drops mismatched company snapshots.
- Read-only thesis sharing freezes author-entered research for named authenticated recipients, with expiry, owner revocation, and active-session checks on every operation. Provider originals and unverified citations remain excluded; local research transfer is unchanged.
- Google Sheets integration adds opt-in bounded pulls (`/api/v1/apps-script/bounded/{dataset}`) with truthful provenance: availability distinguishes unavailable from empty, the source date stays unknown when the data carries none (fetch time is never reported as the data date), and each pull writes limits/as-of/source/limitations next to the data. Legacy flat endpoints and `VNIBB_*` cell formulas are unchanged; writes redact secret-like columns and never place API keys in cells.
- Reviewed research starters carry versioned server-resolved workflow identities, mandatory evidence kinds, and explicit limitations; stale identities fail before streaming and missing evidence is disclosed instead of invented.

- MCP analytical-corpus reads resolve symbols against the outer storage
  `symbol` field only and return the full storage envelope, so premium-dataset
  results no longer surface foreign tickers or drop Vietcap rows that lack a
  raw symbol. `get_price_depth` reads flat levels from the newest `updatedAt`
  write batch and preserves per-row `observedAt` provenance; write time does
  not establish market-data freshness.

### Fixed
- React Query resolves its consumer's React types explicitly, avoiding CI type failures caused by unrelated React 18 workspace types being hoisted into the React 19 frontend.
- Empty or unusable TTM source results retain an explicit unavailable reason and null metrics; calculation failures no longer disappear into a generic empty response. Deployment smoke checks validate HTTPS certificates instead of bypassing trust.
- Deferred published tabs are discarded when Back/Forward leaves their workspace. Unsupported statement rows show their source reason instead of blank TTM sections, and date-only observations use a day-granular freshness window.
- Wide-row financial aliases pass through the same unit normalization and lineage checks as canonical metrics; a missing lineage entry cannot certify a monetary field as VND.
- `pnpm --filter frontend qa:live-smoke` discovers published workspaces and tabs, exercises click and direct navigation within bounded budgets, and reports pending/error bodies separately from navigation success.
- Deferred widget trees mount before visible DOM attachment, preventing cached lazy imports from stranding their Suspense fallback after a warm reload. Charts recover when a positive-size observation arrives after detached-mount retries are exhausted. Collapse still unmounts content; off-screen requests start earlier.
- Dashboard rendering uses the precomputed active layout and matching column count, removing the responsive grid cache that alternated medium projections with authored desktop geometry. Responsive projections remain unsaved.
- Unavailable financial-period reasons remain visible beside populated sibling rows. Hydrated news IDs retain their string identity, and unavailable heatmap universes no longer display zero-stock legend counts.
- Derived EMA, gamma, flow-regime and beta consumers withhold uncertified price inputs; source coverage remains separate from observation staleness, and missing sector changes no longer appear as neutral zero returns.
- Fiscal-year FX follows the same financial quantity through flow-chart formatting. Explicit FY aliases retain their real year; quarter rows are not relabelled as TTM, and unsupported TTM ratios stay unavailable.
- Fresh workspace deep links apply their requested tab after workspace selection without callback-driven restore loops. Late published tabs remain deferred until available and genuine user navigation cancels the pending request.
- Peer percentage normalization uses declared stored-fraction keys instead of magnitude guesses. Loaded-peer averages disclose their cohort, and backtest/sweep footers expose windows, fees, execution and Sharpe basis.
- News relevance requires boundary-safe ticker mentions and the analyzer's actual confidence scale; rule-based ranks are not presented as match probabilities.
- Charts require per-row price-unit declarations instead of trusting aggregate certification; unmarked sessions are withheld or retained as visible gaps. Unconfirmed quotes no longer drive mixed-unit 52-week ranges, and confirmed monetary quote deltas share the price's FX boundary.
- Source observation time is separate from retrieval, cached delivery and coverage in widget health, exports, news and data-source views. Missing news publication dates remain unknown; a new fetch does not make old data live.
- Fundamental valuation retains explicit price, statement and share-unit lineage in schema 2. Unknown units and conflicting fiscal observations suppress monetary comparisons; legacy snapshots remain unverified instead of receiving magnitude-based repairs.
- Widget search explains no matches and restores opener focus on Escape. Insider net values distinguish missing, genuine zero and signed amounts. Listing responses preserve stored industries, and empty heatmaps disclose unavailable coverage.
- The GET-only `scripts/qa_data_contract_smoke.py` checks served history envelopes and unit declarations without certifying provider values or rewriting data.
- Financial statements retain source-unit and fiscal-basis lineage. KBS amounts already normalized by the installed parser are no longer multiplied twice; TTM uses a balance snapshot or complete compatible quarterly flows, with explicit unavailable reasons for unknown units or ambiguous periods.
- Financial table and Growth Bridge use an absolute prior denominator for negative-base comparisons without changing the underlying annual earnings. Transition labels distinguish loss-to-profit from same-sign negative comparisons.
- Workspace URL writes remain scoped to the active workspace and carry router state; deferred symbols cannot freeze navigation after leaving their target workspace.
- Backtest and sweep use the same settled-session price basis and expose replay parameters. This alignment does not independently explain the originally reported Sharpe discrepancy.
- Quote/history price units are source-backed and canonical: certified equities use VND, indices/derivatives retain points, and unmarked legacy or sponsor data remains unknown. Explicit unit markers take precedence; prices are never classified by magnitude. Ingestion, cache reads and analytical consumers preserve provenance and disclose excluded unknown-unit history.
- The advanced chart retains deterministic API history, rejects unknown or incompatible quote units and old timestamps, and protects same-day adjusted bars from raw quote replacement. The observed `57.3`/`57300` mismatch no longer selects the smaller close. Derived market capitalization and valuation require confirmed VND prices.
- ATR Regime uses the historical observation date for visible freshness and runtime/export provenance; fetching old data does not relabel it live. Optional dashboard sync preserves linked `globalMarketsSymbol` and ticker `widgetGroups`, while imported workspaces stay local.
- The changed-line Ruff gate captures up to 32 MiB of JSON diagnostics rather than failing with Node's default subprocess buffer limit on larger integrations. Existing diagnostic filtering remains unchanged.
- The Gitleaks cache-namespace allowlist matches the full assignment rather than the extracted value, so versioned `cached()` namespaces are not mistaken for API credentials; credential scanning remains enabled.
- Modular quote/screener ingestion now opens real async database-session contexts instead of returning an unawaited coroutine. Comparison market-cap recomputation reads shares from the Company store and uses the existing numeric coercion helper, avoiding undefined-name failures.
- Screener history enrichment retains actual provider price lineage through persisted snapshots and cache output; unknown-unit prices cannot drive derived market cap or dividend yield. The modular daily writer reuses the supported sparse upsert helper, preserving existing trading value while clearing absent adjusted close.
- Dated unknown-unit screener enrichment no longer replaces a certified stored price. The selected price keeps its own observation date, volume and unit/source provenance through snapshots and cache, so unmarked sponsor history cannot blank an available canonical market price.
- Quant analysis refills known sessions excluded for incompatible units even when the trusted tail is current. Unresolved sessions produce insufficient-data results instead of cross-gap daily returns; weekends do not create artificial gaps.
- Screener performance windows retain unresolved session positions rather than compressing unknown-unit rows into adjacent returns. Enrichment clears unsupported cached metrics; fully populated rows retain the existing no-query fast path.
- Snapshot daily changes use the prior matching settled session or retain the snapshot-supported change pair. Peer momentum, relative rotation and correlation retain unknown-unit session boundaries rather than manufacturing cross-gap daily returns.
- Premium OHLCV backfill preserves index-only trading dates during unit normalization, so dated provider rows persist as sessions rather than being skipped as integer-index dates.
- Historical-price queries consume TanStack cancellation signals through the existing API transport. Changing the requested symbol or range, or removing the final observer, aborts obsolete client requests without changing query keys or cache policy. Client cancellation does not establish cancellation of backend/provider computation.
- Matrix follow-up drafts reach VniAgent on both desktop and mobile dashboard mounts without auto-submitting. Research starter requests are consumed at the dashboard boundary, so closing and reopening VniAgent cannot replay a completed starter.
- MCP price-depth retrieval selects the newest write batch before filtering levels. An all-zero newest batch returns empty depth instead of resurfacing stale positive levels from an older batch.
- Catalog depth ingestion preserves distinct prices even when provider rows share symbol/ticker/time metadata. Scope-and-price keys stay stable across volume changes; the regression executes real `_upsert_raw_rows` operations against an upsert-aware store and verifies bounded reader results and repeat refreshes. Previously overwritten levels require a new provider fetch.
- VniAgent follow-ups require every mandatory source kind in the prompt's scope. Partial evidence no longer offers valuation, margin, balance-sheet, flow, catalyst, or market-breadth questions that need missing sources; single-source prompts remain available.
- Follow-up eligibility, citations, and ranking use the same scoped evidence selection. Required source entries without citable IDs cannot enable a question; padded duplicate IDs are normalized and deduplicated.
- Private research-share reads bypass service-worker caches, and activation purges older cached snapshots. Account changes discard stale create/revoke completions; anonymous issuer identities are rejected.
- Reviewed starter identities survive initial workspace session restoration, clear on later ticker/session changes, and restrict final citation validation to evidence in the selected workflow scope.
- Listing/profile cache writes use atomic symbol-key upserts, preventing duplicate listing inputs or concurrent first writes from rolling back valid metadata. Sparse updates preserve existing values and creation timestamps.
- Mongo EOD ingestion refuses writes without an assured unique natural-key index and propagates bulk failures to the scheduler instead of reporting a successful zero-row refresh. Existing Vietcap coverage remains a valid zero-write result; partially accepted unordered bulks are disclosed as failed ingestion.
- The scheduled Mongo EOD job now records a durable failed outcome when any symbol fails, after the entire sync finishes. Consecutive failure counters increment for partial and total failures, then reset on a successful zero-write or normal run.
- PostgreSQL release-contract fixtures open fresh connections per test event loop, preventing pooled asyncpg connections from leaking between loops. Production connection pooling is unchanged.
- Prediction ingestion uses the official PredictIt public feed with genuine contract outcomes, Limitless bounded active-market pagination, and Manifold supported open-binary search. HTTP failures preserve status codes; no unavailable provider is replaced with synthetic odds.
- Daily market acquisition clamps historical gaps to the requested window and exchange calendar, preserves certified screener rows on failed reacquisition, and uses modular financial/quote adapters. Financial maintenance records full-Universe durable stage/symbol progress, bounded execution and fair continuation instead of restarting after timeout; partial acquisition never certifies completion.
- Profiles and annual/quarterly filing maintenance resume daily toward a weekly full-Universe cycle. Quarterly ratios resume daily at 18:00 UTC toward a 30-day full-Universe cycle. Existing job deadlines remain unchanged; provider failures stay distinct from clean budget-limited progression.
- Catalog provider refreshes return failure and persist a failed run when any symbol fails, while retaining successfully written rows and per-symbol checkpoints. Licensed depth recovery still requires a successful premium installation; the observed Golden device-limit gate is not bypassed.
- Financial-ratio natural-key writes are repaired. A pre-repair production census found `uq_financial_ratio_symbol_period` absent, although both `FinancialRatio` and the initial migration declare it. This proves live-schema drift; when or why it occurred is unknown. Without the constraint, `INSERT ... ON CONFLICT (symbol, period, period_type)` fails with "no unique or exclusion constraint matching the ON CONFLICT specification". An idempotent migration restores the constraint (production measured zero duplicate keys across 17,400 rows), and a PostgreSQL contract test proves the upsert updates in place and re-running the migration changes nothing. The separately recorded sync timeout is not attributed to this defect.
- Prediction-market catalogue admission counts fresh, real, active, nonclosed,
  unexpired markets toward each source's 10,000-market cap. Historical rows
  remain available while separate physical and snapshot storage limits continue
  to apply. Older Kalshi rows no longer prevent admission of new live contracts.
  Deployment of this follow-up is not claimed here; see the production runbook.
- Holdings edits and exports use committed local data; failed browser-storage writes leave the form intact and the warning visible until a successful retry, including after background valuation snapshots.
- Top Movers identifies last-session fallback rows separately from requested gainers and marks provider failures as unavailable rather than empty-market results.
- Screener table actions retain full touch targets; technical and valuation widgets disclose unavailable indicators and source/cache provenance rather than implying unsupported freshness.
- The built-in Investor Home thesis editor is read-only and directs users to an editable personal workspace; the system dashboard rejects widget configuration writes, so it no longer claims that unsaved thesis text was saved.
- Big Flow reports provider failure as unavailable instead of a zero-activity tape; the block-trade service no longer converts query errors into an empty result. Positioning Dashboard is not promotable until its request count and symbol coverage are bounded and disclosed; saved instances keep resolving as an explicit unavailable state.

### Deployed
- Released the financial-ratio natural-key repair to cloud-01 on 2026-10-05. API, MCP and scheduler run `2c57654277ef5546662afc3cc7ed4a4e355e441e`, pinned to `ghcr.io/kohnnn/vnibb-api@sha256:c87b372fc0416a7369a2a01ba58c56d6fb79d9435ac1dcc33b6512362f7bda4e`. The one-shot `migrate` applied `b7312f0c4e88 -> e5f1a7c9d2b4`; `migrate current` confirms `e5f1a7c9d2b4` and `uq_financial_ratio_symbol_period` now exists, with all 17,400 `financial_ratios` rows preserved and zero duplicate keys. Health, MCP health and scheduler heartbeat passed at the new revision, and the production natural-key upsert is accepted (proved inside a rolled-back transaction). Existing databases, proxy and the premium runtime mount were preserved. The separately recorded `financial_ratios_sync` 5400s timeout and upstream prediction-source failures remain open. See the dated repair section in `docs/oracle_runbook.md` for rollback.
- Released interrupted-session recovery to cloud-01 on 2026-10-04. API, MCP and scheduler run `ffc322e3cdc097977a4dfdb90581a466e7912e66`, pinned to `ghcr.io/kohnnn/vnibb-api@sha256:9431643d277b6163e20bcf12b672da73521bf07e4c4ced86474e242d70b0c4f0`. All four hosted CI jobs passed; migration head remains `b7312f0c4e88`. Health, market endpoints, dashboard CORS, WebSocket and authenticated MCP reads passed. Existing databases/proxy and the premium runtime mount were preserved. Legacy depth data still requires a provider refresh; upstream prediction-source failures remain disclosed. See the dated recovery section in `docs/oracle_runbook.md` for rollback and verification limits.
- Released grounded VniAgent follow-ups to cloud-01 on 2026-10-03. API, MCP and
  scheduler run revision `e1399211a051efe0546546de511b7549e0ad9f23`, pinned to
  `ghcr.io/kohnnn/vnibb-api@sha256:0f29208a5a86893b21ffb143d7cb049eef63f6cd77753a5eb0e089cb9d63905d`.
  All four hosted CI jobs passed; migrations remain at `b7312f0c4e88`.
  Live copilot SSE returned VNM-only source IDs for symbol prompts. With
  sidebar workflow outputs enabled, production browser verification rendered
  three follow-up buttons and clicking valuation submitted the VNM prompt.
  Readiness, market endpoint, CORS and WebSocket smoke checks passed. The
  premium runtime mount and existing database/proxy containers were preserved;
  the prior digest `8545eb64eace697740ce1016654ac7a35cd74c69556c097c10068558176840b3`
  and environment backup remain available under `deployment/backups/copilot-rollout/`.
- Released the integrated Workspace and Matrix build on 2026-09-27. Merge
  revision `7c9274e6a060615484832b9838804eb53eb4cc9b` passed all four hosted
  CI jobs. OCI API, MCP and scheduler run the same ARM64 image
  `ghcr.io/kohnnn/vnibb-api@sha256:b5b2ab435ff1c3bd290adadd4a67a4a6dcadb7ac8824521bca8bd694bb6c6af8`;
  PostgreSQL is at migration `b7312f0c4e88`. Canonical `vnibb-web` Vercel
  production serves deployment `dpl_ExuTux8bnpvoTFtoiNVw5eQggF5q`. A fresh
  paired Postgres/Mongo backup `20260927T133058Z` passed on-host scratch and
  isolated off-box restores before migration. Production Matrix peer/period
  preparation reads retained real FPT/CMG observations; anonymous snapshot
  history returns 401 and supplier export remains denied without explicit
  rights. A real end-user snapshot/LLM handoff, physical touch and human
  product approval are not claimed; see the dated acceptance ledger.
- Released to the Oracle stack on 2026-09-24. Serving revision
  `d329dc2b2250bba00652a363684d58799939fae6`, published as
  `ghcr.io/kohnnn/vnibb-api@sha256:49c167d79177453c2962953022f9cf0ecb072646c48c504d13b1271f49349ed3`.
  API, MCP, and scheduler all run that same pinned digest.
- Database reached migration head `d4c39e8a7b12`. `20260922_1745` (prediction-market
  provenance) was already applied in the live database but unrecorded in
  `alembic_version`, so it was stamped rather than re-run against its 14.5M-row
  table; `20260923_0900` and `20260923_1000` then applied normally.
- A verified paired Postgres/Mongo backup (`20260924T175056Z`) preceded migration.
- **Operator note:** tables in the `vnibb` database were owned by `supabase_admin`
  while the migrate/app role is `postgres`, which made any `ALTER TABLE` on an
  existing table fail with `InsufficientPrivilege`. Ownership of the 35 affected
  tables and 33 sequences was reassigned to `postgres`. Fresh databases built from
  these migrations should provision the app role as the owner to avoid repeating
  this.

### Added
- **Matrix** (`research_matrix`) — frozen company-by-question research. A registered
  dashboard widget compares an anchor company with an editable peer shortlist over
  four curated sector playbooks (non-financial, banks, insurers, securities) at a
  common fiscal year, with a common-quarter override. Supported dimensions carry
  frozen typed values, exact serving-record evidence and explicit limitations;
  unsupported sector metrics report `unavailable` rather than being mapped to a
  misleading generic proxy, and mismatched reporting basis reports `non_comparable`.
  One canonical decimal value and one server-formatted `display` drive the cell,
  preview, evidence inspector and copied selection, so a percentage can never be
  re-rendered with a different sign or scale. Snapshots are owner-bound and
  immutable in the existing `app_kv` store, with append-only revision-bound review
  and separate revocation; browser persistence holds view preferences and snapshot
  references only, never protected values. View operations execute no research.
- **Evidence inspector and scoped handoff.** Each cell opens its exact evidence with
  basis, scope and review state, and can be carried into a scoped follow-up. The
  VniAgent path sends a typed `{snapshot_id, result_ids}` selection whose context the
  server rebuilds and reauthorizes; the request text carries references only. The
  external MCP path exposes a read-only `get_matrix_selection` tool that resolves the
  same selection from the per-request authenticated user identity, refuses the shared
  deployment bearer, and is subject to an explicit source-rights policy that denies
  unapproved providers (including configured `family:unknown`), so snapshot
  references are never bearer grants.
- Research Matrix is available in the Investor's Widget Library under AI & Research; adding it to a personal tab keeps the existing 24-column workspace geometry and the Matrix snapshot authorization model.
- Matrix preparation exposes available fiscal years and quarters for proposed companies; a bounded read-only lookup checks edited 2–10-company shortlists before Create, including eligible peers beyond the initial nine suggestions. A shared quarter does not require annual rows.

### Fixed
- Global Markets ticker tape now uses TradingView's iframe embed for live quotes and price changes; unavailable embeds show an explicit Retry/Open in TradingView error instead of a local symbol-only marquee.
- Narrow widget headers move controls into an accessible compact panel; overflow menus escape card clipping and support keyboard navigation. Chart timeframe/type controls now agree across the header, chart body, and saved configuration.
- Responsive viewing, empty-state hints, zoom/container changes, and edit-mode toggles do not rewrite authored desktop widget geometry; collision-safe manual resizing preserves other widgets' positions. Narrow layouts remain view-only. Widgets added at the bottom now receive finite coordinates before storage, so reload and backup cannot reject the dashboard.
- Restored workspace ticker groups and linked TradingView ticker stay scoped to their copies. Following a group no longer changes the Global ticker; a locally detached TradingView symbol stays detached across ticker changes and reload. Deep links wait for local hydration and the requested dashboard before applying a ticker.
- Maximized widgets keep one live editor and retain unsaved in-memory drafts across maximize/restore; header-specific actions remain available in the widget container while the shared shell suppresses duplicate headers.
- Saved Overview tabs using the retired `valuation_multiples` ID migrate to the registered Valuation Multiples Chart without losing the widget's ID or layout.
- Statement widgets keep table/chart and period controls reachable on the dashboard. The dashboard suppresses duplicate inner headers; controls live in the body or a reachable action row. Selected metrics render matching series rather than empty charts.
- Valuation aliases now migrate every saved widget instance, including same-config duplicates at different positions; an empty ratio-history response no longer loops when the widget reports its runtime state.
- Copilot global-ticker actions update the linked widget group as well as the workspace header; TradingView command actions target the destination dashboard ticker without changing the source workspace. Cloud reconciliation selects a surviving dashboard and tab if the active remote layout disappears.
- Drawdown Deep Dive, Hurst Market Structure, Dividend Ladder and Quant Summary now keep empty/loading-derived runtime dependencies stable, so a linked widget can publish status without triggering a parent/child render loop.
- Income Statement now opens wide financial tables at their newest periods like Balance Sheet and Cash Flow, while preserving horizontally scrollable older years and the sticky metric column.
- The 13 registered Widgets previously routed through placeholders now load their existing named implementations. Income Sankey keeps incomplete and loss-making flows unavailable rather than drawing positive ribbons; quantitative and global-market surfaces distinguish missing coverage from observed zero.
- API installs in CI, the release image, and the documented local setup use SHA-256-constrained VNStock publisher wheels with PyPI for unrelated dependencies. The impossible direct `vnai<2.5` pin was removed; free-tier startup and optional premium installation retain their existing contracts.
- Alembic and application sync sessions convert PostgreSQL URL scheme prefixes to the declared `psycopg2` driver rather than relying on SQLAlchemy's implicit `psycopg` default; password contents are preserved.
- Ratio TTM views no longer inherit cached FY statement columns after a period switch. Income Sankey quarter selection respects the chosen Q1–Q4 rather than always charting the latest quarter; intraday Volume Delta no longer labels five-minute samples as a 20-day cumulative total.
- Nightly prediction-market cleanup jobs now await their guarded tasks. Automatic stale-catalogue deletion excludes unarchived terminal contracts reserved for archive-first retention; retained genuine 1d/7d/30d observations remain available even if today's quote vector disappears or the catalogue row is pruned.
- Reviewed Matrix follow-ups keep references in the typed selection instead of the editable question; oversized questions fail visibly rather than being silently truncated. Authorized Matrix chat streams and denials use `no-store`.
- Inactive prediction-market lists apply end-date ordering before limiting results. Probability aggregates validate every outcome, retaining genuine first-outcome zero prices in multi-outcome markets while excluding malformed vectors.
- MCP user JWTs authorize only owner-scoped Matrix selection; existing market and premium tools still require the shared deployment bearer. Matrix export refuses generic `vnstock`/`vnstock_ratio`, bare relation, and unknown supplier tags even when configured; explicit test-only supplier tags do not grant real-provider rights.
- Snapshot inserts reject unobserved probability vectors instead of recording false 0% history while retaining genuine zero quotes. Consensus volume stays unavailable when no priced market contributed observed volume; invalid concurrent stale-market indexes are rebuilt rather than marked applied.
- Snapshot writers page past recent markets without observed quotes within the bounded source catalogue, so unpriced Kalshi rows cannot displace an older fresh genuine 0% quote from daily or intraday history.
- PostgreSQL bucket triggers derive UTC day/15-minute buckets from captured timestamps for both old and new snapshot writers, so migration-before-image deployment and image-only rollback do not break old writes.
- Workspace duplicates choose bounded collision-free coordinates; detached TradingView symbols remain exchange-qualified and update when settings change. Newly activated native ticker controls navigate within their linked scope, external Screener searches synchronize across tabs, and VniAgent Open matches the artifact ticker before focusing a widget.
- A remote Screener clear no longer revives the initial empty search as a stale local echo; detached widget tickers reconcile saved Settings values even if the widget was unmounted when they changed.

- Prediction-market analysis now exposes full contract terms/outcomes and
  1d/7d/30d recorded history, with observed percentage-point changes, ranges,
  sample counts and actual coverage. Intraday and nightly observations are
  merged without fabricated gaps; the drawer escapes transformed widget grids.
- All five prediction providers remain visible. Synthetic/stale catalogue rows
  no longer masquerade as current odds; missing price vectors are not 0%, and
  zero-source calibration no longer claims divergence. Reads share a bounded
  fresh catalogue; descriptions, source units and timestamps retain provenance.
  Verification: 32 API regressions and 18 frontend regressions passed; real-data
  browser smoke exercised drawer rendering, history-window changes, and Escape.
- Prediction-market catalogue growth is now bounded. The Kalshi cursor sweep
  stops at a hard ingest budget instead of paging the whole corpus, and a new
  daily retention job deletes catalogue rows no provider has refreshed within
  the retention horizon — rows the bounded read path can never return. Retention
  walks the stale end through a new `(updated_at, id)` index and never touches
  synthetic provenance, archived referents, or terminal rows owned by the
  archiving retention. On the live node the catalogue went from 14.7 M rows and
  12.3 GB of heap to 2.5 M rows and 1.3 GB, with host root usage falling from
  74 G to 58 G. Verification: 6 new retention tests plus a Kalshi budget
  regression, all passing; the production batch walk measured 3.26 ms for 5,000
  rows versus 112 s for the naive count.
- Prediction-market ingestion excludes Kalshi multivariate combos and enforces
  bounded batches, payloads, per-source catalogue admission and relation-size
  ceilings. Both snapshot cadences select a fresh, real, capped universe;
  interval keys and serialized writes prevent retries or changing selections
  from exceeding bucket limits. Daily and intraday retention run independently.
  Random historical backfill and production fixture fallback no longer create
  fabricated observations. Index migration supports bounded catalogue reads.
- OCI backup container-space probes now support BusyBox as well as GNU `df`,
  and reject stopped containers before starting a dump.
- Financial ratio tables no longer present absent data as real numbers. A period the
  provider could not compute (missing price, EPS, or book value) is now shown as an empty
  cell instead of `0.00`. Valuation multiples treat a literal `0` as absent, because a
  company never trades at zero times earnings; metrics where zero is meaningful are
  untouched. This affected both the Financial Ratios widget and the Ratios tab of the
  Financials widget, where an earlier formatter coerced `null` through `Number(null)`.
- Financial Period View aligns both the standalone Financial Ratios widget and the
  Financials Ratios tab to the adjacent statement panels' fiscal-period window.
  Older ratio-only years are excluded, and a statement-only current-year YTD
  period remains visible with empty ratio cells. If the statement feed is
  unavailable, both views retain their available ratio periods.
- Synthetic YTD and TTM statements now preserve missing quarterly metrics as
  unknown instead of summing them as zero. Income and cash-flow snapshots sum
  only their own fields, and a reported zero remains zero only when every
  contributing quarter reported a value.
- Prediction-market intraday retention now runs independently of the 15-minute
  snapshot writer. It deletes only rows older than seven days in bounded,
  resumable transactions; ingest timeout no longer strands the cleanup step.
  The OCI backup producer checks available space before dumping, streams
  PostgreSQL once, and removes incomplete sets without pruning prior backups.
  The off-box restore accepts historical manifests that self-listed
  `manifest.json` while still verifying both data artifacts by hash.
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
