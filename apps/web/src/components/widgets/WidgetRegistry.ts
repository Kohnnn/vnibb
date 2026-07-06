// Widget Registry - Central registration for all widgets
// Provides lazy loading and type-safe widget resolution
//
// The registry is the single source of truth for what widget IDs are
// resolvable. The catalogue in apps/web/src/data/widgetDefinitions.ts is the
// single source of truth for what widget IDs are exposed in the library UI.
// In dev builds a completeness check at module init warns when the two
// diverge so we catch "widget not found" regressions at build time.

import { type ComponentType, createElement as _createElement } from 'react';
import * as React from 'react';
import type { WidgetType } from '@/types/dashboard';

const createElement = React.createElement ?? _createElement;

export type WidgetComponent = ComponentType<WidgetProps>;

export interface WidgetProps {
  id: string;
  symbol: string;
  widgetGroup?: string;
  onDataChange?: (data: unknown) => void;
  [key: string]: unknown;
}

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
  | 'news'
  | 'prediction_markets';

const widgetRegistry = new Map<WidgetType, RegistryEntry>();

/**
 * Register a widget component.
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

export function getWidgetCategory(type: WidgetType): WidgetCategory | undefined {
  return widgetRegistry.get(type)?.category;
}

export function isWidgetRegistered(type: WidgetType): boolean {
  return widgetRegistry.has(type);
}

/**
 * Lazy helper that adapts the named-export convention some widgets use.
 */
function lazyNamed(
  importer: () => Promise<Record<string, unknown>>,
  exportName: string
): () => Promise<{ default: ComponentType<any> }> {
  return async () => {
    const mod = await importer();
    const named = mod[exportName];
    const isComponent =
      typeof named === 'function' ||
      (typeof named === 'object' && named !== null && '$$typeof' in named);
    if (!isComponent) {
      throw new Error(`WidgetRegistry: '${exportName}' missing from dynamic import`);
    }
    return { default: named as ComponentType<any> };
  };
}

/**
 * Generic fallback for widgets whose component file exists but is not yet
 * registered. We render a tiny placeholder so dashboards still load even if
 * a specific widget is missing.
 */
function placeholderLoader(type: WidgetType) {
  return async () => ({
    default: function PlaceholderWidget(_props: WidgetProps) {
      // Plain DOM element to keep this module ESM-pure and avoid pulling in
      // JSX runtime at module-evaluation time.
      return createElement(
        'div',
        {
          className: 'flex h-full items-center justify-center p-4 text-xs text-[var(--text-muted)]',
        },
        `Widget "${type}" is registered but its component module is not yet wired.`
      );
    } as ComponentType<any>,
  });
}

/**
 * Dev-only completeness check: warn when widgetDefinitions.ts exposes an ID
 * that the registry has never seen. This is what previously surfaced as the
 * "Polymarket widget not found" console message — a catalogue/registry
 * divergence that survived into production.
 */
function runDevCompletenessCheck() {
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
    return;
  }

  (async () => {
    try {
      const defs = await import('@/data/widgetDefinitions');
      const defined: string[] = Array.isArray(defs.widgetDefinitions)
        ? defs.widgetDefinitions.map((entry: { type: string }) => entry.type)
        : [];
      const registered = Array.from(widgetRegistry.keys());
      const missing = defined.filter((id) => !widgetRegistry.has(id as WidgetType));
      if (missing.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[WidgetRegistry] ${missing.length} widget IDs in widgetDefinitions.ts are not registered:`,
          missing
        );
      }
      const orphans = registered.filter((id) => !defined.includes(id as string));
      if (orphans.length > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[WidgetRegistry] ${orphans.length} widget IDs are registered but not exposed in widgetDefinitions.ts:`,
          orphans
        );
      }
    } catch (error) {
      // widgetDefinitions could not be loaded (e.g. in unit tests); quiet.
      // eslint-disable-next-line no-console
      console.warn('[WidgetRegistry] completeness check failed:', error);
    }
  })();
}

// ============================================================================
// Widget Components - Lazy Loaded
// ============================================================================

// --- Core Data ---
registerWidget('ticker_info', () => import('./TickerInfoWidget'), 'core_data', ['ticker', 'info']);
registerWidget(
  'key_metrics',
  lazyNamed(() => import('./KeyMetricsWidget'), 'KeyMetricsWidget'),
  'core_data',
  ['metrics', 'key', 'summary']
);
registerWidget(
  'ticker_profile',
  lazyNamed(() => import('./TickerProfileWidget'), 'TickerProfileWidget'),
  'core_data',
  ['profile', 'company']
);
registerWidget(
  'share_statistics',
  lazyNamed(() => import('./ShareStatisticsWidget'), 'ShareStatisticsWidget'),
  'core_data',
  ['share', 'statistics', 'shares']
);
registerWidget(
  'news_feed',
  lazyNamed(() => import('./NewsFeedWidget'), 'NewsFeedWidget'),
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
registerWidget(
  'world_news_live_stream',
  placeholderLoader('world_news_live_stream'),
  'news',
  ['world', 'news', 'live', 'stream']
);
registerWidget(
  'world_news_sources',
  placeholderLoader('world_news_sources'),
  'global_markets',
  ['world', 'news', 'sources']
);
registerWidget('market_overview', () => import('./MarketOverviewWidget'), 'core_data', ['market', 'overview']);
registerWidget('market_heatmap', () => import('./MarketHeatmapWidget'), 'core_data', ['heatmap', 'market', 'sector']);
registerWidget('top_movers', () => import('./TopMoversWidget'), 'core_data', ['top', 'movers', 'gainers', 'losers']);
registerWidget('screener', () => import('./ScreenerWidget'), 'screener', ['screener', 'filter', 'scan']);
registerWidget(
  'intraday_trades',
  () => import('./IntradayTradesWidget'),
  'core_data',
  ['intraday', 'trades', 'order', 'flow']
);
registerWidget(
  'financial_ratios',
  () => import('./FinancialsWidget'),
  'analysis',
  ['financial', 'ratios']
);
registerWidget(
  'unified_financials',
  () => import('./FinancialsWidget'),
  'analysis',
  ['financial', 'unified', 'statements']
);
registerWidget('balance_sheet', () => import('./BalanceSheetWidget'), 'analysis', ['balance', 'sheet', 'assets', 'liabilities']);
registerWidget('income_statement', () => import('./IncomeStatementWidget'), 'analysis', ['income', 'statement', 'revenue']);
registerWidget('cash_flow', () => import('./CashFlowWidget'), 'analysis', ['cash', 'flow', 'fcf']);
registerWidget(
  'financial_snapshot',
  () => import('./FinancialSnapshotWidget'),
  'analysis',
  ['snapshot', 'ttm', 'fundamentals']
);
registerWidget('watchlist', () => import('./WatchlistWidget'), 'core_data', ['watchlist', 'list']);
registerWidget(
  'peer_comparison',
  lazyNamed(() => import('./PeerComparisonWidget'), 'PeerComparisonWidget'),
  'analysis',
  ['peer', 'comparison', 'peers']
);
registerWidget(
  'similar_stocks',
  lazyNamed(() => import('./SimilarStocksWidget'), 'SimilarStocksWidget'),
  'core_data',
  ['similar', 'stocks', 'peers']
);
registerWidget(
  'quick_stats',
  lazyNamed(() => import('./QuickStatsWidget'), 'QuickStatsWidget'),
  'core_data',
  ['quick', 'stats', 'summary']
);
registerWidget('notes', lazyNamed(() => import('./NotesWidget'), 'NotesWidget'), 'core_data', ['notes']);
registerWidget(
  'market_sentiment',
  lazyNamed(() => import('./MarketSentimentWidget'), 'MarketSentimentWidget'),
  'analysis',
  ['sentiment', 'mood']
);
registerWidget(
  'ttm_snapshot',
  lazyNamed(() => import('./TTMSnapshotWidget'), 'TTMSnapshotWidget'),
  'analysis',
  ['ttm', 'snapshot', 'trailing']
);
registerWidget(
  'growth_bridge',
  lazyNamed(() => import('./GrowthBridgeWidget'), 'GrowthBridgeWidget'),
  'analysis',
  ['growth', 'bridge']
);
registerWidget(
  'ownership_rating_summary',
  lazyNamed(() => import('./OwnershipRatingSummaryWidget'), 'OwnershipRatingSummaryWidget'),
  'analysis',
  ['ownership', 'rating', 'summary']
);
registerWidget(
  'derivatives_analytics',
  lazyNamed(() => import('./DerivativesAnalyticsWidget'), 'DerivativesAnalyticsWidget'),
  'analysis',
  ['derivatives', 'analytics']
);
registerWidget(
  'sector_performance',
  lazyNamed(() => import('./SectorPerformanceWidget'), 'SectorPerformanceWidget'),
  'core_data',
  ['sector', 'performance']
);
registerWidget(
  'sector_rotation_radar',
  lazyNamed(() => import('./SectorRotationRadarWidget'), 'SectorRotationRadarWidget'),
  'core_data',
  ['sector', 'rotation', 'radar']
);
registerWidget(
  'market_movers_sectors',
  lazyNamed(() => import('./MarketMoversSectorsWidget'), 'MarketMoversSectorsWidget'),
  'core_data',
  ['market', 'movers', 'sectors']
);
registerWidget(
  'market_breadth',
  lazyNamed(() => import('./MarketBreadthWidget'), 'MarketBreadthWidget'),
  'core_data',
  ['market', 'breadth']
);
registerWidget(
  'portfolio_tracker',
  lazyNamed(() => import('./PortfolioTrackerWidget'), 'PortfolioTrackerWidget'),
  'core_data',
  ['portfolio', 'tracker', 'positions']
);
registerWidget(
  'price_alerts',
  lazyNamed(() => import('./PriceAlertsWidget'), 'PriceAlertsWidget'),
  'core_data',
  ['alerts', 'price']
);
registerWidget(
  'research_browser',
  lazyNamed(() => import('./ResearchBrowserWidget'), 'ResearchBrowserWidget'),
  'analysis',
  ['research', 'browser']
);
registerWidget(
  'listing_browser',
  lazyNamed(() => import('./ListingBrowserWidget'), 'ListingBrowserWidget'),
  'screener',
  ['listing', 'universe', 'browser']
);
registerWidget(
  'fundamental_analysis',
  lazyNamed(() => import('./FundamentalAnalysisWidget'), 'FundamentalAnalysisWidget'),
  'analysis',
  ['fundamental', 'analysis', 'thesis']
);
registerWidget(
  'database_inspector',
  lazyNamed(() => import('./DatabaseInspectorWidget'), 'DatabaseInspectorWidget'),
  'core_data',
  ['database', 'inspector']
);

// --- Charting ---
registerWidget('price_chart', () => import('./PriceChartWidget'), 'charting', ['chart', 'price', 'candle']);
registerWidget('tradingview_chart', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewChart })), 'charting', ['tradingview', 'chart']);
registerWidget('tradingview_symbol_overview', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewSymbolOverview })), 'charting', ['tradingview', 'symbol', 'overview']);
registerWidget('tradingview_mini_chart', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewMiniChart })), 'charting', ['tradingview', 'mini', 'chart']);
registerWidget('tradingview_market_summary', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewMarketSummary })), 'charting', ['tradingview', 'market', 'summary']);
registerWidget('tradingview_market_overview', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewMarketOverview })), 'charting', ['tradingview', 'market', 'overview']);
registerWidget('tradingview_stock_market', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewStockMarket })), 'charting', ['tradingview', 'stock', 'market']);
registerWidget('tradingview_market_data', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewMarketData })), 'charting', ['tradingview', 'market', 'data']);
registerWidget('tradingview_ticker_tape', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewTickerTape })), 'global_markets', ['tradingview', 'ticker', 'tape']);
registerWidget('tradingview_ticker_tag', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewTickerTag })), 'charting', ['tradingview', 'ticker', 'tag']);
registerWidget('tradingview_single_ticker', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewSingleTicker })), 'charting', ['tradingview', 'ticker']);
registerWidget('tradingview_ticker', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewTicker })), 'charting', ['tradingview', 'ticker']);
registerWidget('tradingview_stock_heatmap', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewStockHeatmap })), 'charting', ['tradingview', 'stock', 'heatmap']);
registerWidget('tradingview_crypto_heatmap', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewCryptoHeatmap })), 'charting', ['tradingview', 'crypto', 'heatmap']);
registerWidget('tradingview_forex_cross_rates', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewForexCrossRates })), 'global_markets', ['tradingview', 'forex', 'cross', 'rates']);
registerWidget('tradingview_etf_heatmap', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewEtfHeatmap })), 'charting', ['tradingview', 'etf', 'heatmap']);
registerWidget('tradingview_forex_heatmap', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewForexHeatmap })), 'charting', ['tradingview', 'forex', 'heatmap']);
registerWidget('tradingview_screener', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewScreener })), 'screener', ['tradingview', 'screener']);
registerWidget('tradingview_crypto_market', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewCryptoMarket })), 'charting', ['tradingview', 'crypto', 'market']);
registerWidget('tradingview_symbol_info', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewSymbolInfo })), 'charting', ['tradingview', 'symbol', 'info']);
registerWidget('tradingview_technical_analysis', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewTechnicalAnalysis })), 'charting', ['tradingview', 'technical', 'analysis']);
registerWidget('tradingview_fundamental_data', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewFundamentalData })), 'charting', ['tradingview', 'fundamental', 'data']);
registerWidget('tradingview_company_profile', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewCompanyProfile })), 'charting', ['tradingview', 'company', 'profile']);
registerWidget('tradingview_top_stories', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewTopStories })), 'news', ['tradingview', 'top', 'stories']);
registerWidget('tradingview_economic_calendar', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewEconomicCalendar })), 'calendar', ['tradingview', 'economic', 'calendar']);
registerWidget('tradingview_economic_map', () => import('./TradingViewWidgets').then((m) => ({ default: (m as Record<string, ComponentType<any>>).TradingViewEconomicMap })), 'global_markets', ['tradingview', 'economic', 'map']);
registerWidget('valuation_multiples_chart', placeholderLoader('valuation_multiples_chart'), 'charting', ['valuation', 'multiples']);
registerWidget('valuation_band', placeholderLoader('valuation_band'), 'charting', ['valuation', 'band']);
registerWidget('volume_profile', () => import('./VolumeProfileWidget'), 'charting', ['volume', 'profile']);
registerWidget('vwap_bands', () => import('./VWAPBandsWidget'), 'charting', ['vwap', 'bands']);
registerWidget('technical_summary', placeholderLoader('technical_summary'), 'charting', ['technical', 'summary']);
registerWidget(
  'technical_snapshot',
  lazyNamed(() => import('./TechnicalSnapshotWidget'), 'TechnicalSnapshotWidget'),
  'charting',
  ['technical', 'snapshot']
);
registerWidget('signal_summary', placeholderLoader('signal_summary'), 'charting', ['signal', 'summary']);
registerWidget('ichimoku', placeholderLoader('ichimoku'), 'charting', ['ichimoku', 'cloud']);
registerWidget('fibonacci', placeholderLoader('fibonacci'), 'charting', ['fibonacci', 'retracement']);
registerWidget(
  'market_structure',
  lazyNamed(() => import('./MarketStructureWidget'), 'MarketStructureWidget'),
  'charting',
  ['market', 'structure', 'volume profile']
);

// --- Calendar / Ownership / Estimates ---
registerWidget(
  'earnings_history',
  lazyNamed(() => import('./EarningsHistoryWidget'), 'EarningsHistoryWidget'),
  'calendar',
  ['earnings', 'history']
);
registerWidget(
  'earnings_release_recap',
  lazyNamed(() => import('./EarningsReleaseRecapWidget'), 'EarningsReleaseRecapWidget'),
  'calendar',
  ['earnings', 'recap', 'release']
);
registerWidget('earnings_season_monitor', placeholderLoader('earnings_season_monitor'), 'calendar', ['earnings', 'season']);
registerWidget(
  'events_calendar',
  lazyNamed(() => import('./EventsCalendarWidget'), 'EventsCalendarWidget'),
  'calendar',
  ['events', 'calendar']
);
registerWidget(
  'dividend_payment',
  lazyNamed(() => import('./DividendPaymentWidget'), 'DividendPaymentWidget'),
  'calendar',
  ['dividend', 'payment']
);
registerWidget(
  'stock_splits',
  lazyNamed(() => import('./StockSplitsWidget'), 'StockSplitsWidget'),
  'calendar',
  ['stock', 'splits']
);
registerWidget(
  'company_filings',
  lazyNamed(() => import('./CompanyFilingsWidget'), 'CompanyFilingsWidget'),
  'calendar',
  ['company', 'filings']
);
registerWidget('dividend_ladder', lazyNamed(() => import('./DividendLadderWidget'), 'DividendLadderWidget'), 'calendar', ['dividend', 'ladder']);
registerWidget(
  'insider_trading',
  lazyNamed(() => import('./InsiderTradingWidget'), 'InsiderTradingWidget'),
  'ownership',
  ['insider', 'trading']
);
registerWidget(
  'major_shareholders',
  lazyNamed(() => import('./MajorShareholdersWidget'), 'MajorShareholdersWidget'),
  'ownership',
  ['major', 'shareholders']
);
registerWidget(
  'officers_management',
  lazyNamed(() => import('./OfficersManagementWidget'), 'OfficersManagementWidget'),
  'ownership',
  ['officers', 'management']
);
registerWidget(
  'foreign_trading',
  lazyNamed(() => import('./ForeignTradingWidget'), 'ForeignTradingWidget'),
  'ownership',
  ['foreign', 'trading']
);
registerWidget(
  'subsidiaries',
  lazyNamed(() => import('./SubsidiariesWidget'), 'SubsidiariesWidget'),
  'ownership',
  ['subsidiaries']
);
registerWidget(
  'insider_deal_timeline',
  lazyNamed(() => import('./InsiderDealTimelineWidget'), 'InsiderDealTimelineWidget'),
  'ownership',
  ['insider', 'deal', 'timeline']
);
registerWidget(
  'block_trade',
  lazyNamed(() => import('./BlockTradeWidget'), 'BlockTradeWidget'),
  'ownership',
  ['block', 'trade', 'large', 'orders']
);
registerWidget(
  'ownership_changes',
  lazyNamed(() => import('./OwnershipChangesWidget'), 'OwnershipChangesWidget'),
  'ownership',
  ['ownership', 'changes']
);
registerWidget(
  'analyst_estimates',
  lazyNamed(() => import('./AnalystEstimatesWidget'), 'AnalystEstimatesWidget'),
  'estimates',
  ['analyst', 'estimates']
);
registerWidget('valuation_lab', lazyNamed(() => import('./ValuationLabWidget'), 'ValuationLabWidget'), 'estimates', ['valuation', 'dcf']);

// --- Quant ---
registerWidget('seasonality_heatmap', () => import('./SeasonalityHeatmapWidget'), 'quant', ['seasonality', 'heatmap']);
registerWidget('seasonality_spiral_heatmap', placeholderLoader('seasonality_spiral_heatmap'), 'quant', ['spiral', 'seasonality']);
registerWidget('backtest_lab', () => import('./BacktestLabWidget'), 'quant', ['backtest', 'lab']);
registerWidget('monte_carlo_lab', () => import('./MonteCarloLabWidget'), 'quant', ['monte', 'carlo']);
registerWidget('risk_dashboard', () => import('./RiskDashboardWidget'), 'quant', ['risk', 'dashboard']);
registerWidget('quant_summary', placeholderLoader('quant_summary'), 'quant', ['quant', 'summary']);
registerWidget('market_lab', placeholderLoader('market_lab'), 'quant', ['market', 'lab']);
registerWidget('signal_robustness_lab', placeholderLoader('signal_robustness_lab'), 'quant', ['signal', 'robustness']);
registerWidget('edge_half_life', placeholderLoader('edge_half_life'), 'quant', ['edge', 'half', 'life']);
registerWidget('pair_lab', placeholderLoader('pair_lab'), 'quant', ['pair', 'lab']);
registerWidget('sweep_matrix', () => import('./SweepMatrixWidget'), 'quant', ['sweep', 'matrix']);
registerWidget(
  'volume_flow',
  lazyNamed(() => import('./VolumeFlowWidget'), 'VolumeFlowWidget'),
  'quant',
  ['volume', 'flow']
);
registerWidget(
  'rsi_seasonal',
  lazyNamed(() => import('./RSISeasonalWidget'), 'RSISeasonalWidget'),
  'quant',
  ['rsi', 'seasonal']
);
registerWidget(
  'bollinger_squeeze',
  lazyNamed(() => import('./BollingerSqueezeWidget'), 'BollingerSqueezeWidget'),
  'quant',
  ['bollinger', 'squeeze']
);
registerWidget(
  'sortino_monthly',
  lazyNamed(() => import('./SortinoMonthlyWidget'), 'SortinoMonthlyWidget'),
  'quant',
  ['sortino', 'monthly']
);
registerWidget(
  'gap_analysis',
  lazyNamed(() => import('./GapAnalysisWidget'), 'GapAnalysisWidget'),
  'quant',
  ['gap', 'analysis']
);
registerWidget(
  'macd_crossovers',
  lazyNamed(() => import('./MACDCrossoverWidget'), 'MACDCrossoverWidget'),
  'quant',
  ['macd', 'crossovers']
);
registerWidget('parkinson_volatility', placeholderLoader('parkinson_volatility'), 'quant', ['parkinson', 'volatility']);
registerWidget(
  'garch_volatility',
  lazyNamed(() => import('./GarchVolatilityWidget'), 'GarchVolatilityWidget'),
  'quant',
  ['garch', 'volatility']
);
registerWidget('ema_respect', placeholderLoader('ema_respect'), 'quant', ['ema', 'respect']);
registerWidget('drawdown_recovery', placeholderLoader('drawdown_recovery'), 'quant', ['drawdown', 'recovery']);
registerWidget(
  'gamma_exposure',
  lazyNamed(() => import('./GammaExposureWidget'), 'GammaExposureWidget'),
  'quant',
  ['gamma', 'exposure']
);
registerWidget(
  'momentum',
  lazyNamed(() => import('./MomentumWidget'), 'MomentumWidget'),
  'quant',
  ['momentum']
);
registerWidget(
  'earnings_quality',
  lazyNamed(() => import('./EarningsQualityWidget'), 'EarningsQualityWidget'),
  'quant',
  ['earnings', 'quality']
);
registerWidget(
  'smart_money',
  lazyNamed(() => import('./SmartMoneyWidget'), 'SmartMoneyWidget'),
  'quant',
  ['smart', 'money', 'institutional']
);
registerWidget(
  'relative_rotation',
  lazyNamed(() => import('./RelativeRotationWidget'), 'RelativeRotationWidget'),
  'quant',
  ['relative', 'rotation']
);
registerWidget(
  'drawdown_deep_dive',
  lazyNamed(() => import('./DrawdownDeepDiveWidget'), 'DrawdownDeepDiveWidget'),
  'quant',
  ['drawdown', 'deep', 'dive']
);
registerWidget(
  'hurst_market_structure',
  lazyNamed(() => import('./HurstMarketStructureWidget'), 'HurstMarketStructureWidget'),
  'quant',
  ['hurst', 'market', 'structure']
);
registerWidget('volume_analysis', placeholderLoader('volume_analysis'), 'quant', ['volume', 'analysis']);
registerWidget('obv_divergence', placeholderLoader('obv_divergence'), 'quant', ['obv', 'divergence']);
registerWidget('atr_regime', placeholderLoader('atr_regime'), 'quant', ['atr', 'regime']);
registerWidget('gap_fill_stats', placeholderLoader('gap_fill_stats'), 'quant', ['gap', 'fill']);
registerWidget('volume_delta', placeholderLoader('volume_delta'), 'quant', ['volume', 'delta']);
registerWidget('footprint_proxy', placeholderLoader('footprint_proxy'), 'quant', ['footprint', 'proxy']);
registerWidget('amihud_illiquidity', placeholderLoader('amihud_illiquidity'), 'quant', ['amihud', 'illiquidity']);

// --- Analysis / Screener ---
registerWidget('bank_metrics', placeholderLoader('bank_metrics'), 'analysis', ['bank', 'metrics']);
registerWidget('transaction_flow', placeholderLoader('transaction_flow'), 'analysis', ['transaction', 'flow']);
registerWidget('industry_bubble', placeholderLoader('industry_bubble'), 'analysis', ['industry', 'bubble']);
registerWidget('sector_board', placeholderLoader('sector_board'), 'analysis', ['sector', 'board']);
registerWidget('money_flow_trend', placeholderLoader('money_flow_trend'), 'analysis', ['money', 'flow']);
registerWidget('correlation_matrix', placeholderLoader('correlation_matrix'), 'analysis', ['correlation', 'matrix']);
registerWidget('ai_copilot', lazyNamed(() => import('./AICopilotWidget'), 'AICopilotWidget'), 'analysis', ['ai', 'copilot']);
registerWidget('ai_analysis', lazyNamed(() => import('./AIAnalysisWidget'), 'AIAnalysisWidget'), 'analysis', ['ai', 'analysis']);
registerWidget('rs_ranking', lazyNamed(() => import('./RSRankingWidget'), 'RSRankingWidget'), 'analysis', ['rs', 'ranking']);
registerWidget('sector_top_movers', lazyNamed(() => import('./SectorTopMoversWidget'), 'SectorTopMoversWidget'), 'analysis', ['sector', 'top', 'movers']);
registerWidget('orderbook', lazyNamed(() => import('./OrderbookWidget'), 'OrderbookWidget'), 'analysis', ['orderbook', 'depth']);
registerWidget('index_comparison', lazyNamed(() => import('./IndexComparisonWidget'), 'IndexComparisonWidget'), 'analysis', ['index', 'comparison']);
registerWidget('market_news', lazyNamed(() => import('./MarketNewsWidget'), 'MarketNewsWidget'), 'news', ['market', 'news']);
registerWidget('sector_breakdown', lazyNamed(() => import('./SectorBreakdownWidget'), 'SectorBreakdownWidget'), 'analysis', ['sector', 'breakdown']);
registerWidget('comparison_analysis', lazyNamed(() => import('./ComparisonAnalysisWidget'), 'ComparisonAnalysisWidget'), 'analysis', ['comparison', 'analysis']);
registerWidget('news_flow', lazyNamed(() => import('./NewsFlowWidget'), 'NewsFlowWidget'), 'news', ['news', 'flow']);
registerWidget('news_corporate_actions', lazyNamed(() => import('./NewsCorporateActionsWidget'), 'NewsCorporateActionsWidget'), 'news', ['news', 'corporate', 'actions']);
registerWidget('income_sankey', placeholderLoader('income_sankey'), 'analysis', ['income', 'sankey']);
registerWidget('cashflow_waterfall', placeholderLoader('cashflow_waterfall'), 'analysis', ['cashflow', 'waterfall']);
registerWidget('derivatives_contracts_board', lazyNamed(() => import('./DerivativesContractsBoardWidget'), 'DerivativesContractsBoardWidget'), 'global_markets', ['derivatives', 'contracts']);
registerWidget('derivatives_price_history', lazyNamed(() => import('./DerivativesPriceHistoryWidget'), 'DerivativesPriceHistoryWidget'), 'global_markets', ['derivatives', 'price', 'history']);
registerWidget('big_flow_monitor', placeholderLoader('big_flow_monitor'), 'ownership', ['big', 'flow', 'monitor']);
registerWidget('alert_settings', placeholderLoader('alert_settings'), 'analysis', ['alert', 'settings']);
registerWidget('positioning_dashboard', placeholderLoader('positioning_dashboard'), 'ownership', ['positioning', 'dashboard']);
registerWidget('source_transparent_research_notebook', placeholderLoader('source_transparent_research_notebook'), 'analysis', ['notebook', 'research']);

// --- Global Markets ---
registerWidget('forex_rates', lazyNamed(() => import('./ForexRatesWidget'), 'ForexRatesWidget'), 'global_markets', ['forex', 'rates']);
registerWidget('commodities', lazyNamed(() => import('./CommoditiesWidget'), 'CommoditiesWidget'), 'global_markets', ['commodities', 'gold', 'oil']);
registerWidget('world_indices', placeholderLoader('world_indices'), 'global_markets', ['world', 'indices']);
registerWidget(
  'polymarket',
  lazyNamed(() => import('./PolymarketWidget'), 'PolymarketWidget'),
  'prediction_markets',
  ['polymarket', 'prediction', 'odds']
);
registerWidget(
  'kalshi',
  lazyNamed(() => import('./KalshiWidget'), 'KalshiWidget'),
  'prediction_markets',
  ['kalshi', 'prediction', 'odds']
);
registerWidget(
  'election_odds',
  lazyNamed(() => import('./ElectionOddsWidget'), 'ElectionOddsWidget'),
  'prediction_markets',
  ['election', 'odds', 'politics']
);
registerWidget(
  'prediction_movers',
  lazyNamed(() => import('./PredictionMoversWidget'), 'PredictionMoversWidget'),
  'prediction_markets',
  ['movers', 'probability', 'deltas']
);
registerWidget(
  'macro_calibration',
  lazyNamed(() => import('./MacroCalibrationWidget'), 'MacroCalibrationWidget'),
  'prediction_markets',
  ['macro', 'calibration', 'cpi', 'fed']
);
registerWidget(
  'consensus_odds',
  lazyNamed(() => import('./ConsensusOddsWidget'), 'ConsensusOddsWidget'),
  'prediction_markets',
  ['consensus', 'odds', 'multi-source']
);
registerWidget(
  'top_movers_pulse',
  lazyNamed(() => import('./TopMoversPulseWidget'), 'TopMoversPulseWidget'),
  'prediction_markets',
  ['pulse', 'top movers', 'sparkline', 'probability']
);
registerWidget(
  'source_drift',
  lazyNamed(() => import('./SourceDriftWidget'), 'SourceDriftWidget'),
  'prediction_markets',
  ['drift', 'spread', 'consensus', 'polymarket vs kalshi']
);
registerWidget(
  'prediction_alerts',
  lazyNamed(() => import('./PredictionAlertsWidget'), 'PredictionAlertsWidget'),
  'prediction_markets',
  ['alerts', 'movement', 'probability', 'intraday']
);
registerWidget(
  'predictit',
  lazyNamed(() => import('./PredictItWidget'), 'PredictItWidget'),
  'prediction_markets',
  ['predictit', 'election', 'politics', 'odds']
);
registerWidget(
  'limitless',
  lazyNamed(() => import('./LimitlessWidget'), 'LimitlessWidget'),
  'prediction_markets',
  ['limitless', 'crypto', 'odds', 'probability']
);
registerWidget(
  'cross_source_calibration',
  lazyNamed(
    () => import('./CrossSourceCalibrationWidget'),
    'CrossSourceCalibrationWidget',
  ),
  'prediction_markets',
  ['cross-source', 'calibration', 'consensus', 'agreement']
);
registerWidget(
  'manifold',
  lazyNamed(() => import('./ManifoldWidget'), 'ManifoldWidget'),
  'prediction_markets',
  ['manifold', 'ai', 'politics', 'recession', 'odds']
);

// Run dev-only completeness check after every widget is registered.
runDevCompletenessCheck();

export { widgetRegistry };
