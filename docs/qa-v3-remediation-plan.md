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
| F.1 | Coverage inventory baseline | 🟦 |
| F.2 | Backfill engine `apps/api/scripts/backfill_ohlcv_full.py` | ✅ |
| F.3 | Run on Oracle, write to MongoDB | 🟦 |
| F.4 | Validate Quant widgets see full 5Y | ⬜ |

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
