# Quant And Technical Widget Consolidation Plan

Date: 2026-05-13

## Goal

Consolidate VNIBB's existing technical and quant widget surface into clear analyst workflows, then ship the first database-backed microstructure widgets without breaking existing user dashboards, admin-managed system dashboards, widget settings, or stored widget configs.

## Compatibility Rules

- Do not rename or remove existing widget IDs.
- Add new widget IDs only; existing dashboards must keep rendering unchanged.
- Do not change widget config semantics for existing widgets.
- Do not write VNIBB-native dashboard, widget, user, session, or preference state to the database stack's shared market-data tier.
- Use the database stack only for shared raw/derived market data such as `market_intraday_trades`.
- Keep system dashboard changes additive. Admins still control draft/publish through existing global template flows.
- Label proxy data honestly: current footprint and CVD are `match_type_proxy`, not true bid/ask aggressor classification.

## Existing Widget Families

Execution and microstructure:

- `volume_delta`
- `volume_profile`
- `orderbook`
- `intraday_trades`
- `transaction_flow`
- `foreign_trading`
- `smart_money`

Trend and setup:

- `technical_snapshot`
- `technical_summary`
- `signal_summary`
- `momentum`
- `ema_respect`
- `macd_crossovers`
- `bollinger_squeeze`
- `ichimoku`
- `fibonacci`

Volatility and risk:

- `atr_regime`
- `parkinson_volatility`
- `risk_dashboard`
- `sortino_monthly`
- `drawdown_deep_dive`
- `drawdown_recovery`
- `amihud_illiquidity`

Regime, rotation, and seasonality:

- `hurst_market_structure`
- `relative_rotation`
- `correlation_matrix`
- `seasonality_heatmap` keeps one widget ID and now supports monthly, weekly, daily/weekday, and hourly modes. Monthly, weekly, and daily use adjusted historical prices; hourly uses database-backed intraday trades.
- `rsi_seasonal`
- `market_breadth`
- `sector_rotation_radar`

Synthesis and factor stack:

- `quant_summary`
- `earnings_quality`
- `gamma_exposure` currently remains a volatility-based gamma proxy until real options/open-interest data exists.

## Consolidation Decisions

- Keep all existing widgets for backward compatibility.
- Reframe overlapping widgets through metadata, templates, and documentation rather than deleting them.
- Treat `volume_delta` as the compact CVD/order-flow panel.
- Treat `volume_profile` as the POC/VAH/VAL panel.
- Treat `transaction_flow` as daily domestic/foreign/proprietary flow.
- Treat `smart_money` as a synthesis widget across institutional flow and block-trade signals.
- Treat `drawdown_deep_dive` as historical drawdown distribution and `drawdown_recovery` as current recovery-state context.
- Treat `gap_fill_stats` as compact probability and `gap_analysis` as deeper event table until a future `Gap Lab` merge is justified.

## First Shipping Slice

Ship two additive widgets backed by the existing `/api/v1/microstructure/{symbol}` endpoint and typed database-backed `market_intraday_trades` data.

Status: shipped on 2026-05-13.

New widget IDs:

- `vwap_bands`
- `footprint_proxy`

Backend work:

- Add `features` query parameter to `/api/v1/microstructure/{symbol}`.
- Load only needed database-stack inputs when features are specified.
- Existing behavior with no `features` remains unchanged.

Frontend work:

- Add `VWAPBandsWidget`.
- Add `FootprintProxyWidget`.
- Register both in `WidgetRegistry.ts`.
- Add both to `WidgetType` union.
- Add both to `widgetDefinitions.ts` as `quant` widgets.
- Add safe default layouts to `WidgetRegistry.ts` and `dashboardLayout.ts` if present.
- Add both to the `day-trader` template as optional execution context.

Shipped notes:

- Existing widget IDs and configs were not renamed or removed.
- New widget IDs are additive: `vwap_bands` and `footprint_proxy`.
- Existing user dashboards continue to reference the same widget IDs and config shapes.
- Existing system dashboard admin draft/publish behavior is unchanged.
- The `day-trader` template adds the new execution widgets for newly created dashboards; it does not mutate already persisted user dashboards by itself.
- `/api/v1/microstructure/{symbol}` now accepts `features` and preserves the original all-feature behavior when omitted.

## Future Widgets

High priority after the first slice:

- `order_flow_divergence`: price/CVD/VWAP divergence and absorption proxy.
- `opening_drive`: first 15/30/60 minute volume, range extension, VWAP location, and early CVD.
- `value_area_breakout`: current price relative to POC/VAH/VAL with acceptance/rejection state.
- `liquidity_participation`: trade count, average trade size, and participation versus normal volume.

Medium priority:

- `regime_dashboard_v2`: trend, volatility, Hurst, drawdown, and liquidity regime synthesis.
- `setup_scanner`: watchlist technical setup detector using squeeze, EMA reclaim, MACD cross, RSI seasonal, and volume confirmation.
- `factor_stack`: momentum, quality, risk, liquidity, flow, and valuation support composite.
- `anomaly_monitor`: abnormal return, volume, spread/depth proxy, foreign flow, block trades, and news velocity.

Defer:

- `liquidity_heatmap` until the database stack has time-stamped Level 2/depth snapshots.
- Real `gamma_exposure` until options open interest and strikes are available.

## Template Direction

Execution Desk / Day Trader:

- `price_chart`
- `volume_delta`
- `volume_profile`
- `vwap_bands`
- `footprint_proxy`
- `orderbook`
- `intraday_trades`

Swing Setup Lab:

- `price_chart`
- `signal_summary`
- `ema_respect`
- `bollinger_squeeze`
- `macd_crossovers`
- `atr_regime`
- `volume_profile`

Quant Risk Lab:

- `risk_dashboard`
- `drawdown_deep_dive`
- `sortino_monthly`
- `parkinson_volatility`
- `hurst_market_structure`
- `quant_summary`

Smart Money Monitor:

- `smart_money`
- `transaction_flow`
- `foreign_trading`
- `block_trade`
- `volume_delta`
- `volume_profile`

Regime And Rotation:

- `relative_rotation`
- `correlation_matrix`
- `market_breadth`
- `sector_rotation_radar`
- `money_flow_trend`
- `hurst_market_structure`

## Verification

Required focused checks after implementation:

```bash
python -m py_compile apps/api/vnibb/services/mongo_market_data_service.py apps/api/vnibb/services/microstructure_analysis.py apps/api/vnibb/api/v1/microstructure.py
pnpm --filter frontend lint
pnpm --filter frontend exec tsc --noEmit
```

Endpoint smoke examples:

```bash
GET /api/v1/microstructure/AAA?lookback_days=7&features=vwap
GET /api/v1/microstructure/AAA?lookback_days=7&features=footprint
GET /api/v1/microstructure/AAA?lookback_days=7&features=deep_trades,volume_profile
```
