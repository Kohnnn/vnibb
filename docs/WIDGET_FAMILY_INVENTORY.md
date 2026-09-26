# Registered Widget fit families — 2026-09-27

The native workspace uses five primary content families for fit/overflow review. This is a **static source inventory**, not proof that every widget renders successfully with live data. Runtime registry: **174 unique IDs** (`WidgetRegistry.ts`); widget-library catalogue: **170 unique IDs** (145 inline plus 25 TradingView definitions). The four registry-only IDs are `market_heatmap`, `dividend_ladder`, `ai_copilot`, and `rs_ranking`. Family assignment is mutually exclusive by dominant surface; mixed table/chart widgets are assigned to the more demanding presentation. TradingView embeds are always custom/third-party even if their contents depict a chart or table.

## Dense table / board (34)

`analyst_estimates`, `balance_sheet`, `bank_metrics`, `cash_flow`, `comparison_analysis`, `derivatives_contracts_board`, `dividend_payment`, `earnings_history`, `financial_ratios`, `financial_snapshot`, `foreign_flow_leaderboard`, `foreign_trading`, `income_statement`, `insider_trading`, `intraday_trades`, `listing_browser`, `major_shareholders`, `market_movers_sectors`, `officers_management`, `orderbook`, `ownership_changes`, `peer_comparison`, `rs_ranking`, `screener`, `sector_board`, `sector_breakdown`, `sector_top_movers`, `stock_splits`, `sweep_matrix`, `top_movers`, `transaction_flow`, `unified_financials`, `watchlist`, `watchlist_limits_monitor`.

## Native chart / plotted view (52)

`amihud_illiquidity`, `atr_regime`, `backtest_lab`, `bollinger_squeeze`, `cashflow_waterfall`, `consensus_odds`, `correlation_matrix`, `cross_source_calibration`, `derivatives_price_history`, `drawdown_deep_dive`, `drawdown_recovery`, `election_odds`, `ema_respect`, `fibonacci`, `footprint_proxy`, `gamma_exposure`, `gap_analysis`, `gap_fill_stats`, `garch_volatility`, `growth_bridge`, `hurst_market_structure`, `ichimoku`, `income_sankey`, `index_comparison`, `industry_bubble`, `macd_crossovers`, `macro_calibration`, `market_heatmap`, `market_structure`, `momentum`, `money_flow_trend`, `monte_carlo_lab`, `obv_divergence`, `ownership_rating_summary`, `parkinson_volatility`, `price_chart`, `relative_rotation`, `rsi_seasonal`, `seasonality_heatmap`, `seasonality_spiral_heatmap`, `sector_performance`, `sector_rotation_radar`, `signal_summary`, `sortino_monthly`, `technical_snapshot`, `valuation_band`, `valuation_multiples_chart`, `volume_analysis`, `volume_delta`, `volume_flow`, `volume_profile`, `vwap_bands`.

## Compact KPI / summary (31)

`big_flow_monitor`, `block_trade`, `commodities`, `derivatives_analytics`, `earnings_quality`, `edge_half_life`, `forex_rates`, `fundamental_analysis`, `key_metrics`, `market_breadth`, `market_lab`, `market_overview`, `market_sentiment`, `pair_lab`, `portfolio_tracker`, `positioning_dashboard`, `quant_summary`, `quick_stats`, `risk_dashboard`, `share_statistics`, `signal_robustness_lab`, `similar_stocks`, `smart_money`, `source_drift`, `technical_summary`, `ticker_info`, `ticker_profile`, `top_movers_pulse`, `ttm_snapshot`, `valuation_lab`, `world_indices`.

## News / record list (27)

`ai_analysis`, `alert_activity_inbox`, `company_filings`, `dividend_ladder`, `earnings_release_recap`, `earnings_season_monitor`, `events_calendar`, `insider_deal_timeline`, `investor_event_calendar`, `kalshi`, `limitless`, `manifold`, `market_news`, `news_corporate_actions`, `news_feed`, `news_flow`, `notes`, `polymarket`, `prediction_alerts`, `prediction_movers`, `predictit`, `price_alerts`, `research_browser`, `subsidiaries`, `world_news_live_stream`, `world_news_monitor`, `world_news_sources`.

## Custom interaction / third-party embed (30)

`ai_copilot`, `alert_settings`, `database_inspector`, `source_transparent_research_notebook`, `tradingview_chart`, `tradingview_company_profile`, `tradingview_crypto_heatmap`, `tradingview_crypto_market`, `tradingview_economic_calendar`, `tradingview_economic_map`, `tradingview_etf_heatmap`, `tradingview_forex_cross_rates`, `tradingview_forex_heatmap`, `tradingview_fundamental_data`, `tradingview_market_data`, `tradingview_market_overview`, `tradingview_market_summary`, `tradingview_mini_chart`, `tradingview_screener`, `tradingview_single_ticker`, `tradingview_stock_heatmap`, `tradingview_stock_market`, `tradingview_symbol_info`, `tradingview_symbol_overview`, `tradingview_technical_analysis`, `tradingview_ticker`, `tradingview_ticker_tag`, `tradingview_ticker_tape`, `tradingview_top_stories`, `world_news_map`.

## Exceptions and proof boundary

13 entries still route through `placeholderLoader` rather than their named modules: `seasonality_spiral_heatmap`, `market_lab`, `signal_robustness_lab`, `edge_half_life`, `pair_lab`, `parkinson_volatility`, `ema_respect`, `volume_delta`, `amihud_illiquidity`, `income_sankey`, `big_flow_monitor`, `positioning_dashboard`, `world_indices`. They are classified by intended surface only; **no rendered-data claim is made for them**. The initial registry mount smoke test excludes placeholders and parks networked widgets in loading state, so it does not demonstrate loaded or error→success behavior.

The phone/desktop shared-shell and backup checks are recorded in [workspace acceptance](WORKSPACE_ACCEPTANCE_2026-09-27.md). Provider-specific TradingView iframe interiors, live-data chart labels and unusual native containers remain outside that browser proof; the shell is responsible for the outer frame, dimensions, loading/error state and control access, not third-party DOM.
