# Widget Improvement Roadmap

Date: 2026-04-04

## Goal

Improve data correctness, readability, resize behavior, and analytical depth across the highest-friction widgets without layering visual polish on top of inconsistent data.

## Phase 1: Quarterly Data Integrity

Priority widgets:

- Financial Ratios
- Income Statement
- Balance Sheet
- Cash Flow
- Financial Snapshot
- Earnings History

Problems to solve:

- quarterly views can mix annual rows and quarterly rows
- some quarter labels are inferred incorrectly from bare year values
- duplicate year and quarter rows can leak into the same table

Implementation focus:

- backend period normalization for statement and ratio rows
- frontend quarter-only filtering for quarter views
- shared period-label safety so annual rows are not shown as fake quarters
- regression tests for backend normalization and frontend rendering

## Phase 2: Financial Visualization Models

Priority widgets:

- Income Sankey
- Cash Flow Waterfall

Problems to solve:

- current Sankey layout is visually cluttered and semantically weak
- current waterfall mixes subtotal bars and bridge bars in a confusing way

Implementation focus:

- rebuild chart models first
- then simplify chart layout, labels, and grouping
- validate sign conventions and subtotal logic

## Phase 3: Resize And Layout Reliability

Priority widgets:

- Transaction Flow
- Volume Flow
- Sortino Monthly
- Momentum
- Commodities
- Insider Trading
- Major Shareholders
- Officer & Management
- Foreign Trading
- Intraday Trades
- Order Book

Problems to solve:

- widget size can snap back after data/runtime updates
- several widgets have overly rigid minimum content heights
- list-heavy widgets waste space when expanded and feel cramped when shrunk

Implementation focus:

- fix `layoutHint` handling in `WidgetWrapper`
- reduce overly aggressive default/min heights where appropriate
- prefer one clear scroll region per widget

## Phase 4: Market Structure And Flow Readability

Priority widgets:

- Sector Breakdown
- Money Flow Trend

Problems to solve:

- sector breakdown chart is cramped and legend-heavy
- money flow trend is too dense and lacks useful universe controls

Implementation focus:

- ranked/treemap sector views with top-N plus Other
- top 5/10/20/all controls for money flow trend
- sort universe by metric such as market cap, trading value, trading volume, or flow score
- reduce label clutter and improve focus controls

## Phase 5: Valuation History And Statistical Context

Priority widgets:

- Valuation Band
- Valuation Multiples Chart

Problems to solve:

- valuation band only supports a small metric set
- chronology is not aligned with the newer financial widgets
- history can be truncated and statistical overlays are limited

Implementation focus:

- add EV/EBITDA, EV/Sales, and other useful metrics
- add mean and plus/minus 1 and 2 standard deviation overlays
- preserve oldest-to-newest full history while auto-focusing the newest range
- improve ratio-history backend semantics if needed

## Phase 6: Risk Dashboard Redesign

Priority widget:

- Risk Dashboard

Problems to solve:

- current risk score is hard to interpret
- composition is not benchmark-aware enough
- warning/data quality context is limited

Implementation focus:

- clearer score breakdown
- stronger downside and benchmark-relative context
- better drawdown, volatility, and regime presentation

## Phase 7: Price Adjustment And Corporate Actions

Cross-cutting scope:

- historical prices
- quant metrics
- valuation views
- event-aware charting

Problems to solve:

- current analytics largely use raw prices
- dividends, new issuance, splits, and related actions are not modeled as structured adjustment factors

Implementation focus:

- normalized corporate action model
- adjusted price modes and adjustment factors
- event markers and adjustment-aware analytics

Current shipped slice:

- `adjustment_mode` support on historical prices (`raw` or `adjusted`)
- adjusted OHLC derivation from stored `adj_close` when available
- frontend raw/adjusted toggle in key chart consumers
- adjusted-history default for risk-oriented consumers
- normalized company event classification fields for dividends, splits, issuance, and meetings

## Delivery Order

Recommended execution order:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7

## Current Turn

This implementation pass starts with Phase 1 because quarterly period errors contaminate multiple widgets and can mislead every later visualization layer.
