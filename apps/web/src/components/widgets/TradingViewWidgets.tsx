'use client';

// Re-export TradingView widget components from TradingViewNativeWidgets.
// The WidgetRegistry imports the un-suffixed names (TradingViewChart, ...) while
// the native module exports the "...Widget"-suffixed names; these explicit aliases
// bridge that gap so every registry loader resolves to a real component.
// eslint-disable-next-line import/no-unused-modules
export * from './TradingViewNativeWidgets';

export {
    TradingViewChartWidget as TradingViewChart,
    TradingViewSymbolOverviewWidget as TradingViewSymbolOverview,
    TradingViewMiniChartWidget as TradingViewMiniChart,
    TradingViewMarketSummaryWidget as TradingViewMarketSummary,
    TradingViewMarketOverviewWidget as TradingViewMarketOverview,
    TradingViewStockMarketWidget as TradingViewStockMarket,
    TradingViewMarketDataWidget as TradingViewMarketData,
    TradingViewTickerTapeWidget as TradingViewTickerTape,
    TradingViewTickerTagWidget as TradingViewTickerTag,
    TradingViewSingleTickerWidget as TradingViewSingleTicker,
    TradingViewTickerWidget as TradingViewTicker,
    TradingViewStockHeatmapWidget as TradingViewStockHeatmap,
    TradingViewCryptoHeatmapWidget as TradingViewCryptoHeatmap,
    TradingViewForexCrossRatesWidget as TradingViewForexCrossRates,
    TradingViewEtfHeatmapWidget as TradingViewEtfHeatmap,
    TradingViewForexHeatmapWidget as TradingViewForexHeatmap,
    TradingViewScreenerWidget as TradingViewScreener,
    TradingViewCryptoMarketWidget as TradingViewCryptoMarket,
    TradingViewSymbolInfoWidget as TradingViewSymbolInfo,
    TradingViewTechnicalAnalysisWidget as TradingViewTechnicalAnalysis,
    TradingViewFundamentalDataWidget as TradingViewFundamentalData,
    TradingViewCompanyProfileWidget as TradingViewCompanyProfile,
    TradingViewTopStoriesWidget as TradingViewTopStories,
    TradingViewEconomicCalendarWidget as TradingViewEconomicCalendar,
    TradingViewEconomicMapWidget as TradingViewEconomicMap,
} from './TradingViewNativeWidgets';
