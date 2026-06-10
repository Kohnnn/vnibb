# Quant Functions Fix Pass + New Quant Widgets — Design

Date: 2026-06-10
Status: approved (user: "do both, ship all")
Source analysis: docs/reverse-engineering (turtle-hub quant-tabs-deep-dive, fincept opportunity map) + audit of apps/api/vnibb/api/v1/quant.py and frontend quant widgets.

## Part 1 — Fix pass (existing functions)

| ID | Fix | Where |
| --- | --- | --- |
| F1 | Sortino ±99 sentinel values distort averages. Exclude |v| >= 99 from client-side averaging/scoring; keep backend payload unchanged. | QuantSummaryWidget.averageSortino, lib/quantRegime scoreSortino |
| F2 | MACD forward 1M/3M returns and gap next-day returns are forward-looking but undisclosed. Set `forwardLooking` on QuantWarningBanner. | MACDCrossoverWidget, GapAnalysisWidget |
| F3 | `calmar` metric computed by backend but consumed by no widget. Add Calmar card to QuantSummaryWidget (request metric, display annualized return / max DD / Calmar). | QuantSummaryWidget |
| F4 | `var_95_1d_pct` is a full-period percentile, labeled like a rolling daily estimate. Relabel "VaR 95 (full period)" in UI. | QuantSummaryWidget, RiskDashboardWidget |
| F5 | Gap fill rate counts same-day fills only. Disclose in widget note. | GapAnalysisWidget |
| F6 (=Widget A) | Backend seasonality-matrix supports `daily` (day-of-week) granularity; widget only offers monthly/weekly. Add "Day" option. | SeasonalityHeatmapWidget |

## Part 2 — New quant widgets (descriptive, client-side from adjusted EOD)

### B. `edge_half_life` — Edge Half-Life (quant)
Rolling Sharpe (21/63/126D window selector) from adjusted EOD via useHistoricalPrices.
Cards: current rolling Sharpe, peak, % decay from peak, days since peak.
Chart: rolling Sharpe line with zero line. Window selector doubles as a mini parameter sweep (E-pattern).
Labeling: descriptive decay read, not a forecast.

### C. `pair_lab` — Pair Lab (quant)
Two symbol inputs (default: selected symbol + VN peer). From two adjusted EOD series:
rolling 63D correlation, log-price spread, spread z-score (full-period mean/std),
AR(1) mean-reversion half-life of the spread (descriptive; no hedge-ratio claims, no signals).
Chart: spread z-score with ±2 bands. Engle-Granger omitted in v1 (needs regression + ADF; half-life via AR(1) is honest and simple).

### D. `monte_carlo_lab` — Monte Carlo Drawdown Cone (quant)
IID bootstrap of daily returns: 300 paths x 126 days (capped for browser).
Outputs: distribution of forward max drawdown (P5/P25/P50/P75/P95) and terminal return percentiles.
Prominent disclosure: resampling of past daily returns; assumes IID; not a prediction.

### E. Threshold sweep (existing-widget upgrade)
BollingerSqueezeWidget: client-side sweep table over squeeze threshold percentiles (P10/P20/P30)
computed from the returned bb_width_series — % of days in squeeze + current active per threshold.
(Plus the window selector in B serves the same sweep pattern.)

## Registration
New widget IDs `edge_half_life`, `pair_lab`, `monte_carlo_lab` registered in:
types/dashboard.ts (WidgetType), WidgetRegistry.ts (component + name + description),
lib/dashboardLayout.ts, data/widgetDefinitions.ts (category: quant, recommended).

## Constraints
- No FinceptTerminal/Quantcept/TurtleHub code copied; patterns only.
- Frontend-only; no backend changes. Browser-local state.
- Provenance via __widgetRuntime; warnings via QuantWarningBanner where applicable.
- Verification: pnpm run ci:gate per wave; commit + push.

## Out of scope (future)
Variance ratio / GARCH / vol clustering in Market Lab, cointegration tests, CPCV/PBO,
backend sweep endpoints, run history/pinning.
