# Quant Remaining Work — Shipping Plan & Handoff

Date: 2026-06-10
Status: planned, not started
Prereq reading: `docs/QUANT_FIX_PASS_AND_NEW_WIDGETS_2026-06-10.md`, `docs/reverse-engineering/turtle-hub-crawl-2026-06-09/quant-tabs-deep-dive.md`

This documents how to ship every item deferred from the 2026-06-10 quant pass. Items are ordered
by dependency and risk. Waves 1-2 are frontend-only; Wave 3 introduces the first backend quant
additions since the metric registry; Wave 4 is infrastructure.

---

## Ground rules (apply to every wave)

- Work from `vnibb/` (the monorepo root). Frontend is `apps/web`, alias `@/*` = `apps/web/src/*`.
- Everything stays **descriptive, not predictive**. Every statistical output gets one plain-language
  sentence in the panel explaining what it is and is not.
- No code copied from FinceptTerminal / Quantcept / TurtleHub. Patterns only.
- Frontend persistence is browser-local (`localStorage`) until durable sharing is justified.
- Every widget emits `__widgetRuntime` (layoutHint + provenance) via `onDataChange` — see
  `apps/web/src/components/widgets/MarketLabWidget.tsx` for the canonical pattern.
- Quant widgets surface backend warnings via `QuantWarningBanner` + `extractQuantWarning`
  (`apps/web/src/lib/quantWidgetHelpers.ts`). Forward-looking stats set `forwardLooking`.
- New widget IDs require **4 registration points** (all must be edited together):
  1. `apps/web/src/types/dashboard.ts` — `WidgetType` union
  2. `apps/web/src/components/widgets/WidgetRegistry.ts` — import + component map + name map + description map
  3. `apps/web/src/lib/dashboardLayout.ts` — layout hints entry
  4. `apps/web/src/data/widgetDefinitions.ts` — library entry (`category: 'quant'`, searchKeywords)
- Verification per wave: `pnpm run ci:gate` from `vnibb/` (frontend lint + tsc + build + jest
  `--runInBand`, backend py_compile + pytest). Commit per wave, push to `origin/main`.
- Shared client math goes in `apps/web/src/lib/quantLabMath.ts` (extend, don't fork). Add Jest
  tests for new math: `apps/web/src/lib/__tests__/quantLabMath.test.ts` (none exist yet — create).

---

## Wave 1 — Market Lab depth (frontend-only, ~1 session)

Extend `apps/web/src/lib/marketLabStats.ts` and `MarketLabWidget.tsx` with three market-structure
diagnostics from the TurtleHub Market Lab pattern.

### 1.1 Variance ratio test
- Function: `computeVarianceRatio(returns: number[], q: number): { vr: number; zScore: number } | null`
- Lo-MacKinlay variance ratio: `VR(q) = Var(r_q) / (q * Var(r_1))` on overlapping q-period log
  returns, with the heteroskedasticity-robust z-statistic.
- Compute for q = 2, 5, 10. Display: VR value per q + a one-line read:
  VR < 1 leans mean-reverting, VR > 1 leans trending, |z| < 1.96 = "indistinguishable from random walk".
- Guard: require >= 120 returns; return null below.

### 1.2 Volatility clustering
- Function: `computeSquaredReturnACF(returns: number[], maxLag: number): number[]`
- Autocorrelation of squared returns at lags 1-10. Display as a tiny bar row; read line:
  "high lag-1..5 ACF of squared returns = volatility clusters (calm/storm regimes)".
- This is the honest substitute for full GARCH; do NOT fit GARCH client-side.

### 1.3 Rolling volatility regime strip
- Reuse 21D rolling std (annualized) over time; render as a compact area chart in Market Lab
  with current-vs-median marker. (Parkinson regime exists per-symbol via `/quant`; this one is
  derived locally so Market Lab stays self-contained on `/equity/historical`.)

Layout: add a "Structure" section under the existing stats grid in MarketLabWidget. Keep the
existing `MarketLabStats` interface backward-compatible: add optional fields, never rename.

Tests: hand-computed fixtures for VR (e.g., perfect trend series VR>1, alternating series VR<1)
and ACF (iid noise ~0, GARCH-like series > 0).

---

## Wave 2 — Run history + pinning for quant labs (frontend-only, ~1 session)

TurtleHub pattern: "every expensive computation should become a reloadable artifact."

### 2.1 Shared run-history store
- New file: `apps/web/src/lib/quantRunHistory.ts`, modeled exactly on
  `apps/web/src/lib/researchNotebook.ts` (storage key versioning, SSR guard, JSON-parse safety).
- Types:
  ```ts
  interface QuantRun {
    id: string            // safeRandomId()
    widget: 'signal_robustness_lab' | 'monte_carlo_lab' | 'edge_half_life' | 'pair_lab'
    name: string          // auto: `${symbol} ${configSummary} ${date}`
    createdAt: string
    pinned: boolean
    config: Record<string, unknown>   // widget-specific knobs
    summary: Record<string, number | string | null>  // headline metrics only, NOT full series
  }
  ```
- API: `listRuns(widget?)`, `saveRun(run)`, `togglePin(id)`, `deleteRun(id)`, `clearUnpinned(widget)`.
- Budget: cap 50 runs; prune oldest unpinned first (mirror TurtleHub's pruning posture).
  Store summaries only — never store full equity/series arrays (storage blowup).

### 2.2 Wire into the four lab widgets
- Each lab gets a compact "Save run" button + a collapsible "History" list (name, date, pin icon,
  headline metric, click = re-apply config). Re-applying sets the widget's knobs (period, window,
  threshold, pair symbol) — the data refetches via React Query naturally.
- Compare-two-runs: v1 is a simple side-by-side of the two summary objects in a popover
  (key, run A value, run B value, delta). No diff of series.

### 2.3 Export
- "Export history" → CSV via the existing `exportWidget.ts` helpers, with `ExportProvenance`.

Tests: Jest for quantRunHistory (save/list/pin/prune/budget).

---

## Wave 3 — Backend statistical tests (`/quant` additions, ~1-2 sessions)

First backend wave. Two new metrics in the existing registry + one new endpoint. Python with
numpy/pandas only (scipy is NOT currently a dependency — check `apps/api/pyproject.toml`; if you
need normal CDF, implement via `math.erf`).

### 3.1 New `/quant/{symbol}` metric: `market_structure_tests`
- Add to `SUPPORTED_METRICS` + `METRIC_ALIASES` in `apps/api/vnibb/api/v1/quant.py`.
- `_compute_market_structure_tests(frame) -> dict`:
  - `variance_ratio`: VR(2), VR(5), VR(10) + robust z-scores (same formulas as Wave 1; backend
    version is authoritative, frontend version then becomes fallback-only or is removed).
  - `squared_return_acf`: lags 1-10.
  - `hurst_rs`: rescaled-range Hurst estimate (replaces the client-side one in
    `apps/web/src/lib/quantRegime.ts` — keep the client one until this ships, then switch
    `useQuantRegime` to prefer the backend value, client as fallback).
- Follow the exact pattern of `_compute_parkinson_volatility`: `_safe_float` everything,
  return base payload with `None`s when `len(frame) < 120`.
- Alias endpoint: `GET /quant/{symbol}/market-structure-tests` via `_get_quant_metric_alias_response`.
- Tests in `apps/api/tests/test_api/quant_endpoint_test.py`: fixture frames (trend, mean-revert,
  iid) with assertions on VR direction and ACF sign; insufficient-data path returns Nones + warning.

### 3.2 New `/quant/{symbol}` metric: `pair_diagnostics` (upgrade for Pair Lab)
- Query params piggyback on the main endpoint poorly (needs a second symbol), so make a dedicated
  endpoint instead: `GET /quant/{symbol}/pair/{other}` with `period`, `adjustment_mode`.
- Compute server-side: OLS hedge ratio (numpy lstsq), Engle-Granger step-2 ADF on residuals
  (implement ADF with fixed lag=1 and report the t-stat + a coarse verdict using the standard
  MacKinnon 5% critical value ≈ -3.34 for the cointegration case; label it "approximate"),
  spread half-life via AR(1), rolling correlation.
- Frontend: PairLabWidget gains a "Hedge-ratio mode" toggle — 1:1 (current, client) vs OLS
  (backend). Show ADF t-stat with the explicit caveat string from the backend.
- Tests: cointegrated synthetic pair (x, x+noise) should produce strongly negative ADF t-stat;
  independent random walks should not.

### 3.3 Deployment note
- Backend changes require the OCI deploy path (see `docs/DEPLOYMENT_AND_OPERATIONS.md` and
  `docs/oracle_runbook.md`) — not just Vercel. Coordinate: ship backend first, frontend tolerates
  missing metric (treat 4xx/missing as "backend not updated yet" empty state, NOT an error).

---

## Wave 4 — Signal Robustness Lab v2: CPCV-lite + null benchmark (~2 sessions)

The anti-overfit centerpiece. Extends `SignalRobustnessLabWidget.tsx`.

### 4.1 Period-fold robustness (CPCV-lite, client-side)
- Current lab tests one threshold across the universe over one window. v2 splits the lookback
  into K=4 contiguous folds and reports the signal's edge (pass-vs-universe forward return delta)
  per fold + the count of folds where the edge sign agrees.
- Output language: "edge positive in 3/4 periods" — no Sharpe distributions, no PBO claims.
  True CPCV/PBO needs a backtest engine; do not fake it. Name the panel "Period stability".

### 4.2 Null benchmark (shuffle test, client-side)
- For the chosen threshold, randomly relabel which symbols "pass" (same pass-count) 200 times;
  report where the real edge falls in the shuffled-edge distribution as a percentile.
  Language: "real edge beats N% of random symbol selections of the same size".
- Use the seeded LCG from `quantLabMath.ts` (`makeRng`) for reproducibility.
- This is a legitimate permutation test for cross-sectional selection and needs no backend.

### 4.3 Wire run history
- Save each robustness run (config + fold edges + null percentile) via Wave 2's store.

---

## Wave 5 — Optional/parked (do NOT start without explicit approval)

| Item | Why parked |
| --- | --- |
| Full GARCH fitting | Needs scipy/arch dependency decision + numeric review |
| Backend parameter-sweep endpoints | Server cost; needs job queue + budget design |
| Replay / paper-trade journal | Product scope beyond quant; needs its own design |
| Portfolio optimization lab | Optimizer constraints need validation; separate spec |
| Strategy code editor / backtest IDE | Explicitly deferred by reverse-engineering doc guidance |

---

## Suggested commit sequence

1. `feat(market-lab): variance ratio, vol clustering, rolling vol regime` (Wave 1)
2. `feat(quant): run history + pinning for lab widgets` (Wave 2)
3. `feat(api/quant): market_structure_tests metric + pair diagnostics endpoint` (Wave 3 backend)
4. `feat(quant): backend-powered structure tests + OLS pair mode` (Wave 3 frontend)
5. `feat(quant): signal robustness v2 — period folds + null benchmark` (Wave 4)

Each commit: ci:gate green first. Wave 3 backend commit additionally requires the backend pytest
suite green and an OCI deploy before merging the Wave 3 frontend commit.
