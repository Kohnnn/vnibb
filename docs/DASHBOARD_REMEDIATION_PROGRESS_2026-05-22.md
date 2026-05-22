# Dashboard Remediation Progress - 2026-05-22

## Goal

Fix dashboard issues reported from `https://vnibb-web.vercel.app/dashboard`, then verify, commit, push, and redeploy on OCI.

## Issues

1. Hide the global "Some data is stale" dashboard banner. Keep freshness detail in admin/settings surfaces.
2. Stop TradingView Ticker Tape from surfacing third-party chunk load failures; use a native fallback.
3. Restore the first-user walkthrough popup.
4. Expand native stock chart `MAX` history beyond the 2020-era cap without making candles invisible.
5. Optimize Seasonality Heatmap: remove hourly mode, make day/week cells color-only, and support larger historical grids.
6. Make Financial Ratios catch up when Income Statement, Balance Sheet, or Cash Flow have newer periods.

## Plan

1. Restrict `FreshnessBanner` to critical-only visibility so stale notices are not shown in the main workspace.
2. Add a native ticker tape fallback and route `tradingview_ticker_tape` to it when TradingView chunks fail or time out.
3. Bump dashboard walkthrough version so users see the guide again once.
4. Change chart `MAX` to request data from `2000-01-01`, and render dense long-range data as line/area instead of unreadable candles.
5. Remove `hourly` seasonality UI option and use compact color-only cells for daily/weekly grids.
6. Update ratio endpoint freshness detection so newer statement periods trigger provider fetch/statement-derived ratio rows even when old DB ratios exist.

## Progress

- Started implementation.
- Changed dashboard freshness banner to display only critical sync degradation; stale status remains available through settings/admin data-source surfaces.
- Bumped dashboard walkthrough version from `1` to `2` so users see the guide again once.
- Changed native chart `MAX` start date to `2000-01-01` and force dense long-range candlestick requests into line rendering to avoid invisible candles.
- Removed hourly mode from Seasonality Heatmap, expanded week/day row limits, and made week/day cells color-only with exact values in tooltips.
- Added native Ticker Tape fallback for TradingView web-component chunk failures, including `ChunkLoadError` / `snowplow-embed-widget-tracker` promise rejections.
- Updated financial-ratio endpoint freshness logic so newer Income Statement, Balance Sheet, or Cash Flow periods trigger provider fetch/statement-derived enrichment even when older ratio rows exist.

## Verification Log

- `pnpm --filter frontend lint` passed.
- `python -m py_compile apps/api/vnibb/api/v1/equity.py` passed.
- `pnpm run ci:gate` passed: frontend lint/build/tests, backend compile, and 252 backend tests.

## Deployment Log

- Pending.
