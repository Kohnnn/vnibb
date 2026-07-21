// Barrel exports for query modules
// Re-exports all query hooks from domain-specific modules

// Common utilities
export {
    useVnstockSource,
    getAdaptiveRefetchInterval,
    POLLING_PRESETS,
    logClientError,
} from './common';
export type { FetchOptions, QueryKeyFactory, QueryResult } from './common';

// Equity queries
export {
    // Query keys
    equityQueryKeys,
    quoteQueryKey,
    historicalQueryKey,
    // Hooks
    useProfile,
    useCompanyNews,
    useCompanyEvents,
    useAnalystEstimates,
    useFundamentalAnalysis,
    useShareholders,
    useOfficers,
    useIntraday,
    usePriceDepth,
    useForeignTrading,
    useTransactionFlow,
    useFlowCoverage,
    useCorrelationMatrix,
    useFinancialRatios,
    useRatioHistory,
    useMetricsHistory,
    useSubsidiaries,
    useBalanceSheet,
    useIncomeStatement,
    useCashFlow,
    useFinancials,
    useOwnership,
    useRating,
    useRSRating,
    useRSRatingHistory,
    useDividends,
    useTradingStats,
    useStockQuote,
    fetchStockQuote,
    useHistoricalPrices,
    // Types
    type StockQuoteView,
} from './equity';

// Market queries
export {
    // Query keys
    marketQueryKeys,
    // Hooks
    useMarketOverview,
    useMarketBreadth,
    useMarketSentiment,
    useTrendingAnalysis,
    useWorldIndices,
    useForexRates,
    useCommodities,
    useTopMovers,
    useSectorTopMovers,
    useTopGainers,
    useTopLosers,
    useTopVolume,
    useTopValue,
    usePriceBoard,
    useForeignFlowLeaderboard,
    useSectorPerformance,
    useSectorsCatalog,
    useSectorBoard,
    useMoneyFlowTrend,
    useEarningsSeason,
    useIndustryBubble,
    useMarketHeatmap,
    useMarketFreshness,
    useDataSourcesFreshness,
} from './market';

// Screener queries
export {
    // Query keys
    screenerQueryKeys,
    // Hooks
    useScreenerData,
} from './screener';

// News queries
export {
    // Query keys
    newsQueryKeys,
    // Re-export company news
    useCompanyNews as useCompanyNewsFromNews,
} from './news';

// Technical queries
export {
    // Query keys
    technicalQueryKeys,
    // Hooks
    useFullTechnicalAnalysis,
    useTechnicalHistory,
    useIchimokuSeries,
    useFibonacciRetracement,
    useMicrostructureAnalysis,
} from './technical';

// Quant queries
export {
    // Query keys
    quantQueryKeys,
    // Hooks
    useRSLeaders,
    useRSLaggards,
    useRSGainers,
    useQuantMetrics,
    useGarchVolatility,
    isGarchNotDeployedError,
    useQuantBacktest,
    useQuantSweep,
    useSeasonalityMatrix,
    useGammaExposure,
    useMomentumProfile,
    usePairDiagnostics,
    useMarketStructureTests,
    useEarningsQuality,
    useSmartMoneyFlow,
    useRelativeRotation,
    // Types
    type GarchVolatilityState,
    type PairDiagnosticsState,
} from './quant';

// Dashboard queries
export {
    dashboardQueryKeys,
    useDashboards,
    useDashboard,
    useCreateDashboard,
    useUpdateDashboard,
    useDeleteDashboard,
    useAddWidget,
    useRemoveWidget,
} from './dashboard';

// Listing queries
export {
    listingQueryKeys,
    useSymbols,
    useSymbolsByExchange,
    useSymbolsByGroup,
    useIndustries,
    useTTMSnapshot,
    useGrowthRates,
} from './listing';

// Insider queries
export {
    insiderQueryKeys,
    useInsiderDeals,
    useRecentInsiderDeals,
    useInsiderSentiment,
    useBlockTrades,
    useInsiderAlerts,
    useMarkAlertRead,
    useAlertSettings,
    useUpdateAlertSettings,
} from './insider';

// Derivatives queries
export {
    derivativesQueryKeys,
    useDerivativesContracts,
    useDerivativesHistory,
} from './derivatives';

// Comparison queries
export {
    useComparison,
    usePeerCompanies,
} from './comparison';

// Legacy re-exports for backward compatibility
export { queryKeys } from './legacy';
