# VNIBB Product Improvement Execution Plan

Date started: 2026-07-16
Owner: VNIBB maintainers
Status: Implementation in progress; live gates pending

## Objective

Turn VNIBB from a broad widget terminal into a coherent Vietnam-market investor workflow:

1. discover investable ideas;
2. evaluate companies with source-preserving evidence;
3. record a thesis and monitor catalysts;
4. track holdings, limits, events, and alerts;
5. verify that data, releases, and recovery remain trustworthy.

This plan follows `docs/PRODUCT_INFRA_DATA_EXECUTION_PLAN.md`. MongoDB and PostgreSQL remain canonical serving stores. New product work must reuse existing endpoints and persisted data before adding infrastructure.

## Scope Rules

- Activate complete but unreachable features before creating substitutes.
- Prefer bounded extensions to existing widgets, queries, and storage contracts.
- Never imply delivery, freshness, analyst coverage, historical index membership, or foreign ownership when the source does not prove it.
- Keep browser-local workflows browser-local until cross-device demand justifies authenticated persistence.
- Do not add a numerical confidence score without defined inputs and interpretation.
- Do not add Elasticsearch, Spark, Kafka, a billing subsystem, or a new data-quality platform.
- Do not connect Bronze or Silver Parquet to API or MCP serving in this program.
- Do not implement cash-flow-aware portfolio performance before a deterministic transaction ledger exists.

## Success Measures

| Workflow | Measure | Repository acceptance | Live acceptance |
|---|---|---|---|
| Research | Evidence can become a reusable notebook record | World news, company evidence, and VniAgent answers preserve source IDs, URLs, symbol, and as-of metadata | Saved-answer and exported-source retention can be measured without collecting answer text |
| Discovery | Users can narrow the Vietnam universe correctly | Current index, listing age, target reference, foreign-flow, and price-limit states disclose coverage and date | No stale/unavailable source silently broadens a screen |
| Monitoring | Holdings/watchlist catalysts are visible together | Event calendar deduplicates bounded symbols and preserves source/symbol | Provider coverage and freshness are visible |
| Decisions | Users can record a reviewable investment case | Thesis, catalysts, risks, invalidation, status, and review date persist with the dashboard/local contract | Review-due workflow works across the supported persistence mode |
| Alerts | Trigger history is honest | One inbox distinguishes browser-local, polled, prediction, and server-backed sources | Delivery remains labelled unverified until receipts exist |
| Activation | New users reach a meaningful action | Goal routes reuse existing templates, symbols, and VniAgent prompts | First meaningful action and abandonment are measured without prompt content |
| Operations | A release is attributable and recoverable | Revision appears in health/log/Sentry contracts; CI tests Postgres migrations and browser smoke paths | Canary and rollback use the exact image revision |
| Data quality | Freshness is durable and market-calendar aware | Quality records persist and weekend/holiday rules are tested | One record per market day and sustained breach alerts work |

## Wave 0: Existing Live Gates

Status: Repository tooling complete; live execution pending

Required before claiming production completion:

1. collect the OCI and n6v inventory defined in `docs/PRODUCT_INFRA_DATA_EXECUTION_PLAN.md`;
2. build and verify free and premium immutable images;
3. run explicit migration, API, MCP, and scheduler canary checks;
4. observe Redis rate limiting in `shadow` before `enforce`;
5. complete two Bronze exports, one exact-snapshot Restic backup, and one isolated restore;
6. observe one full market and post-close scheduler cycle with no duplicate jobs.

No repository feature in later waves removes these gates.

## Wave 1: Research Workflow Quick Wins

Status: Repository complete; live/CI evidence pending where applicable

### 1.1 Activate Research Notebook

Deliverables:

- replace the registry placeholder with `ResearchNotebookWidget`;
- preserve live updates from browser-local notebook events;
- keep Markdown/JSON export source-preserving;
- add registry and render regressions.

Acceptance:

- a World News pin appears without reload;
- remove and clear operations update every mounted notebook view;
- export retains URL, source system, symbol, and capture time.

### 1.2 Save VniAgent Answers

Deliverables:

- add “Save to Research Notebook” to completed assistant answers;
- preserve full rendered answer, symbol, provider/model, source IDs, source systems, URLs, and as-of timestamps;
- add source URLs to the existing local run-ledger mapping;
- disclose browser-local storage and possible selected-document-derived content.

Acceptance:

- duplicate saves are deterministic;
- saving never includes API keys, hidden prompts, or unrestricted browser state;
- exported answers retain all attached source references.

### 1.3 Pin Company Evidence

Deliverables:

- add notebook actions to company news and corporate-action rows;
- store event/news dates, symbol, source URL, endpoint, and capture time;
- avoid pin controls when no source evidence exists.

Acceptance:

- company pins export with their symbol and source;
- no fabricated URL or provider label is written.

### 1.4 Complete Portfolio Export

Deliverables:

- export positions, totals, cash balance, value history, quote coverage, and sector-resolution coverage;
- use shared CSV/JSON export helpers;
- label the payload `localOnly` and preserve generated-at metadata.

Acceptance:

- every persisted portfolio field appears in JSON;
- CSV/JSON values reconcile with the visible snapshot.

### 1.5 VniAgent Accessibility

Deliverables:

- one polite response-status live region;
- `aria-expanded` and `aria-controls` for evidence disclosure;
- keyboard-reachable actions and adequate touch targets;
- focused accessibility regressions.

Acceptance:

- streaming chunks are not individually announced;
- prompt, completion, evidence, and save actions work by keyboard.

## Wave 2: Existing Placeholder Promises

Status: Repository complete; live/CI evidence pending where applicable

### 2.1 Earnings Season Monitor

Deliverables:

- replace the existing placeholder with a real widget using `useEarningsSeason()`;
- add exchange filtering, stable sorting, symbol linking, release/period labels, and available YoY fields;
- expose result count, latest date, and sparse coverage states through widget runtime metadata.

Acceptance:

- no new backend endpoint;
- selecting a result updates the linked VN symbol flow;
- empty results explain source/coverage rather than implying no companies reported.

## Wave 3: Screener Discovery

Status: Repository complete; live/CI evidence pending where applicable

### 3.1 Current Index Universe

Deliverables:

- add `ALL`, `VN30`, `VN100`, and `HNX30` filters;
- load current Vietcap-backed `market_index_constituents` membership;
- include membership source and `syncedAt` metadata;
- persist the filter in saved screens and alerts.

Acceptance:

- unavailable/stale membership never falls back to all stocks;
- results contain only stored current members;
- UI states that membership is current, not historical point-in-time membership.

### 3.2 Listing Age

Deliverables:

- expose listing date/age in screener rows;
- add `min_listing_age_days`;
- calculate historical age relative to the requested snapshot date;
- keep unknown dates explicit.

Acceptance:

- no age is inferred from first price history;
- saved screens retain the filter;
- known young listings are excluded deterministically.

### 3.3 Target-Price Reference

Deliverables:

- merge validated provider target price, rating/recommendation, and profile refresh time;
- calculate target upside only for positive unit-compatible values;
- add sort/filter/display support with source and stale coverage.

Acceptance:

- invalid/missing/unit-ambiguous values remain null;
- copy identifies provider/broker reference data, not VNIBB valuation or advice.

## Wave 4: Vietnam-Market Discovery

Status: Repository complete; live/CI evidence pending where applicable

### 4.1 Foreign-Flow Leaderboard

Deliverables:

- add a latest-settlement-date endpoint and widget;
- show top net-buy/net-sell symbols and positive/negative/flat breadth;
- disclose symbols covered, symbols unavailable, source, and trade date;
- link results to the shared symbol context.

Acceptance:

- one ranking uses exactly one trade date;
- volume is never labelled as notional or ownership change;
- unavailable symbols are excluded and counted.

### 4.2 Watchlist Ceiling/Floor Monitor

Deliverables:

- use the existing bounded price-board endpoint for at most 50 symbols;
- show at-ceiling, at-floor, inside-range, distance, bid/ask size, source, and refresh time;
- treat missing limit fields as unavailable.

Acceptance:

- at-limit status requires normalized equality with provider ceiling/floor;
- no exchange-limit inference is added;
- the widget identifies itself as a live snapshot, not EOD data.

## Wave 5: Investor Workflow

Status: Repository complete; live/CI evidence pending where applicable

### 5.1 Holdings And Watchlist Event Calendar

Deliverables:

- aggregate upcoming dividends, meetings, splits, rights issues, and available earnings events;
- support portfolio, watchlist, and bounded manual symbols;
- deduplicate by symbol, event class, and effective date;
- preserve source and provider coverage.

Acceptance:

- a ten-symbol set produces one chronological view;
- no single-symbol event widget is duplicated or removed;
- sparse provider coverage is explicit.

### 5.2 Structured Investment Thesis

Deliverables:

- extend notes with status, thesis, catalysts, risks, invalidation, and review date;
- retain free-form notes;
- persist through the existing dashboard/widget configuration contract;
- add due-for-review filtering and clear empty states.

Acceptance:

- no new browser-only store if dashboard configuration can carry the fields;
- legacy text notes migrate without data loss;
- review dates use explicit calendar dates.

### 5.3 Unified Alert Activity Inbox

Deliverables:

- create a read-only local timeline for price, saved-screen, prediction-market, and insider alert activity;
- label trigger source, trigger time, read state, and delivery class;
- retain last-good activity without claiming durable server delivery.

Acceptance:

- user can answer “what triggered today?” in one view;
- browser-local and server-backed activity remain distinguishable;
- email remains preference-only/unverified.

## Wave 6: Goal-Based Activation

Status: Repository complete; live/CI evidence pending where applicable

Deliverables:

- replace the first walkthrough choice with “Follow a ticker,” “Evaluate a company,” and “Scan the market”;
- route each goal to an existing template/view and existing VniAgent starter prompt;
- complete onboarding only after a meaningful action;
- keep goal and prompt text out of analytics payloads.

Acceptance:

- no new template taxonomy;
- completion requires a view open, symbol change, widget add, or prompt submission;
- Escape, focus, and mobile behavior remain accessible.

## Wave 7: Product-Enabling Platform Work

Status: Repository complete; live/CI evidence pending where applicable

### 7.1 Revision And SLO Telemetry

Deliverables:

- pass Git SHA/image revision as non-secret runtime metadata;
- include revision in `/health/`, structured logs, and Sentry release;
- define sustained 5xx, readiness, latency, and scheduler-miss alert contracts;
- run reliability checks against canary before promotion.

Acceptance:

- every release can be mapped to one immutable revision;
- alert tests reach the configured destination within ten minutes in live rollout;
- no Prometheus dependency in this slice.

### 7.2 Durable Trading-Calendar-Aware Data Quality

Deliverables:

- persist quality runs in canonical PostgreSQL;
- calculate staleness in Vietnam market business days;
- expose last successful run and source freshness;
- deduplicate sustained breach alerts.

Acceptance:

- weekend and configured holiday tests do not false-alert;
- every scheduled run has one durable record;
- a 30-market-day trend query is possible.

### 7.3 Query-Plan And Index Contracts

Deliverables:

- add read-only Postgres and Mongo preflight scripts;
- capture representative search, latest-EOD, and rolling-window plans;
- assert required EOD indexes without creating them at API startup;
- benchmark screener standard/advanced paths.

Acceptance:

- no index is created without measured justification;
- latest EOD avoids a collection scan;
- ticker search and screener budgets are documented and testable.

## Wave 8: Release Contract Tests

Status: Repository complete; live/CI evidence pending where applicable

Deliverables:

- add CI that applies Alembic to empty PostgreSQL and runs representative API contracts;
- add Chromium smoke tests for dashboard render, ticker search, and screener filtering;
- keep Firefox/WebKit and broad E2E coverage deferred;
- block canary promotion on existing runtime and widget smoke checks.

Acceptance:

- migration succeeds from an empty PostgreSQL database;
- representative contracts run on PostgreSQL instead of only SQLite;
- three browser paths pass in release-candidate CI.

## Wave 9: Trust Baseline And Existing Market-Analysis Activation

Status: Repository implementation complete

### 9.1 Status-Aware Request Retries

Deliverables:

- retry only transient read failures such as network errors, timeouts, and server errors;
- do not retry authentication, authorization, not-found, rate-limit, offline, mixed-content, or caller-aborted reads;
- disable implicit mutation retries unless a call site explicitly proves idempotency.

Acceptance:

- invalid or rate-limited reads fail once with their structured error;
- transient reads retain capped exponential retries;
- a failed mutation executes once by default.

### 9.2 Stable Realtime Recovery

Deliverables:

- keep WebSocket callbacks in refs so parent renders do not reconnect the socket;
- retain last-good prices while disconnected;
- retry after `online` and visible-page recovery when subscriptions remain enabled;
- avoid duplicate sockets and reconnect timers.

Acceptance:

- replacing an `onUpdate` callback does not construct a new socket;
- symbol updates use the current subscription;
- an exhausted outage reconnects after browser connectivity returns.

### 9.3 Safe Dashboard Browser Persistence

Deliverables:

- guard dashboard serialization and browser writes against quota/private-mode failures;
- keep in-memory state and last-good persisted state when a save fails;
- disclose that browser changes are not saved;
- converge valid dashboard/folder changes from another tab without applying malformed state.

Acceptance:

- a failed `localStorage.setItem` does not crash the dashboard or overwrite last-good data;
- valid cross-tab changes load as one state transition;
- malformed remote state is rejected and reported.

### 9.4 Truthful Watchlist Quotes

Deliverables:

- represent unavailable quote values as null rather than zero;
- render an unavailable/awaiting state and sort unknown quotes last;
- retain and time-label last-good observed prices during disconnection.

Acceptance:

- no missing quote is displayed or sorted as a tradable zero;
- disconnected cached values remain distinguishable from live values.

### 9.5 Canonical Vietnam Session Phases

Deliverables:

- align frontend state, polling, and backend WebSocket status around `09:00–11:30` and `13:00–14:45` ICT;
- model `14:45–15:00` as explicit post-close finalization with slower refresh;
- treat lunch, weekends, and after `15:00` as closed;
- keep holiday support explicitly separate until a server-authoritative calendar is exposed to every client.

Acceptance:

- UI status, polling cadence, and WebSocket status agree at every session boundary;
- high-frequency market-open polling stops at `14:45`;
- post-close finalization remains distinguishable from active trading.

### 9.6 Activate Existing Market-Analysis Widgets

Deliverables:

- replace placeholder registrations for `transaction_flow`, `industry_bubble`, `sector_board`, `money_flow_trend`, and `correlation_matrix` with their existing components;
- correct Correlation Matrix endpoint and provenance so backend-derived results are not labelled browser-local;
- preserve sparse, stale, fallback, proxy, and derived-flow disclosures.

Acceptance:

- all five widgets are discoverable and resolve through the registry;
- existing persisted placeholder instances begin rendering without migration;
- Transaction Flow identifies derived domestic flow;
- Money Flow Trend remains labelled a relative-strength/momentum proxy;
- Correlation Matrix reports its actual backend endpoint and partial-window warnings.

### Wave 9 Verification

```text
focused Jest for retry, WebSocket, dashboard persistence, watchlist, market sessions, registry, and correlation provenance
focused pytest for WebSocket session boundaries and the five existing endpoints
pnpm --filter frontend lint
pnpm --filter frontend exec tsc --noEmit
python -m ruff check <new-or-focused-backend-files>
pnpm run ci:gate
```

No live deployment, provider call, database mutation, index creation, or new infrastructure is required for repository completion.

## Wave 10: Decision Integrity

Status: Implementation in progress

### 10.1 Portfolio Valuation Truth

Deliverables:

- never substitute cost basis for market value when a quote is missing;
- show quoted market-value subtotal, unpriced cost-basis subtotal, quote coverage/count, and unavailable aggregate market value/P&L where incomplete quotes prevent a truthful aggregate;
- retain cost basis as cost basis, not a valuation fallback.

Acceptance:

- a missing quote never contributes a tradable market value or unrealized P/L;
- aggregate market value and P/L explicitly state unavailable when quote coverage is incomplete;
- copy says “quoted market value,” “unpriced cost basis,” and “quote coverage”; it does not claim portfolio value or profit/loss when unavailable.

### 10.2 Evidence-Linked Theses

Deliverables:

- attach and detach existing browser-local Research Notebook item IDs from a thesis;
- render source-preserving links and provenance from the linked notebook records;
- keep the relationship browser-local; add no AI scoring or cross-device claim.

Acceptance:

- attach, detach, reload, export, and missing-record states remain deterministic;
- thesis evidence identifies its source, URL when present, symbol, and capture/as-of metadata without fabricating fields;
- copy identifies linked browser-local research, not verified analysis or investment advice.

### 10.3 Existing-Metadata Disclosures

Deliverables:

- show standard adjusted-price coverage/source-health disclosures only on existing response/query metadata already available to the decision surface;
- do not broaden endpoints or add metadata plumbing;
- if contextual freshness needs broad plumbing, limit disclosure to the decision surfaces already carrying freshness metadata and state that exact ceiling in implementation.

Acceptance:

- adjusted prices and source health are never implied where existing metadata cannot support the claim;
- sparse, unavailable, stale, and unknown states are distinct;
- no endpoint, provider, dependency, migration, or infrastructure change is introduced.

## Wave 11: Connected Investor Workflow

Status: Implementation in progress

### 11.1 Watchlist Connections

Deliverables:

- add an explicit Screener “Add to Watchlist” action: add directly for one watchlist, require a target for multiple, and create/add through current dashboard APIs when none exists;
- deduplicate normalized symbols;
- feed Dashboard Watchlists into Watchlist Ceiling/Floor Monitor alongside manual configured additions, deduplicated and capped at 50 with source counts.

Acceptance:

- one, multiple, and no-watchlist paths are unambiguous and preserve existing watchlists;
- duplicate normalized symbols appear once; over-cap symbols are not silently queried;
- monitor reports dashboard-watchlist, manual, deduplicated, and capped symbol counts.

### 11.2 Linked Activity And Navigation

Deliverables:

- open the linked symbol from alert activity; expose unified activity from the header bell while retaining insider/server distinction;
- make Notebook symbol badges and due thesis rows navigate to their linked symbol;
- seed Price Alert’s add form with the currently linked symbol only when the form opens, with finite threshold validation.

Acceptance:

- activity never claims server delivery for browser-local or insider activity;
- navigation preserves the selected normalized symbol;
- blank, non-finite, and invalid thresholds cannot be submitted; a previously open form does not replace its symbol unexpectedly.

### 11.3 Accessibility

Deliverables:

- provide names, keyboard operation, visible focus, touch targets, and non-hover-only access for every new, icon-only, and hover action.

Acceptance:

- watchlist, activity, navigation, and alert flows complete by keyboard;
- assistive labels distinguish action, target, and unavailable state.

## Wave 12: Existing Widget Activation

Status: Implementation in progress

Deliverables:

- activate exactly `bank_metrics`, `valuation_band`, `cashflow_waterfall`, and `technical_summary` through their existing components and endpoints;
- render persisted placeholder instances without migration;
- audit sparse, unavailable, provenance, and non-advice states.

Acceptance:

- exactly those four widgets are discoverable and resolve from the registry;
- persisted instances render without data migration;
- no other placeholder activates; unavailable or sparse data does not imply coverage, valuation certainty, or advice.

## Wave 13: Bounded Market Intelligence

Status: Implementation in progress

### 13.1 Foreign Flow Leaderboard

Deliverables:

- add net-volume/net-value selection and 1D/5D/20D cumulative settlement-qualified windows;
- rank each request against one ending settlement date and disclose symbol/date/field coverage;
- make no ownership or investor-intent claim.

Acceptance:

- every ranking identifies metric, window, ending settlement date, covered/unavailable symbols, and available fields;
- mixed settlement dates and incomplete fields are not silently combined;
- volume/value flow is not labelled ownership, allocation, or intent.

### 13.2 Contextual Source Health

Deliverables:

- add compact source-health disclosure to decision widgets only from existing freshness endpoint/data;
- add no health dashboard or delivery claim.

Acceptance:

- disclosure is contextual, source-specific where supported, and distinguishes unavailable from stale;
- no new endpoint or broad freshness plumbing is introduced.

### 13.3 Positioning And Big Flow Gates

Deliverables:

- activate Positioning Dashboard only when a focused request-count and coverage audit proves bounded behavior;
- keep Big Flow deferred until its endpoint distinguishes provider failure from a legitimate empty response.

Acceptance:

- Positioning Dashboard remains unavailable unless the audit records bounded requests and explicit coverage;
- Big Flow never fabricates a zero/empty state for provider failure.

## Implementation Order And Verification

1. Wave 10 valuation semantics and browser-local evidence linkage.
2. Wave 11 watchlist, activity, navigation, alert validation, and accessibility.
3. Wave 12 exactly four existing widget registrations and state audits.
4. Wave 13 bounded leaderboard and source-health work; perform Positioning/Big Flow gates before activation.

```text
focused Jest for valuation totals, notebook-thesis links, watchlist paths/cap, activity navigation, alert validation, accessibility, widget registry, and leaderboard coverage
focused pytest only for existing endpoint/query contracts touched by the bounded leaderboard
pnpm --filter frontend lint
pnpm --filter frontend exec tsc --noEmit
python -m ruff check <new-or-focused-backend-files>
pnpm run ci:gate
```

Repository completion requires no live call, mutation, provider, dependency, migration, infrastructure, endpoint expansion, or deployment. Truth wording must describe observed data, coverage, source, and browser-local scope; it must not claim advice, delivery, ownership, intent, valuation completeness, AI verification, or cross-device persistence without proof.

## Explicitly Deferred

### Positioning Dashboard

Reason: activate only after a focused request-count and coverage audit proves bounded behavior for the existing data path. Until then, no widget is registered and no coverage claim is made.

### Big Flow

Reason: keep deferred until the existing endpoint can distinguish provider failure from a legitimate empty response. Empty or zero flow must not be fabricated from an unavailable provider.

### Transaction Ledger

Reason: aggregate positions cannot safely produce realized P/L, fees, dividends, cash-flow-aware returns, or corporate-action cost basis. Required follow-up is a separately approved accounting contract covering buys, sells, dividends, fees, deposits, withdrawals, lot rules, imports, migration, and reconciliation.

### Server Alert Delivery

Reason: production delivery requires authenticated user-owned rules, scheduler evaluation, retries, receipts, revocation, and user-visible history. Repository-local browser notification and polling improvements must not imply email or push reliability.

### Claim Verification

Reason: a second constrained verifier pass adds model cost and requires a precise trusted-context contract. Build only after source-preserving notebook capture and evidence usage are measured.

### Authenticated Research Handoff

Reason: cross-device/shared packets require immutable content hashes, owner/recipient authorization, expiry, and revocation. Validate browser-local notebook demand first.

### Silver Analytics And Historical Constituents

Reason: Silver starts only after two Bronze exports and one proven restore. Historical index replay requires snapshot history that the current constituent writer overwrites.

## Verification Rhythm

After each wave:

```text
pnpm --filter frontend lint
pnpm --filter frontend exec tsc --noEmit
python -m ruff check <new-or-focused-backend-files>
focused frontend Jest and backend pytest
```

Before marking repository implementation complete:

```text
pnpm run ci:gate
```

Operations and browser checks remain separate from repository completion when they require Docker, credentials, live databases, or deployed services.

## Progress Log

- 2026-07-16: Repository and competitor-feature audit completed; shipped/planned duplicates excluded.
- 2026-07-16: Improvement waves ordered by activation, discovery, investor workflow, and product-enabling operations.
- 2026-07-16: Detailed scope, acceptance, dependency, and deferral contracts recorded.
- 2026-07-16: Implementation started. Existing uncommitted product/infrastructure work remains preserved and uncommitted.
- 2026-07-17: Waves 1-8 repository implementation completed: research notebook workflows, Earnings Season, screener discovery, foreign-flow and price-limit discovery, investor workflows, goal onboarding, release/data-quality/query telemetry, PostgreSQL CI contracts, and Chromium smoke coverage.
- 2026-07-17: Final frontend, backend/data, and deployment/CI reviews completed; all blocking and high findings fixed, including fabricated event dates, breach-day deduplication, Mongo plan/index contracts, readiness gating, immutable revision identity, and contract-test database isolation.
- 2026-07-17: `pnpm run ci:gate` passed all six stages with 583 backend tests passed and one PostgreSQL-only local skip; `git diff --check` passed with Windows line-ending warnings only.
- 2026-07-17: No commit, deployment, database migration, index mutation, image publication, backup, or restore was performed. Wave 0 live gates remain required.
- 2026-07-18: Wave 9 selected after a read-only workflow, latent-data, AI, UX, reliability, and simplification audit. Scope is the trust baseline plus activation of five existing market-analysis widgets; implementation started.
- 2026-07-19: Wave 9 repository implementation completed: status-aware read retries, mutation retry safety, stable realtime recovery, transactional dashboard persistence, truthful watchlist quotes, canonical Vietnam session phases, and activation of five existing market-analysis widgets.
- 2026-07-19: Final trust and data-contract reviews completed; all blocking and high findings fixed, including session-bound intraday writes, deterministic stream cleanup, deep persisted-state validation, finite-number filtering, full-universe sector aggregates, nullable domestic flow, proven investor-flow coverage, and observed-return correlation metadata.
- 2026-07-19: `pnpm run ci:gate` passed all six stages with 628 backend tests passed and one PostgreSQL-only local skip; `git diff --check` passed with Windows line-ending warnings only.
- 2026-07-19: No commit, deployment, provider call, database migration, index mutation, image publication, backup, or restore was performed. Live rollout gates remain required.
- 2026-07-20: Waves 10-13 execution plan approved and implementation started; scope is decision integrity, connected investor workflows, four existing widget activations, and bounded market intelligence with Positioning Dashboard and Big Flow gated.
- 2026-07-21: Pre-migration backups captured and verified (PostgreSQL custom dump + MongoDB gzip archive), each isolated-restored in throwaway Docker containers with 34/34 table and 16/16 collection parity; checksums recorded in `backups/BACKUP_VERIFICATION_20260721T181749Z.json`. No source writes, no host-exposed restore targets. Restic encryption remains blocked on missing `RESTIC_REPOSITORY`/password config.
- 2026-07-21: Shipped CI-verifiable improvement tier: centralized copilot cache TTL (removed magic `ttl=20` at `market.py` `market_indices`, extracted `resolve_cache_ttl` helper + divergence guard test); registry-wide no-throw widget mount smoke test (151/151) with jsdom observer/matchMedia/scrollIntoView shims; CI runner Node 20->22 and PostgreSQL contract service 16->17; and AI copilot degraded-mode surfacing (backend `RuntimeConfigResponse.available`, frontend runtime probe + banner + disabled input when unconfigured and no browser-local key). Added `scripts/restore-drill.ps1` and `docs/BACKUP_AND_RESTORE_DRILL.md` documenting the verified restore sequence.
- 2026-07-21: CI-config bumps (Node 22, PostgreSQL 17 contract image) are verified by CI itself, not local `ci:gate`; flagged as locally-unverifiable. Tier C features (silver layer, freshness badge, screener diff, alert delivery) remain spec-only pending frozen-write approval and n6v host reachability.
- 2026-07-22: Live dashboard benchmark completed against production; a correctness bug (`/news/trending` 404 from router double-prefix) and a cold-load latency profile (non-CDN origin, per-request SSR, serial JS chunk download) were isolated. Dashboard performance and correctness overhaul recorded in `docs/DASHBOARD_PERFORMANCE_OVERHAUL.md`; implementation started (fixes + perf overhaul including backend read-only caching).
- 2026-07-24: Overhaul shipped. Phase 1.1: `/news/trending` 404 fixed with a bare `/trending` alias mirroring the existing `/sentiment` alias precedent so the `/news` mount resolves without the redundant in-file `/news/` prefix; regression test added to `test_news_endpoint_api.py`. Phase 1.2: `net::ERR_ABORTED` tab-switch noise confirmed unsuppressable browser network logging with no app-level escalation (`shouldRetryQuery` ignores `AbortError`, `fetchAPI` rethrows caller aborts untouched) — no code change. Phases 2.1+2.2: extracted shared `DashboardSkeleton` used by both server `loading.tsx` and the client `!mounted` branch, replacing the bare "Loading dashboard..." text with visual continuity (kept the `mounted` gate; the shell reads client-only viewport/localStorage and would hydrate-mismatch if SSR'd). Phase 3.2: `WidgetLibrary`, `WidgetSettingsModal`, `AppsLibrary`, `TemplateSelector`, `AICopilot`, and `OnboardingWalkthrough` converted to `next/dynamic` (`ssr: false`), splitting them out of the cold-start bundle. Phase 4.1: `/api/v1/dashboard/system-layouts/published` added to the existing `ResponseCacheControlMiddleware` `staticish` policy (`max-age=300, stale-while-revalidate=1800`) with a header regression test. Phase 3.1 (edge-caching the per-request SSR dashboard document) deliberately deferred as highest-risk pending separate approval.
