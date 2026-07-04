'use client';

// Re-export TradingView widget components from TradingViewNativeWidgets.
// The WidgetRegistry expects named exports TradingViewChart, TradingViewTickerTape,
// TradingViewMarketOverview etc.; barrel re-export so every native component is
// reachable through this module's alias surface.
// eslint-disable-next-line import/no-unused-modules
export * from './TradingViewNativeWidgets';
