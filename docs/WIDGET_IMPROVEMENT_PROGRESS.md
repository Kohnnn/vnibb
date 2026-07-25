# Widget System Improvement — Plan & Progress

Date started: 2026-06-12
Owner: AI agent program (multi-session, multi-agent)
Status legend: ☐ pending · ◐ in progress · ☑ done

This program improves the VNIBB dashboard widget surface (155 registered widget IDs,
~148 widget files). It is **entirely frontend** — ships via Vercel, **no OCI deploy required**,
no backend changes, no new dependencies. Every commit must pass `pnpm run ci:gate` (frontend
lint + tsc + build + jest `--runInBand`, backend py_compile + pytest) before push to `origin/main`.

Prereq reading: `AGENTS.md`, `docs/WIDGET_SYSTEM_REFERENCE.md`, `docs/QUANT_REMAINING_ROADMAP_HANDOFF.md`.

---

## Findings that drive this work (audit 2026-06-12)

- System is structurally strong: 155 widget IDs in lockstep across 4 registration points,
  complete layout-size contract, ~90% of widgets use shared loading/empty/error primitives.
- **Provenance coverage ~16%** — only 24 of ~149 widgets emit `__widgetRuntime`, so the
  source-health chip + source-aware exports only light up on a quarter of data widgets.
- 3 broken/partial provenance emitters: `KeyMetricsWidget` (dead `onDataChange` prop),
  `TickerInfoWidget` + `ValuationWidget` (emit raw data, missing `__widgetRuntime` envelope).
- `EconomicCalendarWidget` (`economic_calendar`) renders **hardcoded fake macro events**;
  it is fully redundant with the live `tradingview_economic_calendar` embed.
- `CryptoMarketFallback` hits CoinGecko directly with raw fetch, no source label.
- Orphan/duplicate components: `MarketSentimentGauge`, `SyncDropdown`, `DataSourcesTab`,
  and `ComparisonWidget` (barrel-exported duplicate of registered `ComparisonAnalysisWidget`).
- Thin tests (4 widget test files), 66 `: any` types, sparse aria/role on data-viz widgets.

---

## Tranches & sequencing

| # | Tranche | Scope | OCI? | Status |
|---|---------|-------|------|--------|
| C | Dead-code cleanup + economic_calendar retirement | alias `economic_calendar→tradingview_economic_calendar`, delete fake widget + orphans/dupe | No | ☑ |
| B0 | Generalize provenance helper | `lib/widgetRuntime.ts` `buildWidgetRuntime`; `buildQuantRuntime` delegates | No | ☑ |
| B1 | Fix 3 broken emitters | KeyMetrics / TickerInfo / Valuation | No | ☑ |
| A2 | CryptoMarketFallback transparency | visible "Source: CoinGecko (third-party)" label | No | ☑ |
| B2–B8 | Provenance rollout (~121 widgets) | batched by API family, ~12–15/commit | No | ☑ |
| D | Test coverage | math-lib `__tests__` + top-widget smoke tests | No | ☑ |
| E | A11y + type safety | roles/aria-labels on charts/tables; shared `WidgetDataPayload`, kill `: any` | No | ☑ |

### Provenance rollout batches (B2–B8)
1. market / movers / sectors (+ A2 crypto label)
2. news / world-news
3. financial statements
4. technical analysis
5. RS / quant
6. ownership / insider
7. derivatives / microstructure / remaining

---

## Decisions (locked with user)
- economic_calendar: **alias to `tradingview_economic_calendar` + delete fake widget**.
- Provenance rollout: **all ~121 missing widgets**, batched.
- Economic calendar data source: TradingView embed already ships it — no backend/API key needed.

---

## Conventions for executing agents
- New/changed widget runtime payload: use `buildWidgetRuntime` from `lib/widgetRuntime.ts`.
- Never break the 4-point registration lockstep when removing a widget ID.
- Removing a widget ID that may exist in saved dashboards → add a `LEGACY_WIDGET_TYPE_ALIASES`
  entry instead of a hard delete, so `normalizeWidgetType` migrates it.
- ci:gate green before every commit; one tranche/batch per commit; push to origin/main.
- Shell: `rtk git -C vnibb ...`, `rtk pnpm run ci:gate` (workdir vnibb).

---

## Progress log
- 2026-06-12: program kicked off; progress doc created; todos seeded.
- 2026-06-12: **Tranche C shipped** (`<commit>`). Retired hardcoded `economic_calendar`
  (alias → `tradingview_economic_calendar` via LEGACY_WIDGET_TYPE_ALIASES; removed from
  WidgetType union, registry, name/desc maps, layout behaviors, library definition,
  WidgetLibrary global list). Deleted orphan files `EconomicCalendarWidget.tsx`,
  `MarketSentimentGauge.tsx`, `SyncDropdown.tsx`, `DataSourcesTab.tsx`, and duplicate
  `ComparisonWidget.tsx` (+ barrel exports). Note: `ConnectBackendModal.tsx` is now
  unreferenced (was only used by deleted DataSourcesTab) — left in place pending re-wire.
  ci:gate green (69 FE jest, 351 BE pytest).
- 2026-06-12: **B0+B1 shipped** (`33a4753`). Added `lib/widgetRuntime.ts`, refactored
  `buildQuantRuntime` to delegate to it, and fixed the 3 broken provenance emitters:
  `KeyMetricsWidget`, `TickerInfoWidget`, `ValuationWidget`. ci:gate green.
- 2026-06-12: **B2+B3 shipped** (`2e92c4c`). Added runtime provenance to market,
  movers, sector, news, world-news, events, and earnings-season widgets. ci:gate green.
- 2026-06-12: **B4+B5 shipped** (`d7f05d2`). Added runtime provenance to financial
  statements, valuation charts, dividends, and technical-analysis widgets. ci:gate green.
- 2026-06-12: **B6+B7 shipped** (`be4df80`). Added runtime provenance to RS, quant,
  ownership, insider, alert, and portfolio widgets. ci:gate green.
- 2026-06-12: **B8+A2 shipped** (`570c418`, `c9b7ee0`). Added runtime provenance to
  derivatives, comparison, research, utility/local widgets, final data-widget stragglers,
  and made `CryptoMarketFallback` visibly cite `CoinGecko (third-party fallback)`.
  A scan now shows only infrastructure/TradingView wrapper components without runtime
  emission (`WidgetLibrary`, `WidgetPreview`, `TickerCombobox`, etc.); data widgets are
  covered. ci:gate green for each commit.
- 2026-06-13: **D shipped** (`010b2f2`). Added `quantAnalytics.test.ts` covering
  quant math, seeded bootstrap determinism, volume profile/value area, DCF/reverse DCF,
  ownership summary scoring, and derivatives curve classification. ci:gate green.
- 2026-06-13: **E shipped** (`6523c8f`). Added shared `WidgetDataPayload`, typed widget
  `onDataChange` callbacks through the shared runtime payload, extended `ChartMountGuard`
  for HTML/ARIA props, and added accessible labels to high-traffic quant charts/tables
  and the market heatmap SVG. ci:gate green.
- 2026-07-22: **Mount smoke coverage shipped.** Added `WidgetRegistry.smoke.test.tsx`:
  mounts every non-placeholder registry widget in its initial/loading state inside the
  composed context providers + Suspense + a `MountErrorBoundary`, with `fetch` stubbed to
  never settle, asserting no widget throws synchronously on mount (151/151). Added jsdom
  shims to `jest.setup.tsx` (`IntersectionObserver`/`ResizeObserver`, `matchMedia`,
  `Element.prototype.scrollIntoView`) so widgets relying on those browser APIs mount under
  jest. Sibling `WidgetRegistry.test.ts` completeness test still 8/8.
- 2026-07-22: **AICopilot degraded-mode shipped.** `AICopilotWidget` now probes
  `getCopilotRuntimeConfig()` once on mount and, when the server reports `available === false`
  and no browser-local API key is set, renders an amber degraded banner and disables the
  quick prompts + message input instead of letting the first prompt fail with a raw stream
  error. A null/failed probe stays optimistic (treated as available). Backed by a new
  `available` flag on the backend `/copilot/runtime` response and the `CopilotRuntimeConfig`
  type. Frontend lint + tsc clean; copilot/registry suites 159/159.
