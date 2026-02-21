# V45 Partial Widget Triage

Date: 2026-02-15

## Scope

- Target set: 14 historically partial widgets from V42.
- Target symbols for deep QA: VNM, FPT, VCB, HPG, VIC.
- This file records triage status and fix direction for current sprint execution.

## Triage Matrix (Current)

| Widget | Current State | Primary Risk | Action Path |
|---|---|---|---|
| Company Filings | Improved | Provider sparsity by symbol | Keep fallback + improve empty-state clarity |
| Share Statistics | Improved | Sparse fields for smaller caps | Normalize null handling + fallback labels |
| Peer Comparison | Partial | Peer density variance | Strengthen peer fallback and symbol suggestions |
| Foreign Trading | Improved | Upstream coverage gaps | Backfill + freshness alerting |
| Sector Breakdown | Improved | Market-cap completeness | Validate aggregation against latest snapshot |
| Watchlist | Improved | Data freshness drift | Ensure quote refresh policy consistency |
| Portfolio Tracker | Partial | Edge-case math/input handling | Add edge-case QA and input guards |
| Price Alerts | Partial | UX consistency | Final pass on create/edit/delete states |
| Technical Summary | Partial | Data parity vs source | Verify indicator mapping across symbols |
| Technical Snapshot | Partial | Data parity vs source | Verify fallback behavior on sparse data |
| World Indices | Improved | External feed availability | Add clearer stale/external status |
| Quick Stats | Partial | Mixed data source consistency | Align formatting + null strategy |
| Similar Stocks | Partial | Peer resolution quality | Improve similarity fallback logic |
| Ownership Changes | Improved | Symbol-level sparsity | Continue backfill and highlight data age |

## Key Work Completed During This Pass

- Added admin auto-backfill endpoint: `/api/v1/admin/data-health/auto-backfill` (dry-run + trigger).
- Added frontend Health tab controls in `DatabaseBrowserWidget` for stale-table insight and backfill action.
- Continued token migration in high-impact partial widgets (filings, share stats, foreign trading, watchlist, ownership changes, sector breakdown).
- Improved widget runtime behavior with lazy render + dynamic imports for heavy components.

## Current Gate Evidence

- Backend tests: `cd apps/api && python -m pytest tests -q` -> 57 passed
- Frontend typecheck/lint/build: pass

## Latest Continuation Evidence (2026-02-15)

- Root cause for TA 500s identified in service initialization: `TechnicalAnalysisService._check_vnstock_ta` only caught `ImportError` and crashed on `AttributeError` from `vnstock_ta` dependency chain (`psutil.Process`).
- Fix applied in `apps/api/vnibb/services/technical_analysis.py`: broadened exception handling to graceful fallback mode (`vnstock_ta` disabled, pandas/vnstock path enabled).
- Direct service validation after fix (`VNM,FPT,VCB,HPG,VIC`) now returns complete full-analysis payloads with signals for all 5 symbols.
- Backend regression gate rerun after fix: `cd apps/api && python -m pytest tests -q` -> 57 passed.
- Runtime note: existing long-running backend on `:8010` still returns old TA 500 behavior, indicating stale process/runtime mismatch, not current code failure.
- Heatmap fallback logic improved in `apps/api/vnibb/api/v1/market.py`: local direct check now returns non-empty data (`count=86`, `sectors=1`), but sector labeling still collapses to `Other` due sparse industry metadata.

## Latest Continuation Evidence (2026-02-16)

- Widget data-linking pass implemented with explicit fallback chains + source labeling:
  - `apps/web/src/components/widgets/TickerInfoWidget.tsx`
  - `apps/web/src/components/widgets/ShareStatisticsWidget.tsx`
  - `apps/web/src/components/widgets/KeyMetricsWidget.tsx`
  - `apps/web/src/components/widgets/FinancialsWidget.tsx`
  - `apps/web/src/components/widgets/IncomeStatementWidget.tsx`
  - `apps/web/src/components/widgets/BalanceSheetWidget.tsx`
  - `apps/web/src/components/widgets/CashFlowWidget.tsx`
- Key improvements delivered:
  - market-cap fallback derivation from profile shares x quote when screener market cap is missing,
  - per-metric provenance labels (`Screener`, `Ratios`, `Profile+Quote`, `Quote`),
  - clearer empty states/actions and sparse-data hints,
  - metadata chips (exchange/industry) and fallback badges for partial-data symbols.
- Frontend gates re-run after these edits:
  - `cd apps/web && pnpm exec tsc --noEmit` -> pass
  - `cd apps/web && pnpm lint` -> pass
  - `cd apps/web && pnpm build` -> pass

## Latest Continuation Evidence (2026-02-21)

- Hardened listing provider failure handling in `apps/api/vnibb/providers/vnstock/listing.py`:
  - switched from `except Exception` to `except BaseException` inside vnstock executor wrappers,
  - re-raised as `ProviderError(... ) from e` so upstream API returns controlled 502 instead of process-killing `SystemExit` paths.
- Hardened matrix runner in `apps/api/scripts/v45_widget_matrix_14x5.py`:
  - added Windows-safe stdout encoding guard (`sys.stdout.reconfigure(..., errors="replace")`),
  - added configurable `--timeout` for reproducible matrix runs under degraded infra.
- Tuned world-index endpoint fail-fast behavior in `apps/api/vnibb/api/v1/market.py`:
  - introduced tighter per-symbol and fallback timeouts for `/api/v1/market/world-indices`,
  - reduced local response latency from ~17.9s to ~7.5s while preserving fallback semantics.
- Evidence runs completed after hardening:
  - Production matrix (`v45_widget_matrix_14x5_prod_after_guardrails.json`, timeout=4s): `works=0, partial=0, broken=14` (still dominated by 502/timeouts, consistent with deploy health issue).
  - Local matrix (`v45_widget_matrix_14x5_local8012_after_guardrails.json`, timeout=4s): `works=6, partial=2, broken=6`.
  - Local matrix (`v45_widget_matrix_14x5_local8012_timeout10.json`, timeout=10s): `works=10, partial=3, broken=1`.
  - Local matrix after world-index tuning (`v45_widget_matrix_14x5_local8012_timeout10_after_world_indices_fix.json`, timeout=10s): `works=12, partial=2, broken=0`.
- Backend regression gate rerun after hardening: `cd apps/api && python -m pytest tests -q` -> 57 passed.
- Remaining local non-works after latest timeout=10 run:
  - `Sector Breakdown` partial (all 5 symbols empty: no sectors in payload),
  - `Quick Stats` partial (2/5 symbol calls failed in this run).
- Conclusion: widget-linking changes are strongly validated locally (`12/14 works`); deployment readiness is now primarily blocked by production runtime instability and two residual data-quality/availability paths.

## Remaining Closure Work

1. Stabilize `Quick Stats` intermittent historical/screener failures (likely provider/rate-limit sensitivity) and rerun 14x5 local matrix at timeout=10.
2. Resolve sector-label richness in heatmap payload (`industry/sector` population quality) before promoting `Sector Breakdown` to `Works`.
3. Reclassify each widget in `docs/v42_widget_audit_matrix.md` using timeout=10 local evidence + production health context.
4. Re-run production matrix once endpoint health recovers and capture deployment-ready evidence.
