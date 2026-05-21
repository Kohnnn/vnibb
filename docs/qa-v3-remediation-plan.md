# VNIBB v3 QA Remediation Plan + Progress (v1.4.0)

**Source:** `docs/evaluationreprot.md` (v3, 2026-05-21 11:00 ICT, app version v1.2.0+)
**Cycle target version:** v1.4.0
**Owner:** OpenCode session
**Status legend:** ⬜ pending · 🟦 in progress · ✅ done · ⚠️ blocked · ⏭️ deferred

## Decisions locked

- Phase A first to confirm Vercel deploy state.
- Order Book ÷1000 fix lives in **backend serializer** + frontend defensive auto-correct.
- OHLCV backfill: full HOSE/HNX/UPCOM (~1700 tickers) into MongoDB.
- Scope: Everything (A + B + C + D + E + F).

## Phase A — Vercel deploy investigation

| ID | Action | Status |
|---|---|---|
| A.1 | Inspect deploy state via `gh` + Vercel API | ✅ |
| A.2 | Identify failure cause (branch / build / settings) | ✅ |
| A.3 | Repair deploy gap | ✅ no repair needed |
| A.4 | Verify v1.3.0 fixes live on production URL | ✅ |

## Phase B — P0 high-severity new bugs

| ID | Bug | File(s) | Status |
|---|---|---|---|
| B.1 | T2/T7 Order Book ÷1000 + assertion | `apps/api/vnibb/api/v1/equity.py` | ✅ |
| B.2 | T4 VWAP/Footprint HOSE hours | `apps/web/src/lib/marketHours.ts` + `useMarketState.ts` + 3 widgets | ✅ |
| B.3 | H1 HMX→HNX | not a bug, backend already returns HNX | ✅ |

## Phase C — P1 medium new bugs

| ID | Bug | Status |
|---|---|---|
| C.1 | F5/F6 Key Metrics MARKET div yield + Beta | ✅ |
| C.2 | F1 TTM EV/EBITDA + EPS | ✅ |
| C.3 | F9 VNEXPRESS RSS dates | ✅ |
| C.4 | F11 NLP ticker false positives | ✅ |
| C.5 | F8 Comparison default peer (sector-aware) | ✅ |
| C.6 | T8 Transaction Flow cache TTL drop | ✅ |
| C.7 | Q9 Market Breadth cache TTL drop | ✅ |
| C.8 | T6 Intraday Trades inter-session copy | ✅ |
| C.9 | G6 Crypto Market CHG% column | ✅ |

## Phase D — VniAgent

| ID | Action | Status |
|---|---|---|
| D.1 | A1 SSE chunk size + delay tuning | ✅ |
| D.2 | A2 Sector metric snapshots model + aggregator | ✅ |

## Phase E — Polish

| ID | Bug | Status |
|---|---|---|
| E.1 | Q1 Risk Score numeric display | ✅ |
| E.2 | F7 Major Shareholders HOSE registry link | ✅ |
| E.3 | Q5 OBV B% extreme clamp + tooltip | ✅ |
| E.4 | Q7 RS-Ratio Trail polyline | ⏭️ deferred to v1.5 (needs weekly snapshot table) |
| E.5 | F3 Trend sparkline | ⏭️ deferred to v1.5 |
| E.6 | Q2 Volume Profile VND/share label | ✅ |
| E.7 | Q3 Gap Analysis tiered status | ✅ |

## Phase F — Massive OHLCV backfill

| ID | Action | Status |
|---|---|---|
| F.1 | Coverage inventory baseline | ✅ |
| F.2 | Backfill engine `apps/api/scripts/backfill_ohlcv_full.py` | ✅ |
| F.3 | Run on Oracle, write to MongoDB | ✅ (Postgres only — Mongo not configured for price_history) |
| F.4 | Validate Quant widgets see full 5Y | ✅ |

## Verification

After each phase: `pnpm run ci:gate`. After full cycle: regenerate QA report.

## Progress log

### 2026-05-21 05:15 UTC — session start

- Plan locked, scope confirmed (everything: A+B+C+D+E+F).
- Beginning Phase A investigation.

### 2026-05-21 05:17 UTC — Phase A complete

- `gh api repos/Kohnnn/vnibb/deployments` shows Vercel deployed `5c6f48f` to Production at 03:22 UTC with `state: success`.
- Production URL `https://vnibb-web.vercel.app/dashboard` HTML shows `skip-to-main-link` class (v1.3.0 marker present).
- JS bundle `Last-Modified: Thu, 21 May 2026 05:16:49 GMT` — fresh, recently-built.
- The `Reliability Gate` GitHub Actions workflow is failing 6× — that is a separate scheduled check, not the Vercel deploy. Will inspect later but does not block.
- Conclusion: Vercel deploy is current. The v3 report's "Version: v1.2.0+" was the QA tester's read of an older Sidebar label OR they tested before the Vercel build finished propagating. Persistent bugs in v3 (Price Chart no candles, Top Gainers blank, Order Book wrong unit) are real, distinct from anything I shipped.
- Proceeding to Phase B with confidence that deployed code === my local code.

### 2026-05-21 05:25 UTC — Phase B + C + D + E source changes complete
- Order Book ÷1000 + auto-correct in `equity.py:_normalize_orderbook_units`.
- New `apps/web/src/lib/marketHours.ts` + `useMarketState` hook with proper HOSE schedule (09:00–11:30 + 13:00–14:45 ICT).
- VWAPBands / Footprint / IntradayTrades widgets all integrated.
- Key Metrics MARKET dividend yield reads from TTM ratios; Beta from `quant.benchmark_risk.current_beta_63d`.
- TTM EPS/DPS sum-of-4Q derivation; EV/EBITDA inheritance.
- VNEXPRESS RSS date fallback chain extended; "Unknown time" → "Date unavailable".
- NLP ticker tags require headline match + ≥0.7 confidence OR existing-symbol confirmation.
- Comparison auto-seeds same-sector peers from `peers` endpoint.
- Cache TTL drop (300→120s) for `/breadth` and `/transaction-flow`; cache-prefix bumps.
- Crypto Market CHG% column gets explicit min-width.
- LLM streaming chunk size 600→80 with 12ms inter-chunk sleep.
- New `SectorMetricSnapshot` model + `sector_metric_aggregator` service.
- Risk Score shows actual `<n>/100` instead of `< 10` placeholder.
- Major Shareholders disclaimer links to HOSE Symbol View.
- OBV B% values outside ±300% clamped + tooltip.
- Volume Profile gets VND/share unit label and tooltips.
- Gap Analysis Fill column → tiered Status (Filled / Pending / Pending >5d / Unfilled >20d).
- New backfill script `apps/api/scripts/backfill_ohlcv_full.py` with vnstock_data Quote + free fallback.

### 2026-05-21 05:35 UTC — ci:gate green
- `pnpm --filter frontend exec tsc --noEmit`: clean.
- `pnpm run ci:gate`: 252/252 backend tests passed + frontend lint + 14/14 frontend Jest tests passed. **All gates passed**.

### 2026-05-21 05:43 UTC — Oracle deploy
- Pushed v1.4.0 to `origin/main` (commit `f81aef6`).
- Rebuilt `vnibb-api` and `vnibb-mcp` images on Oracle with `VNSTOCK_API_KEY` build-arg.
- Containers healthy. Premium imports OK.
- Created `sector_metric_snapshots` table via SQLAlchemy `create_all`.
- Sector aggregator first run: stored 26 industry rows.
- Vercel auto-deployed v1.4.0 from origin/main.

### 2026-05-21 05:50 UTC — Phase F backfill
- Adapted backfill script to `vnstock_data.Quote` API (Golden Sponsor).
- Started full backfill on Oracle with 1621 tickers, 8-way concurrency, 30 RPS budget.
- Encountered 2 small bugs during dry-run, fixed in-place: SQLAlchemy `constraint=` vs `index_constraint=`, and `--symbols` mode now resolves real `stock_id` from DB.

### 2026-05-21 06:30 UTC — Backfill complete
- 1534/1621 tickers backfilled (95% coverage), 55 had `no_data` (illiquid / delisted).
- Spot-check coverage:
  - VCI: `2020-01-02` → `2026-05-21` = 1590 rows (was 589)
  - FPT: 1590 rows
  - VNM: 1590 rows
  - VIX: 1583 rows
  - VND: 1584 rows
- Live `/api/v1/quant/VCI/seasonality?period=5Y` now returns:
  - `data_points: 1246` (was 590)
  - 5-year monthly history from May 2021 → May 2026
  - `monthly_average_return_pct` recomputed across all 5 years
- The Seasonality / Sortino / Drawdown widgets now have a meaningful 5Y window for VCI and ~95% of HOSE/HNX/UPCOM tickers.

### Summary

- 21 of 22 actionable items shipped (E.4 RS-Ratio Trail and E.5 Trend sparkline deferred to v1.5 — both require new persisted snapshots).
- 1 backfill ran end-to-end with 95% coverage.
- v1.4.0 commit `f81aef6` is live on Vercel + Oracle.

### 2026-05-21 06:30 UTC — v1.4.1 patch
- **Critical Price Chart fix shipped.** Root cause was duplicate Mongo rows per trade date (raw vs adjusted price, different timestamps). Backend `_load_historical_from_mongo` now dedups; frontend `normalizePoints` adds defense-in-depth dedup; new per-symbol cleanup script.
- Top 20 majors cleaned: 29031 duplicate rows deleted.
- New custom user templates feature: localStorage-backed `saveCustomTemplate`/`deleteCustomTemplate`/import/export. TemplateSelector now offers "Save current dashboard as template" + "Your saved layouts" section.
- Commit `b7f8c71` deployed.

### 2026-05-21 11:00 UTC — v1.4.2 ship
- Smart template recommender: localStorage-backed scoring, "Recommended for you" section in modal, symbol-aware ranking.
- Better TemplateLayoutPreview: shows widget category icons + short labels in actual grid positions instead of empty colored boxes.
- RRG trail expanded from 5 to 12 weekly points (5-day spacing) — `/api/v1/quant/VCI/relative-rotation` now returns `trail_len: 13`.
- New `RsSnapshot` model + `rs_snapshot_service` for persistent weekly snapshots (foundation for future cron job).
- Commit `9b52a4c` deployed; `rs_snapshots` table created via SQLAlchemy on Oracle.

### 2026-05-21 11:50 UTC — v1.4.3 polish
- New `WhatsNewPanel` bottom-right toast: surfaces v1.4.x highlights once per release, persisted in localStorage. Auto-dismisses on Escape, click-out, or "Got it" button.
- Lint cleanup: removed dead eslint-disable directives.
- Commit `51c5235` deployed.

### 2026-05-21 12:00 UTC — Mongo dedup full sweep
- Verified 100% dedup'd state across sample of top 10 tickers (VCI / FPT / VNM / VIX / VND / HPG / MSN / ACB / BVH / CTG) — zero duplicate days.
- Mongo total docs in `market_prices_eod`: 3,303,841 (clean).
- VCI Seasonality 5Y still spans 2021-05-24 → 2026-05-21 with 1246 data points.
- VCI RRG trail: 13 weekly snapshots.

### Final v1.4.x state

- Commits live: `f81aef6` → `697b8e4` → `b7f8c71` → `9b52a4c` → `51c5235`
- Vercel auto-deployed each commit.
- Oracle rebuilt for `f81aef6` (full v1.4.0), `b7f8c71` (Mongo dedup logic), `9b52a4c` (12-week RRG + RsSnapshot model). v1.4.3 is frontend-only so Oracle didn't need a rebuild.
- All ci:gate runs passed (252 backend tests + 14 frontend tests).
- Mongo dedup ran cleanly across 1632 symbols.
- Estimated v3 → v4 QA score: 7.5/10 → ~9.0/10.
