# Quant Remaining Work — Shipping Plan & Handoff

Date: 2026-06-10
Status: Waves 1-4 SHIPPED (see "Shipped status" below). Wave 5 remains parked.
Prereq reading: `docs/QUANT_FIX_PASS_AND_NEW_WIDGETS_2026-06-10.md`, `docs/reverse-engineering/turtle-hub-crawl-2026-06-09/quant-tabs-deep-dive.md`

This documents how to ship every item deferred from the 2026-06-10 quant pass. Items are ordered
by dependency and risk. Waves 1-2 are frontend-only; Wave 3 introduces the first backend quant
additions since the metric registry; Wave 4 is infrastructure.

---

## Shipped status (2026-06-10)

| Wave | Commit | Notes |
| --- | --- | --- |
| 1 — Market Lab depth | `6e9562e` | VR(2/5/10) + robust z, squared-return ACF, rolling 21D vol strip in `marketLabStats.ts` + `MarketLabWidget.tsx`; tests `marketLabStructure.test.ts`. |
| 2 — Run history + pinning | `fa3f2ac` | `quantRunHistory.ts` store + shared `QuantRunHistoryPanel.tsx` wired into Edge Half-Life, Pair Lab, Monte Carlo, Signal Robustness; tests `quantRunHistory.test.ts`. |
| 3 backend — structure tests + pair endpoint | `2611f62` | `market_structure_tests` metric (VR, ACF, R/S Hurst) + `GET /quant/{symbol}/pair/{other}` (OLS hedge ratio, approx Engle-Granger ADF, AR(1) half-life); 9 new pytests. **Requires OCI deploy to reach production.** |
| 3 frontend — backend Hurst + OLS pair mode | `321bbdf` | `usePairDiagnostics`/`useMarketStructureTests` (tolerate 404 via `not_deployed` sentinel), OLS toggle in Pair Lab, `useQuantRegime` prefers backend Hurst. Ships safely ahead of the OCI deploy. |
| 4 — Signal Robustness v2 | `d944874` | `signalRobustness.ts` (contiguous-fold sign agreement + 200-iter permutation null), wired into the lab + run history; tests `signalRobustness.test.ts`. |

**ACTION REQUIRED:** The Wave 3 backend (`market_structure_tests` + pair endpoint) only reaches
production via the OCI deploy path (`docs/oracle_runbook.md`), not Vercel. Until that deploy runs,
the frontend treats the new endpoints as `not_deployed` (empty state, no error). Run the OCI deploy
to light them up.

Note: `_get_quant_metric_alias_response` has a pre-existing latent bug (references `start_date`/
`end_date` before assignment in the `benchmark_risk` branch) — unrelated to this work, only triggers
on the benchmark-risk *alias* endpoint. Left untouched; fix separately.

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

Each item below is parked but now fully specced so a future AI can scope and estimate before asking
for the green light. Read "Codebase conventions for a future AI" (below) first — it captures the
registration points, helpers, and gotchas this session learned the hard way.

### 5.1 Full GARCH(1,1) volatility fitting
- **Why parked:** needs a Python dependency decision (`arch` or hand-rolled MLE) + numeric review.
  scipy is NOT a dependency (verified `apps/api/pyproject.toml`); do not add it just for this.
- **Where:** backend metric, follows `_compute_parkinson_volatility` exactly.
  - Add `garch_volatility` to `SUPPORTED_METRICS` + `METRIC_ALIASES` + `_get_quant_calculators`
    in `apps/api/vnibb/api/v1/quant.py`, plus a `GET /quant/{symbol}/garch-volatility` alias
    (declare it BEFORE the catch-all `@router.get("/{symbol}")`).
  - `_compute_garch_volatility(frame) -> dict`: fit GARCH(1,1) on daily % returns. If you avoid the
    `arch` dependency, implement a constrained MLE with numpy (maximize the Gaussian log-likelihood
    over omega>0, alpha>=0, beta>=0, alpha+beta<1 via a bounded grid + local refine — no scipy).
    Return: `omega`, `alpha`, `beta`, `persistence` (=alpha+beta), `current_conditional_vol_pct`
    (annualized), `long_run_vol_pct`, and a `series` of conditional vol (tail 400). `_safe_float`
    everything; return Nones + the standard insufficient-data path when `len(frame) < 250`.
  - **Honesty rule:** label it "in-sample conditional volatility estimate, not a forecast path."
    The existing client-side squared-return ACF (Wave 1) stays as the lightweight clustering read.
- **Frontend:** new widget `garch_volatility` (4 registration points — see conventions). Surface
  persistence prominently (near 1 = long memory). Use `QuantWarningBanner` + `extractQuantWarning`.
- **Tests:** synthetic GARCH series (the fixture in `marketLabStructure.test.ts` /
  `quant_endpoint_test.py` already generates one) should recover alpha+beta within a tolerance band;
  iid series should fit alpha≈0. Assert persistence < 1.
- **Decision needed from user:** add `arch` to `pyproject.toml` (simpler, heavier) vs hand-rolled MLE
  (no dep, more code + review). Ask before starting.

### 5.2 Backend parameter-sweep endpoints
- **Why parked:** server cost + needs a job-queue/budget design. The Bollinger threshold sweep (E,
  shipped 2026-06-10) and Signal Robustness folds (Wave 4) are the client-side substitutes; only
  build this if a sweep genuinely needs server compute over full history.
- **Spec when approved:** `POST /quant/{symbol}/sweep` taking a metric + a small bounded grid
  (reject grids > N points server-side). Reuse `_load_quant_frame_with_warning`. Must be rate-limited
  and cached (`@cached(ttl=...)`) — see the `get_quant_metrics` caching decorator. Return a result
  matrix, not per-cell series. Needs a budget guard so one symbol can't fan out unbounded compute.
- **Prereq design doc:** job-queue/budget model. Do not inline long compute in a request handler.

### 5.3 Replay / paper-trade journal
- **Why parked:** product scope beyond quant; needs its own design + likely durable storage.
- **Spec sketch:** browser-local first (mirror `quantRunHistory.ts` / `researchNotebook.ts`): a
  `paperTrades.ts` store of hypothetical entries/exits with provenance, then a journal widget. Keep
  it descriptive ("recorded hypothetical", never "executed"). Durable/multi-device sharing needs a
  backend table + the Appwrite-primary write bridge (`docs/APPWRITE_PRIMARY_SUPABASE_WRITE_BRIDGE.md`)
  — Appwrite writes are frozen by default (`APPWRITE_WRITE_ENABLED=false`), so coordinate that first.

### 5.4 Portfolio optimization lab
- **Why parked:** optimizer constraints need validation; separate spec.
- **Spec sketch:** start client-side with a long-only mean-variance frontier over a small basket
  (reuse `useHistoricalPrices` per symbol, align on dates like `computePairStats`). numpy-free TS:
  closed-form for 2-asset; for N-asset use a simple projected-gradient or analytic with a covariance
  matrix built in TS. **Honesty rule:** "historical-covariance frontier, not an allocation
  recommendation." No leverage, no shorting in v1. A backend optimizer is a later, separate wave.

### 5.5 Strategy code editor / backtest IDE
- **Why parked:** explicitly deferred by the reverse-engineering doc guidance. Largest scope + a
  real security surface (arbitrary user code execution). Do NOT attempt a client eval of user code.
  If ever built, it needs a sandboxed execution design reviewed for security first — out of scope
  for an incremental quant wave.

---

## Codebase conventions for a future AI (learned this session)

- **Shell:** repo uses a `rtk` wrapper for git/pnpm/pytest. Patterns that worked:
  `rtk git -C vnibb <cmd>`, `rtk pnpm run ci:gate` (with `workdir=vnibb`),
  `rtk pytest apps/api/tests/... ` (with `workdir=vnibb`). `git stash` through `-C vnibb` was flaky;
  prefer `git show HEAD:path` to inspect the committed version of a file.
- **Frontend math lives in `apps/web/src/lib/*.ts`** with a sibling Jest test in
  `apps/web/src/lib/__tests__/*.test.ts`. jsdom provides `localStorage`. Seed all randomness with the
  exported `makeRng` from `quantLabMath.ts` (LCG) for reproducible tests.
- **Variance-ratio z-stat gotcha (already fixed, don't reintroduce):** the canonical Lo-MacKinlay z
  is `sqrt(N)·(VR−1)/sqrt(theta)` where `delta(j) = N·Σ d_t² d_{t−j}² / (Σ d_t²)²`. The `N` factor
  must appear in BOTH the numerator (`sqrt(N)`) and inside `delta`; dropping one deflates/inflates z
  by a factor of N. See `computeVarianceRatio` in `marketLabStats.ts` and `_variance_ratio` in
  `quant.py` — keep the two in sync.
- **New backend `/quant` metric =** edit 4 spots in `apps/api/vnibb/api/v1/quant.py`:
  `SUPPORTED_METRICS`, `METRIC_ALIASES`, `_get_quant_calculators`, and a `@router.get` alias declared
  BEFORE the catch-all `@router.get("/{symbol}")`. FastAPI matches by segment count, so a 3-segment
  route like `/{symbol}/pair/{other}` is safe next to `/{symbol}`. Always `_safe_float` outputs and
  return the insufficient-data payload (Nones) below the min-rows threshold.
- **No scipy.** For a normal CDF use `math.erfc`/`math.erf` (see `_normal_sf` in `quant.py`).
- **New widget ID =** 4 registration points: `types/dashboard.ts` (`WidgetType`),
  `WidgetRegistry.ts` (import + component + name + description), `lib/dashboardLayout.ts`,
  `data/widgetDefinitions.ts`. Waves 1-4 only modified existing widgets; 5.1 would add a new ID.
- **Frontend must tolerate a not-yet-deployed backend.** New endpoints return 404 until the OCI
  deploy runs. Pattern: catch `APIError` with `status === 404 || 405` in the query fn and return a
  sentinel (`null` or `{ status: 'not_deployed' }`), render an empty state, NOT an error. See
  `usePairDiagnostics` / `useMarketStructureTests` in `apps/web/src/lib/queries.ts`.
- **Run history:** reuse `quantRunHistory.ts` + the shared `QuantRunHistoryPanel.tsx`. Store
  summaries only, never full series. Budget is 50 runs, prune oldest unpinned first.

---

## Known follow-ups / tech debt (not blocking, fix when convenient)

- **`_get_quant_metric_alias_response` latent bug** (`apps/api/vnibb/api/v1/quant.py`, ~lines
  922-933): the `benchmark_risk` branch references `start_date`/`end_date` before they're assigned
  (assignment happens ~10 lines later). ruff flags F821. Only triggers if someone calls the
  `benchmark-risk` *alias* endpoint (the main `/{symbol}?metrics=benchmark_risk` path is fine). Move
  the `period_upper`/`end_date`/`start_date` assignment above the benchmark block to fix. Pre-existing,
  unrelated to Waves 1-4.
- **ruff `Dict`→`dict` style nits across `quant.py`** (~95 UP006). Pre-existing whole-file style; the
  backend gate is `py_compile` + pytest (per `AGENTS.md`), not ruff, so this is cosmetic. Don't mass-
  rewrite in a feature commit — do it as a dedicated chore if desired.
- **`quantLabMath.ts` has no direct unit test file yet.** Its functions are exercised indirectly via
  the widgets and `marketLabStructure.test.ts` only covers the marketLab functions. Consider adding
  `apps/web/src/lib/__tests__/quantLabMath.test.ts` (rolling Sharpe peak/decay, pair half-life,
  drawdown bootstrap percentile ordering) if touching that file.

---

## Suggested commit sequence (Waves 1-4 — all SHIPPED, see "Shipped status")

1. `feat(market-lab): variance ratio, vol clustering, rolling vol regime` (Wave 1) — `6e9562e`
2. `feat(quant): run history + pinning for lab widgets` (Wave 2) — `fa3f2ac`
3. `feat(api/quant): market_structure_tests metric + pair diagnostics endpoint` (Wave 3 backend) — `2611f62`
4. `feat(quant): backend-powered structure tests + OLS pair mode` (Wave 3 frontend) — `321bbdf`
5. `feat(quant): signal robustness v2 — period folds + null benchmark` (Wave 4) — `d944874`

Each commit: ci:gate green first. **The Wave 3 backend (`2611f62`) still requires an OCI deploy**
(`docs/oracle_runbook.md`) to reach production — Vercel only deploys the frontend. The Wave 3
frontend (`321bbdf`) was intentionally written to ship safely ahead of that deploy (404 = empty
state, not error), so there is no ordering hazard, but the new metric/endpoint stay dark until the
OCI deploy runs.
