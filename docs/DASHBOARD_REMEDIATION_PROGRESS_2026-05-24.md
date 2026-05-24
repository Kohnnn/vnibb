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

