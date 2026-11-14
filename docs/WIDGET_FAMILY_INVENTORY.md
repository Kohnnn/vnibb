# Registered Widget fit families — 2026-09-27

The native workspace uses five primary content families for fit/overflow review. This is a **static source inventory**, not proof that every widget renders successfully with live data. Counts below were recomputed from source (`widgetDefinitions` and `getRegisteredWidgetIds`): runtime registry **175 unique IDs**, widget-library catalogue **170 unique IDs**, built-in templates 59 IDs, union 175, with zero catalogue-only and zero unresolved template IDs. The **five** registry-only IDs are `market_heatmap`, `dividend_ladder`, `ai_copilot`, `rs_ranking`, and `positioning_dashboard`. Family assignment is mutually exclusive by dominant surface; mixed table/chart widgets are assigned to the more demanding presentation. TradingView embeds are always custom/third-party even if their contents depict a chart or table.

**Correction (2026-11-14):** being registry-only (absent from the widget-library
catalogue) does **not** mean non-rendering. All five have real lazy renderers in
`WidgetRegistry.ts` — `market_heatmap` -> `MarketHeatmapWidget`, `dividend_ladder`
-> `DividendLadderWidget`, `ai_copilot` -> `AICopilotWidget`, `rs_ranking` ->
`RSRankingWidget`, `positioning_dashboard` -> `PositioningDashboardWidget`. Their
catalogue absence is a library/picker difference, not a defect and not a
non-render disposition. `dividend_ladder` and `rs_ranking` are actively owned by
other workers; this inventory makes no claim about their render state.

## Dense table / board (35)

`analyst_estimates`, `balance_sheet`, `bank_metrics`, `cash_flow`, `comparison_analysis`, `derivatives_contracts_board`, `dividend_payment`, `earnings_history`, `financial_ratios`, `financial_snapshot`, `foreign_flow_leaderboard`, `foreign_trading`, `income_statement`, `insider_trading`, `intraday_trades`, `listing_browser`, `major_shareholders`, `market_movers_sectors`, `officers_management`, `orderbook`, `ownership_changes`, `peer_comparison`, `research_matrix`, `rs_ranking`, `screener`, `sector_board`, `sector_breakdown`, `sector_top_movers`, `stock_splits`, `sweep_matrix`, `top_movers`, `transaction_flow`, `unified_financials`, `watchlist`, `watchlist_limits_monitor`.

## Native chart / plotted view (52)

`amihud_illiquidity`, `atr_regime`, `backtest_lab`, `bollinger_squeeze`, `cashflow_waterfall`, `consensus_odds`, `correlation_matrix`, `cross_source_calibration`, `derivatives_price_history`, `drawdown_deep_dive`, `drawdown_recovery`, `election_odds`, `ema_respect`, `fibonacci`, `footprint_proxy`, `gamma_exposure`, `gap_analysis`, `gap_fill_stats`, `garch_volatility`, `growth_bridge`, `hurst_market_structure`, `ichimoku`, `income_sankey`, `index_comparison`, `industry_bubble`, `macd_crossovers`, `macro_calibration`, `market_heatmap`, `market_structure`, `momentum`, `money_flow_trend`, `monte_carlo_lab`, `obv_divergence`, `ownership_rating_summary`, `parkinson_volatility`, `price_chart`, `relative_rotation`, `rsi_seasonal`, `seasonality_heatmap`, `seasonality_spiral_heatmap`, `sector_performance`, `sector_rotation_radar`, `signal_summary`, `sortino_monthly`, `technical_snapshot`, `valuation_band`, `valuation_multiples_chart`, `volume_analysis`, `volume_delta`, `volume_flow`, `volume_profile`, `vwap_bands`.

## Compact KPI / summary (31)

`big_flow_monitor`, `block_trade`, `commodities`, `derivatives_analytics`, `earnings_quality`, `edge_half_life`, `forex_rates`, `fundamental_analysis`, `key_metrics`, `market_breadth`, `market_lab`, `market_overview`, `market_sentiment`, `pair_lab`, `portfolio_tracker`, `positioning_dashboard`, `quant_summary`, `quick_stats`, `risk_dashboard`, `share_statistics`, `signal_robustness_lab`, `similar_stocks`, `smart_money`, `source_drift`, `technical_summary`, `ticker_info`, `ticker_profile`, `top_movers_pulse`, `ttm_snapshot`, `valuation_lab`, `world_indices`.

## News / record list (27)

`ai_analysis`, `alert_activity_inbox`, `company_filings`, `dividend_ladder`, `earnings_release_recap`, `earnings_season_monitor`, `events_calendar`, `insider_deal_timeline`, `investor_event_calendar`, `kalshi`, `limitless`, `manifold`, `market_news`, `news_corporate_actions`, `news_feed`, `news_flow`, `notes`, `polymarket`, `prediction_alerts`, `prediction_movers`, `predictit`, `price_alerts`, `research_browser`, `subsidiaries`, `world_news_live_stream`, `world_news_monitor`, `world_news_sources`.

## Custom interaction / third-party embed (30)

`ai_copilot`, `alert_settings`, `database_inspector`, `source_transparent_research_notebook`, `tradingview_chart`, `tradingview_company_profile`, `tradingview_crypto_heatmap`, `tradingview_crypto_market`, `tradingview_economic_calendar`, `tradingview_economic_map`, `tradingview_etf_heatmap`, `tradingview_forex_cross_rates`, `tradingview_forex_heatmap`, `tradingview_fundamental_data`, `tradingview_market_data`, `tradingview_market_overview`, `tradingview_market_summary`, `tradingview_mini_chart`, `tradingview_screener`, `tradingview_single_ticker`, `tradingview_stock_heatmap`, `tradingview_stock_market`, `tradingview_symbol_info`, `tradingview_symbol_overview`, `tradingview_technical_analysis`, `tradingview_ticker`, `tradingview_ticker_tag`, `tradingview_ticker_tape`, `tradingview_top_stories`, `world_news_map`.

## Exceptions and proof boundary

The 13 previously placeholder-routed Widgets now load their named implementations: `seasonality_spiral_heatmap`, `market_lab`, `signal_robustness_lab`, `edge_half_life`, `pair_lab`, `parkinson_volatility`, `ema_respect`, `volume_delta`, `amihud_illiquidity`, `income_sankey`, `big_flow_monitor`, `positioning_dashboard`, `world_indices`. Focused regressions exercise selected loaded, incomplete, unavailable, and loss-making states; they do **not** prove every provider-driven state for all 175 registrations. No registry entry uses a placeholder loader.

The phone/desktop shared-shell and backup checks are recorded in [workspace acceptance](WORKSPACE_ACCEPTANCE_2026-09-27.md). Provider-specific TradingView iframe interiors, live-data chart labels and unusual native containers without targeted evidence remain outside that browser proof; the shell owns the outer frame, dimensions, loading/error state and control access, not third-party DOM.

## Observed render dispositions — non-financial family (2026-11-14)

Source-only family assignment above is not render proof. A local Chromium pass
mounted the 29 non-financial IDs in a saved workspace on a dev build and each
row records what that run rendered. **All 29 are listed below; the earlier
draft of this section omitted `insider_deal_timeline` and reported 28.**

Two runs happened and they are not interchangeable, which is how a wrong 28
count appeared:

- **Run A (no API)**: everything connected through the same client, so nine
  widgets displayed their connection-failure path. This is real evidence that
  the failure UI renders, but it says nothing about content states.
- **Run B (fixture API live)** is the canonical run below. Widths
  1440/1024/390/320 x light/dark; **no horizontal widget overflow at any width**.

Nothing here is a live-data or deployment claim. Evidence form is measured DOM
(`innerText`, `scrollWidth` vs `clientWidth`, `getComputedStyle`), not images -
screenshot capture timed out in this environment, so no visual artefacts exist.

| # | ID | State (Run B) | Observed text | Basis |
|---|----|---------------|---------------|-------|
| 1 | `ai_analysis` | content | "VniAgent Analysis … READY TO ANALYZE" | text |
| 2 | `alert_activity_inbox` | labelled-empty | "0 unread activity … not a durable email or push receipt" | text |
| 3 | `company_filings` | rendered | 99 chars, no error string | regex+len |
| 4 | `earnings_release_recap` | content | "Latest quarter … before drilling into the full statements" | text |
| 5 | `earnings_season_monitor` | content, field gap | "0 results · latest date unavailable" | text |
| 6 | `events_calendar` | rendered | 166 chars, no error string | regex+len |
| 7 | `insider_deal_timeline` | rendered | 114 chars, no error string | regex+len |
| 8 | `investor_event_calendar` | labelled-empty | "0 upcoming events 0/10 symbols … provider data shown as unavailable" | text |
| 9 | `market_news` | content | 9959 chars article list | text |
| 10 | `news_corporate_actions` | rendered | 125 chars | regex+len |
| 11 | `news_feed` | content | full feed, sentiment chips | text |
| 12 | `news_flow` | content | 10879 chars article cards | text |
| 13 | `notes` | labelled-empty | "Thesis · VCI … Due 0 … 0/6" | text |
| 14 | `price_alerts` | labelled-empty | "0 active … Checks run only while this page is open" | text |
| 15 | `research_browser` | content | "External Intelligence Hub SOURCE …" | text |
| 16 | `subsidiaries` | rendered | 87 chars | regex+len |
| 17 | `world_news_live_stream` | content | "POLLING STREAM … Polling every 60s" | text |
| 18 | `world_news_monitor` | content | "LIVE SOURCE LINKS … Live RSS/Atom sources" | text |
| 19 | `world_news_sources` | content | "SOURCE REGISTRY 0 sources / 0 feeds" | text |
| 20 | `alert_settings` | error | "Something Went Wrong Server error. … Try Again" | text |
| 21 | `database_inspector` | gate | "Admin access required. Sign in with an authorized operator account." | text |
| 22 | `source_transparent_research_notebook` | labelled-empty | "No pinned research yet … Everything stays browser-local" | text |
| 23 | `market_overview` | rendered | 111 chars | regex+len |
| 24 | `quick_stats` | error | "Something Went Wrong Quote unavailable. Try Again" | text |
| 25 | `market_breadth` | unavailable | "Market breadth unavailable. … Universe unavailable" | text |
| 26 | `market_sentiment` | content | "OVERALL MOOD Bullish … BULLISH 17 NEUTRAL 16 BEARISH 3" | text |
| 27 | `commodities` | rendered | 106 chars | regex+len |
| 28 | `forex_rates` | rendered | 112 chars | regex+len |
| 29 | `world_indices` | unavailable + named fallback | "Global index feed unavailable, using VN market index fallback" | text |

Counts from Run B: **24 render content or a labelled empty state, 5 show an
error/gate/unavailable state** (`alert_settings`, `database_inspector`,
`quick_stats`, `market_breadth`, `world_indices`). No widget was blank or
crashed at any width.

Rows marked "regex+len" were classified by the observation harness detecting no
error string plus a non-trivial text length - weaker than the text-confirmed
rows and not re-verified here because the services are shut down. In Run A those
same IDs showed connection-failure text; I am not claiming their Run B content
was read in full.

Brand surfaces checked in Run B: direction colour confined to sentiment
surfaces; notebook Export moved off the gain surface; sentiment labels measure
12 px (`--font-size-sm`) in both the feed badge and the card meta row.

**Not proven:** provider-driven states for all 175 registrations; TradingView
iframe interiors; live provider data; Firefox/WebKit (no binaries offline).
Family membership is unchanged by this section.
