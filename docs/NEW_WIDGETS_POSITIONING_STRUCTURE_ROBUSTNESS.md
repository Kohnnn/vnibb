# New Widgets Plan & Progress — Positioning, Market Structure, Signal Robustness

Date started: 2026-06-09. Source inspiration: reverse-engineering crawls
(`docs/reverse-engineering/turtle-hub-crawl-2026-06-09`,
`docs/reverse-engineering/fincept-quantcept-terminal-crawl-2026-06-09`).

Constraints (unchanged): Next.js + FastAPI + Appwrite-primary + Supabase/Postgres
bridge + Redis + vnstock + read-only `vnibb-mcp`. No FinceptTerminal/Quantcept code
copied. No live trading. Reuse existing API groups; new widgets are client-side over
existing endpoints with Phase 1 source-provenance + source-aware export.

## Registration sites (compile-enforced unless noted)

1. `apps/web/src/types/dashboard.ts` — add to `WidgetType` union.
2. `apps/web/src/components/widgets/WidgetRegistry.ts` — `widgetRegistry`, `widgetNames`,
   `widgetDescriptions` (three exhaustive records) + import.
3. `apps/web/src/lib/dashboardLayout.ts` — `WIDGET_LAYOUT_BEHAVIORS` entry.
4. `apps/web/src/data/widgetDefinitions.ts` — library entry (array, not compile-enforced
   but required to be visible in the picker).

## Widget 1 — Positioning Dashboard (`positioning_dashboard`)

- Goal: table-first participant positioning (foreign / proprietary / domestic net flow)
  across a small universe, with follow/contrarian read.
- Data: `useSymbolsByGroup('VN30'|'VN100'|'HNX30')` for the universe + per-symbol
  `useTransactionFlow(symbol, { days })` aggregating `foreign_net_value`,
  `proprietary_net_value`, `domestic_net_value` over the window. API groups: `/listing`,
  `/equity`.
- Scope guard: cap universe to keep parallel queries bounded (VN30 default, ~30 calls,
  cached by React Query). Time window selector 5D/20D.
- Provenance: source `/equity/{s}/transaction-flow`; CSV export of the table.
- Empty/error: symbols without investor-bucket flow are labeled, not hidden.

## Widget 2 — VN Market Structure (`market_structure`)

- Goal: one-symbol structure view: volume-by-price profile + POC/VAH/VAL + foreign-flow
  zones + key high-volume levels with distance-to-price.
- Data: `useMicrostructureAnalysis(symbol)` (volume_profile bins + poc/vah/val), with
  local `calculateVolumeProfile` fallback over `useHistoricalPrices`; foreign tilt from
  `useForeignTrading`. API groups: `/microstructure`, `/equity`.
- Provenance: source `/microstructure/{s}`; labels coverage/quality from payload.

## Widget 3 — Signal Robustness Lab (`signal_robustness_lab`)

- Goal: test a simple signal (RS rating, momentum score, or a screener metric threshold)
  across a ticker universe and surface a hit-rate / average-forward-return read, so signal
  widgets become "tested behavior" not "current opinion".
- v1 scope: configuration-driven (NOT a code editor). Signal = RS rating >= threshold OR
  momentum score >= threshold. Universe = VN30/VN100. For each symbol fetch RS + momentum
  + recent return; compute the share of the universe passing and their average recent
  return vs the universe average (a coarse edge read). Clearly labeled as descriptive.
- Data: `useSymbolsByGroup`, `useRSLeaders`/`getRSRating`, `useMomentumProfile`. API
  groups: `/listing`, `/rs`, `/quant`.
- Provenance + CSV export of the per-symbol result table.

## Progress log

- 2026-06-09: Scoped all three; data deps confirmed via explore agent. FlowCoverage gives
  only coverage counts (not values), so Positioning iterates per-symbol transaction-flow.
### Shipped 2026-06-09

All three widgets implemented, registered (WidgetType union + WidgetRegistry 3 maps +
dashboardLayout + widgetDefinitions), typecheck + lint clean, ci:gate green.

- `positioning_dashboard` (category: ownership) — `PositioningDashboardWidget.tsx`.
  VN30/VN100/HNX30 selector + 5D/20D window. `useQueries` fetches per-symbol
  `transaction-flow` in parallel (capped at 40 symbols), sums foreign/proprietary/
  domestic/total net value, sorts by foreign net, table-first with click-to-symbol.
  Publishes provenance + rows for source-aware export. Symbols lacking bucket flow are
  counted and labeled ("N/M with flow").
- `market_structure` (category: charting) — `MarketStructureWidget.tsx` + pure helper
  `lib/marketStructure.ts` (`buildVolumeProfile`: 24-bin profile, POC, 70% value-area
  VAH/VAL, top-5 key levels). Horizontal volume-by-price bars (POC amber, value-area
  cyan), KPI header, key levels with distance-to-last-close, foreign-flow tilt from
  `useForeignTrading`. Period selector; adjusted EOD.
- `signal_robustness_lab` (category: quant) — `SignalRobustnessLabWidget.tsx`. Single
  `useScreenerData({ limit: 300 })` call (no per-symbol fan-out). Signal = field
  (rs_rating / perf_1m / roe / pe) + comparator + threshold; reports universe / pass /
  pass-rate and avg trailing return (1M/3M/6M) of passing vs universe with an "edge"
  delta, plus the passing-names table. Labeled descriptive / not a backtest.

Notes / future:
- Positioning uses trailing realized flow; a forward-return follow/contrarian badge is deferred.
- Market Structure value-area uses mid-price EOD volume distribution (proxy); intraday
  `/microstructure` TPO precision can be layered later.
- Signal Robustness is cross-sectional on the current snapshot; a multi-period historical
  robustness matrix across time windows is the larger follow-up.
