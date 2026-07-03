'use client';

// Re-export TradingView widget components from TradingViewNativeWidgets
// The WidgetRegistry expects TradingViewChart, TradingViewTickerTape, and TradingViewMarketOverview
// named exports from this module.

export {
  TradingViewChartWidget as TradingViewChart,
  TradingViewTickerTapeWidget as TradingViewTickerTape,
  TradingViewMarketOverviewWidget as TradingViewMarketOverview,
} from './TradingViewNativeWidgets';
