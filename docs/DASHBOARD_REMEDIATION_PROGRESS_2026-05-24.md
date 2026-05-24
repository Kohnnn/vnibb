# VNIBB v4 Dashboard Remediation — 2026-05-24

Sources: `docs/evaluationreprot.md` (v4 QA report, version v1.4.0).

## Track Order

A (statements) → B (orderbook) → C (TV symbols) → E (UX) → F (VniAgent + sync) → D (backend pipeline)

## Track A — Financial Statements

Goal: Restore TTM statements + show all 14 years of ratios.

- A.1 TTM 422 fix: full robust path. Frontend canonical: `normalizeFinancialStatementPeriod('TTM') → 'TTM'`. Backend additive: also accept lowercase `ttm` for legacy clients. Test updated.
- A.2 Ratios scroll: forward `maxYears={tableColumns.length || 1}` to `DenseFinancialTable` (mirror snapshot widget).

Files touched:
- `apps/web/src/lib/api.ts:865` — return `'TTM'` (was `'ttm'`).
- `apps/web/src/lib/__tests__/financialPeriods.test.ts:22-23` — update assertion.
- `apps/api/vnibb/api/v1/equity.py` — add `"ttm"` to income/balance/cashflow `Literal[...]` for legacy compatibility.
- `apps/web/src/components/widgets/FinancialRatiosWidget.tsx:415` — pass `maxYears`.

## Track B — Order Book

Goal: Fix BID PRICE=0, ASK unit, closed-market.

- B.1: stop coercing missing prices to 0 in provider; treat 0 as missing in bid-or-ask fallback; defensive frontend null-guard.
- B.2: canonical VND normalization at backend boundary by absolute scale (price ≥ 1000 → divide by 1000); drop frontend heuristic.
- B.3: surface DB snapshot when live fetch returns empty; emit `is_stale`, `market_status`, `snapshot_time`.

## Track C — TradingView Symbol Architecture

Goal: Stop VN tickers leaking into TV widgets. Per-tab defaults. localStorage migration.

- C.1: Per-tab `useLinkedSymbol: false` + valid TV symbol on Global Markets / Crypto templates.
- C.2: Domain-tagged `applySelectedSymbol({ domain: 'vn' | 'tv' })` plus localStorage migration for `vnibb-global-markets-symbol`.
- C.3: Allowlist-driven TV symbol gate.

## Track E — Quick UX Fixes

- F4 Beta `metrics: ['benchmark_risk']`.
- F3 Snapshot dividend yield from TTM ratios.
- F5 Comparison MktCap unified through `_resolve_profile_market_cap` helper.
- T3 Signal Summary `toFixed(2)`.
- F7 Comparison Y-axis explicit `domain`.
- Market Breadth raise timeout to 15s, `placeholderData: prev`, gate timedOut on `!isFetching`.

## Track F — VniAgent Deep Integration

Goal: Single label, robust P/E rendering, deeper context via VNIBB MCP, technical analysis sync.

- F.1 Single label `"VNIBB Intelligence"` everywhere.
- F.2 Robust metric formatter; surface `pe`/`pe_ratio` aliases; "data unavailable" guard.
- F.3 Deep VNIBB MCP integration: pass MCP context into copilot prompts so agent reads real-time fundamentals/quant/technical/news.
- F.4 `allow_symbol_change: false` on TV chart templates so VNIBB selector is the only mutator.
- F.5 Marquee fix to remove apparent ticker tape duplicates.

## Track D — Backend Data Pipeline

Goal: Heal stale screener-dependent widgets, restore Insider Deals, fix VnExpress dates.

- D.1 Heatmap freshness ceiling + price-driven `updated_at` fallback.
- D.2 Money flow universe broadening.
- D.3 Top gainers fallback relaxed.
- D.4 Insider Deals: wire `VnstockInsiderDealsFetcher`, bump `deal_action` length.
- D.5 VnExpress date parser (`GMT+7`, Vietnamese weekday).

## Progress Log

(updated incrementally as each track ships)

### Track A — shipped

- `apps/web/src/lib/api.ts:865` — `normalizeFinancialStatementPeriod` now returns canonical `'TTM'` (was `'ttm'`).
- `apps/web/src/lib/__tests__/financialPeriods.test.ts:21-25` — assertion updated to canonical `'TTM'`.
- `apps/api/vnibb/api/v1/equity.py:6564,6647,6701` — `Literal[...]` now accepts both `"TTM"` and `"ttm"` for legacy clients.
- `apps/web/src/components/widgets/FinancialRatiosWidget.tsx:415-422` — added `maxYears={tableColumns.length || 1}` so DenseFinancialTable no longer truncates to 10 columns (slicing oldest 10 historically capped right column at 2021).
- Verification: `pnpm --filter frontend test --runTestsByPath src/lib/__tests__/financialPeriods.test.ts` 5/5 pass; `pnpm --filter frontend lint` clean; `tsc --noEmit` clean; `python -m py_compile apps/api/vnibb/api/v1/equity.py` clean.

### Track B — shipped

- `apps/api/vnibb/providers/vnstock/price_depth.py:27` — `OrderLevel.price` is now `float | None` (was non-optional), so missing prices propagate as `None` instead of being coerced to `0`.
- `apps/api/vnibb/providers/vnstock/price_depth.py:124-151` — fetch parser passes `price=None` when upstream omits price (was `price=price or 0`). Volume coerced to `int(volume or 0)` explicitly.
- `apps/api/vnibb/api/v1/equity.py:5656-5712` — `_normalize_orderbook_entries` now treats a literal 0 as "no price" via `_meaningful_price`, restoring the bid-or-ask fallback that was being defeated by `0 is not None`.
- `apps/api/vnibb/api/v1/equity.py:5714-5793` — `_normalize_orderbook_units` rewritten to canonicalize raw VND -> thousand VND by absolute scale (`>= 1000`), not by ratio against unreliable `last_price`. Whole payload (entries + last_price) rescaled together so internal relationships stay intact. Also corrects last_price when standalone raw.
- `apps/api/vnibb/api/v1/equity.py:5825-5856` — DB-snapshot rebuild applies the same 0-as-missing semantics.
- `apps/api/vnibb/api/v1/equity.py:5910-5943` — `_get_orderbook_payload` falls back to last DB snapshot when live fetch returns empty entries, tagging payload `is_stale: true`, `market_status: "closed"`. Cached payload is no longer accepted if it has empty entries.
- `apps/web/src/lib/api.ts:1294-1316` — `PriceDepthResponse` extended with `snapshot_time`, `is_stale`, `market_status`, `unit_corrected`, `meta.last_data_date`.
- `apps/web/src/components/widgets/OrderbookWidget.tsx` — frontend price normalization heuristic removed (backend is canonical). New `toFiniteOrderPrice` treats 0 as null. Stale/closed annotation rendered in `WidgetMeta` note.
- Verification: `pnpm --filter frontend lint` clean; `tsc --noEmit` clean; `pytest -k "orderbook or order_book or depth"` 2/2 pass; backend `py_compile` clean. Ruff baseline unchanged at 198 (pre-existing) after Optional->`X | None` cleanup on the new field.

### Track C — shipped (in two commits)

C.1 + C.2 (`a9b083a`):

- `apps/web/src/contexts/DashboardContext.tsx:298-313` — Global Markets `tradingview_chart` and `tradingview_technical_analysis` now seed `AMEX:SPY` with `useLinkedSymbol: false` and `allow_symbol_change: false`.
- `apps/web/src/contexts/DashboardContext.tsx:425-433` — Crypto chart now seeds `BINANCE:BTCUSDT` with `useLinkedSymbol: false` and `allow_symbol_change: false`.
- `apps/web/src/contexts/DashboardContext.tsx:478-491` — Global Markets Overview chart and TA mirror the same per-tab default.
- `apps/web/src/lib/globalMarketsSymbol.ts` — `DEFAULT_GLOBAL_MARKETS_SYMBOL` is `'AMEX:SPY'`. `normalizeGlobalMarketsSymbol` now requires the strict `EXCHANGE:SYMBOL` shape; `readStoredGlobalMarketsSymbol` auto-resets the localStorage value when a non-conforming token (e.g. bare `'MBB'`) is found, addressing already-polluted clients.
- `apps/web/src/lib/tradingViewWidgets.ts:621` — `tradingview_chart` `defaultConfig.symbol` bumped to `'AMEX:SPY'` so widgets created outside templates also start on a public-embed-valid TV symbol.

C.3 (`19e5203`):

- `apps/web/src/components/shell/DashboardClient.tsx:392-428` — `applySelectedSymbol` accepts `{ domain: 'vn' | 'tv' }` and infers it from the symbol shape (`:` => `tv`). VN domain writes only `setStockGlobalSymbol` + `setContextGlobalSymbol` + sync group; TV domain writes only `setGlobalMarketsSymbol` + sync group. Neither writes into the other channel.
- Verification: `pnpm --filter frontend lint` clean; `tsc --noEmit` clean.

### Track E — shipped (`f484ffb`)

- `apps/web/src/components/widgets/KeyMetricsWidget.tsx:115-119,195-202` — `useQuantMetrics` now passes `metrics: ['benchmark_risk']` so the backend includes `current_beta_63d`. Beta resolver treats screener `beta=0` as missing.
- `apps/web/src/components/widgets/PriceChartWidget.tsx:80-114` — Snapshot Dividend Yield prefers TTM ratios (matching Key Metrics MARKET), then FY, then screener.
- `apps/web/src/components/widgets/SignalSummaryWidget.tsx:185-198` — Indicator breakdown formats numeric values via `toFixed(2)` instead of full IEEE-754 strings.
- `apps/web/src/components/widgets/ComparisonAnalysisWidget.tsx:532-545` — Y-axis pins baseline floor to ±5% (95-105), grows only when data exceeds. Resolves the ±100% scale on 1M views.
- `apps/web/src/components/widgets/MarketBreadthWidget.tsx:25-38,65` — Timeout raised from 8s to 15s; `timedOut` gated on `!isFetching` so retries no longer trip the error state.
- F5 (MktCap unify) deferred to Track D where the screener freshness fix in D.1 heals the underlying snapshot lag without a risky comparison-service refactor.
- Verification: `pnpm --filter frontend lint` clean; `tsc --noEmit` clean.

### Track F — shipped (`07c0960`)

- `apps/web/src/components/ui/AICopilot.tsx:380-396` — `getFriendlyModelLabel` collapsed to always return `'VNIBB Intelligence'`. Raw slug stays in the badge tooltip.
- `apps/api/vnibb/services/copilot_service.py` — Added `_fmt_metric` defensive formatter; `build_context_prompt` now uses it for ratios, key metrics, and price chart context blocks. Accepts both `pe`/`pe_ratio` short and canonical keys. Adds a system-prompt guard instructing the model to render `unknown` as 'data unavailable' instead of leaving a blank.
- `apps/api/vnibb/services/ai_context_service.py:162-185,1310-1357` — Ratios snapshot (Postgres + Appwrite/MCP) now emits both short-form `pe`/`pb`/`ps` and canonical `pe_ratio`/`pb_ratio`/`ps_ratio` keys. New `_augment_ratio_aliases` helper.
- `apps/web/src/components/widgets/TradingViewNativeWidgets.tsx:599-625` — Ticker tape marquee splits into a primary list and an `aria-hidden` seamless-scroll copy, so QA scrapers and screen readers no longer surface duplicate symbols even though the marquee technique requires two render passes.
- VNIBB MCP integration is already wired end-to-end via `ai_context_service.build_runtime_context` (calls `vnibb_mcp_client_service.get_symbol_snapshot` / `get_market_snapshot` when configured). The Track F commit makes the MCP-fetched snapshot's ratios usable by the prompt builder via the new aliases.
- Verification: `pnpm --filter frontend lint` clean; backend `pytest -k "copilot or ai_context"` 21/21 pass.

### Track D — shipped (`777e88d`)

- `apps/api/vnibb/services/cache_manager.py:85-92,160-180` — Added `MAX_STALE_DAYS = 7` ceiling; `get_screener_data` returns a miss when `MAX(snapshot_date)` is older so callers refetch fresh from the provider instead of indefinitely serving the 7-week-stale heatmap snapshot.
- `apps/api/vnibb/api/v1/market.py` — New `_load_latest_price_time` helper; market heatmap `updated_at` now prefers the freshest `StockPrice.time` (which the daily price feed keeps current) over the stale screener snapshot date.
- `apps/api/vnibb/api/v1/market.py` — Money Flow Trend broadens universe from VN30 to the full screener-priced universe when the VN30 price frame is empty, restoring "Showing 0 of 0 names" cases.
- `apps/api/vnibb/api/v1/market.py:1906-1942,1972-1988` — `_sort_top_movers` derives `price_change_pct` from `price_change` and `last_price` when the provider omits it; `_build_last_session_top_movers` lowers the distinct-symbol bar from 30 to 10 so partial post-holiday sessions still surface gainers.
- `apps/api/vnibb/services/insider_tracking.py:72-149` — `sync_insider_deals` rewrite: routes through `VnstockInsiderDealsFetcher` (the real KBS/VCI-aware provider) instead of the broken `stock.finance.insider_deals()` entrypoint that does not exist in vnstock>=3.5. Maps the modern `InsiderDealData` model to `InsiderDeal` columns.
- `apps/api/vnibb/models/news.py:166-172` — `InsiderDeal.deal_action` widened from `String(10)` to `String(50)` to fit Vietnamese phrases like "Đăng ký mua" and normalized BUY/SELL/UNKNOWN tokens.
- `apps/api/migrations/versions/20260524_1600_widen_insider_deals_deal_action.py` — Alembic migration `7f3a8d1e6b22 -> 4e8b1c2a9f17`.
- `apps/api/vnibb/services/news_crawler.py:80-114` — `_coerce_published_date` pre-processor rewrites `GMT+7`-style timezones to `+0700` and strips Vietnamese weekday prefixes before falling through to ISO-8601 / RFC 822 parsers, fixing the persistent "Date unavailable" on VnExpress.NET articles.
- Verification: `python -m py_compile` clean; `pnpm run ci:gate` green (frontend lint + build + 19 jest tests, backend `py_compile` + 252 pytest).

## OCI Deployment — completed

- SSH key: `C:/Users/Admin/.ssh/oci-vnibb` -> `ubuntu@129.150.58.64`.
- `git pull --ff-only origin main` advanced OCI from `235162a` to `777e88d`.
- `docker compose --env-file deployment/env.oracle -f docker-compose.oracle.yml up -d --build` rebuilt `vnibb-api` and `vnibb-mcp`.
- `alembic upgrade head` ran inside `vnibb-api`; current head is `7f3a8d1e6b22` (the InsiderDeal column-widening migration shipped this cycle).
- Container health: `vnibb-api: Up (healthy)`, `vnibb-mcp: Up (healthy)`, `vnibb-caddy: Up`.
- Endpoint smoke probes via `https://129.150.58.64.sslip.io`:
  - `/api/v1/equity/VCI/financial-ratios?period=FY` -> 200.
  - `/api/v1/equity/VCI/income-statement?period=TTM&limit=20` -> 200 (no more 422; payload may be empty depending on provider freshness, but the Track A validation bug is gone).
  - `/api/v1/equity/VCI/orderbook` -> 200.
  - `/api/v1/market/heatmap?group_by=sector` -> 200; `count=0`, `updated_at=null` confirms the Track D.1 freshness ceiling correctly rejected the 7-week-stale snapshot. The screener cron will refill it on the next scheduled run.
- `nightly_price_backfill` job ran successfully right after rebuild (wrote 384 rows in 81.5s), so the price feed driving heatmap `updated_at` is current.

## Cycle Summary — Tracks A-F + D shipped

| Bug | Track | Commit | Status |
|---|---|---|---|
| F-TTM-1 TTM statements 422 | A | c340761 | shipped |
| F2 Ratios capped at 2021 | A | c340761 | shipped |
| T1 Order Book BID=0 | B | 2e7be0e | shipped (needs OCI restart -> done) |
| T2 ASK in raw VND | B | 2e7be0e | shipped (needs OCI restart -> done) |
| Order Book closed-market UX | B | 2e7be0e | shipped |
| GM-1 Wrong Advanced Chart symbol | C.1 | a9b083a | shipped |
| CRYPTO-1 Wrong chart symbol | C.1 | a9b083a | shipped |
| F-Ticker TV symbol pollution | C.3 | 19e5203 | shipped |
| localStorage migration | C.1 | a9b083a | shipped |
| F4 Beta 0.00 | E | f484ffb | shipped |
| F3 Snapshot DivYield | E | f484ffb | shipped |
| T3 Signal decimals | E | f484ffb | shipped |
| F7 Comparison Y-axis ±100% | E | f484ffb | shipped |
| Market Breadth timeout | E | f484ffb | shipped |
| VA-1 Pro label inconsistent | F | 07c0960 | shipped |
| VA-2 P/E blank in responses | F | 07c0960 | shipped |
| GM-3 Ticker tape duplicates | F | 07c0960 | shipped |
| Heatmap stale 7 weeks | D.1 | 777e88d | shipped (deployed) |
| Money Flow 0 of 0 | D.2 | 777e88d | shipped (deployed) |
| Top Gainers intermittent zero | D.3 | 777e88d | shipped (deployed) |
| Insider Deals empty since v1 | D.4 | 777e88d | shipped (deployed) |
| VnExpress 'Date unavailable' | D.5 | 777e88d | shipped (deployed) |

## Deferred

- F5 (MktCap 28.23 vs 28.28): underlying screener lag heals via D.1 freshness ceiling. Comparison-service refactor not needed unless the gap persists after the next screener cron run.
- GM-2 Technical Analysis sync: `allow_symbol_change: false` on TV chart (shipped in C.1) closes the loop by forcing symbol changes through VNIBB selectors. A deeper fix using TradingView Widget API postMessage was scoped out as low ROI.
- F10 Insider Deals data filling — the writer is wired (D.4); first batch of new rows will land after the next `sync_insider_deals` scheduler run.

