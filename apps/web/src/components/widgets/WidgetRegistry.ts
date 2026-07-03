// Widget Registry - Central registration for all widgets
// Provides lazy loading and type-safe widget resolution

import { lazy, type ComponentType } from 'react';
import type { WidgetType } from '@/types/dashboard';

// Widget component type
export type WidgetComponent = ComponentType<WidgetProps>;

// Widget props (passed from WidgetWrapper)
export interface WidgetProps {
  id: string;
  symbol: string;
  widgetGroup?: string;
  onDataChange?: (data: unknown) => void;
  [key: string]: unknown;
}

// Registry entry
interface RegistryEntry {
  lazyComponent: () => Promise<{ default: ComponentType<any> }>;
  category: WidgetCategory;
  keywords?: string[];
}

export type WidgetCategory =
  | 'core_data'
  | 'charting'
  | 'global_markets'
  | 'calendar'
  | 'ownership'
  | 'estimates'
  | 'screener'
  | 'analysis'
  | 'quant'
  | 'news';

// Widget registry map
const widgetRegistry = new Map<WidgetType, RegistryEntry>();

// ============================================================================
// Registry Registration
// ============================================================================

/**
 * Register a widget component
 */
function registerWidget(
  type: WidgetType,
  loader: () => Promise<{ default: ComponentType<any> }>,
  category: WidgetCategory,
  keywords: string[] = []
) {
  widgetRegistry.set(type, {
    lazyComponent: loader,
    category,
    keywords,
  });
}

/**
 * Get widget category
 */
export function getWidgetCategory(type: WidgetType): WidgetCategory | undefined {
  return widgetRegistry.get(type)?.category;
}

/**
 * Check if widget is registered
 */
export function isWidgetRegistered(type: WidgetType): boolean {
  return widgetRegistry.has(type);
}

// ============================================================================
// Widget Components - Lazy Loaded
// ============================================================================

// Core Data Widgets
registerWidget(
  'ticker_info',
  () => import('./TickerInfoWidget'),
  'core_data',
  ['ticker', 'info', 'quote', 'price']
);

registerWidget(
  'key_metrics',
  async () => ({ default: (await import('./KeyMetricsWidget')).KeyMetricsWidget as ComponentType<any> }),
  'core_data',
  ['metrics', 'key', 'summary']
);

registerWidget(
  'ticker_profile',
  async () => ({ default: (await import('./TickerProfileWidget')).TickerProfileWidget as ComponentType<any> }),
  'core_data',
  ['profile', 'company']
);

// Charting Widgets
registerWidget(
  'price_chart',
  () => import('./PriceChartWidget'),
  'charting',
  ['chart', 'price', 'candle', 'candlestick']
);

registerWidget(
  'tradingview_chart',
  () => import('./TradingViewWidgets').then(m => ({ default: m.TradingViewChart })),
  'charting',
  ['tradingview', 'chart']
);

registerWidget(
  'volume_profile',
  () => import('./VolumeProfileWidget'),
  'charting',
  ['volume', 'profile', 'levels']
);

registerWidget(
  'vwap_bands',
  () => import('./VWAPBandsWidget'),
  'charting',
  ['vwap', 'bands', 'intraday']
);

// Financials Widgets
registerWidget(
  'financial_ratios',
  () => import('./FinancialsWidget'),
  'analysis',
  ['financial', 'ratios', 'pe', 'pb', 'roe']
);

registerWidget(
  'income_statement',
  () => import('./IncomeStatementWidget'),
  'analysis',
  ['income', 'statement', 'revenue', 'profit']
);

registerWidget(
  'balance_sheet',
  () => import('./BalanceSheetWidget'),
  'analysis',
  ['balance', 'sheet', 'assets', 'liabilities']
);

registerWidget(
  'cash_flow',
  () => import('./CashFlowWidget'),
  'analysis',
  ['cash', 'flow', 'fcf']
);

registerWidget(
  'unified_financials',
  () => import('./FinancialsWidget'),
  'analysis',
  ['financial', 'unified', 'statements']
);

// Quant Widgets
registerWidget(
  'seasonality_heatmap',
  () => import('./SeasonalityHeatmapWidget'),
  'quant',
  ['seasonality', 'heatmap', 'monthly']
);

registerWidget(
  'backtest_lab',
  () => import('./BacktestLabWidget'),
  'quant',
  ['backtest', 'lab', 'strategy']
);

registerWidget(
  'monte_carlo_lab',
  () => import('./MonteCarloLabWidget'),
  'quant',
  ['monte', 'carlo', 'simulation']
);

registerWidget(
  'risk_dashboard',
  () => import('./RiskDashboardWidget'),
  'quant',
  ['risk', 'dashboard', 'var']
);

// Market Widgets
registerWidget(
  'market_overview',
  () => import('./MarketOverviewWidget'),
  'core_data',
  ['market', 'overview', 'vnindex']
);

registerWidget(
  'market_heatmap',
  () => import('./MarketHeatmapWidget'),
  'core_data',
  ['heatmap', 'market', 'sector']
);

registerWidget(
  'top_movers',
  () => import('./TopMoversWidget'),
  'core_data',
  ['top', 'movers', 'gainers', 'losers']
);

// Screener Widgets
registerWidget(
  'screener',
  () => import('./ScreenerWidget'),
  'screener',
  ['screener', 'filter', 'scan']
);

// News Widgets
registerWidget(
  'news_feed',
  async () => ({ default: (await import('./NewsFeedWidget')).NewsFeedWidget as ComponentType<any> }),
  'news',
  ['news', 'feed']
);

registerWidget(
  'world_news_monitor',
  () => import('./WorldNewsMonitorWidget'),
  'news',
  ['world', 'news', 'monitor']
);

registerWidget(
  'world_news_map',
  () => import('./WorldNewsMapWidget'),
  'news',
  ['world', 'news', 'map', 'geo']
);

// Global Markets Widgets
registerWidget(
  'tradingview_ticker_tape',
  () => import('./TradingViewWidgets').then(m => ({ default: m.TradingViewTickerTape })),
  'global_markets',
  ['ticker', 'tape', 'tradingview']
);

registerWidget(
  'tradingview_market_overview',
  () => import('./TradingViewWidgets').then(m => ({ default: m.TradingViewMarketOverview })),
  'global_markets',
  ['market', 'overview', 'tradingview']
);

// Export registry for external use
export { widgetRegistry };
