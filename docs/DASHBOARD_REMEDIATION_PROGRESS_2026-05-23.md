# Dashboard Remediation Progress - 2026-05-23

## Goals

- Fix template apply flow so locked/default dashboards ask before creating an editable workspace from a template.
- Improve Financial Statements so returned statement rows do not render as blank when useful values only exist in provider/raw fields.
- Add data parity probes with top-market-cap coverage as the target and all listed stocks as the long-term goal.
- Keep the existing Seasonality Heatmap for monthly/weekly only, show weekly columns as plain numbers, and add a daily-only Spiral Heatmap widget.
- Prioritize native VNIBB technical widgets, adding data-quality diagnostics before revisiting third-party TradingView failures.

## Plan

1. Template workflow
   - Detect attempts to apply templates on locked/default dashboards.
   - Ask before creating a new editable workspace from the selected template.
   - Avoid black overlay/dead-end states after apply/cancel.

2. Financial statements
   - Expand frontend metric lookup to read normalized raw provider fields.
   - Surface useful diagnostics when rows exist but tracked metrics are empty.
   - Add a parity probe script that can run top-market-cap and all-stock checks against statement endpoints.

3. Seasonality
   - Remove daily mode from the matrix widget.
   - Render weekly labels as `1` to `53` while keeping tooltips explicit.
   - Add a daily spiral widget using daily return cells, clear legend, and tooltip denotation.

4. Technical widgets
   - Add native data-quality helpers for insufficient bars, stale data, duplicate dates, missing values, and malformed OHLC rows.
   - Improve UI empty/error states to explain data quality instead of generic failures.
   - Keep TradingView fallback work secondary until native widgets are stable.

## Progress

- Implemented template apply confirmation for locked/default dashboards. Applying a template there now asks before creating a new editable workspace and leaves the current dashboard unchanged on cancel.
- Improved Financial Statements rendering by normalizing raw/provider metric keys, including camelCase and Vietnamese diacritic-safe aliases, before declaring a statement tab blank.
- Added `scripts/financial-statement-parity.mjs` to probe Income Statement, Balance Sheet, Cash Flow, and Ratios for top-market-cap or explicit ticker sets.
- Removed daily mode from the existing Seasonality Heatmap, leaving monthly and weekly matrix views.
- Changed weekly heatmap display labels from `W01`/`W02` to `1`/`2` while keeping tooltips explicit as `Week 1`, `Week 2`, etc.
- Added `seasonality_spiral_heatmap`, a daily-only spiral heatmap widget with clear old-to-new denotation, positive/negative legend, and per-cell date/return tooltips.
- Added native technical data-quality cleaning/metadata for OHLCV bars, including duplicate-date removal, malformed OHLC filtering, bar-count warnings, and stale latest-bar warnings.
- Surfaced native technical data-quality warnings in `TechnicalSummaryWidget`.

## Verification Log

- `pnpm --filter frontend exec tsc --noEmit` passed.
- `python -m py_compile apps/api/vnibb/api/v1/technical.py apps/api/vnibb/services/technical_analysis.py` passed.
- `pnpm --filter frontend lint` passed.
- Financial parity probe was run against `https://129.150.58.64.sslip.io` for all listing symbols returned by `/api/v1/listing/symbols`.
- All-symbol universe returned `1,742` symbols.
- Full all-symbol/all-period check attempted `41,808` checks with concurrency `16`; result was polluted by public API `429 Too Many Requests` responses.
- FY-only all-symbol baseline attempted `6,968` checks with concurrency `4`; result was still rate-limited by public API `429 Too Many Requests` responses.
- Current parity blocker is API rate limiting during bulk validation, not the probe's ability to enumerate all stocks.

## Deployment Log

- Pending.
