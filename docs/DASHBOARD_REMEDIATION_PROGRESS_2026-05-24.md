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

