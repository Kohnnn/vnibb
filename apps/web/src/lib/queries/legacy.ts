// Legacy exports for backward compatibility with existing code
// This module re-exports the combined queryKeys object from the original queries.ts

// Re-export the full queryKeys object for backward compatibility
export const queryKeys = {
    // Historical
    historical: (
        symbol: string,
        params?: {
            startDate?: string;
            endDate?: string;
            interval?: string;
            source?: string;
            adjustmentMode?: 'raw' | 'adjusted';
        }
    ) => ['historical', symbol, params] as const,

    // Profile
    profile: (symbol: string) => ['profile', symbol] as const,

    // Company
    companyNews: (symbol: string) => ['companyNews', symbol] as const,
    companyEvents: (symbol: string) => ['companyEvents', symbol] as const,

    // Analyst
    analystEstimates: (symbol: string) => ['analystEstimates', symbol] as const,
    fundamentalAnalysis: (symbol: string) => ['fundamentalAnalysis', symbol] as const,

    // Ownership
    shareholders: (symbol: string) => ['shareholders', symbol] as const,
    officers: (symbol: string) => ['officers', symbol] as const,

    // Trading
    intraday: (symbol: string) => ['intraday', symbol] as const,
    financialRatios: (symbol: string, period: string) => ['financialRatios', symbol, period] as const,
    ratioHistory: (symbol: string, period: string, ratios: string[]) => ['ratioHistory', symbol, period, ratios] as const,
    foreignTrading: (symbol: string, limit?: number) => ['foreignTrading', symbol, limit] as const,
    transactionFlow: (symbol: string, days: number) => ['transactionFlow', symbol, days] as const,
    correlationMatrix: (symbol: string, days: number, topN: number) => ['correlationMatrix', symbol, days, topN] as const,

    // Company structure
    subsidiaries: (symbol: string) => ['subsidiaries', symbol] as const,

    // Financial statements
    balanceSheet: (symbol: string, period: string) => ['balanceSheet', symbol, period] as const,
    incomeStatement: (symbol: string, period: string) => ['incomeStatement', symbol, period] as const,
    cashFlow: (symbol: string, period: string) => ['cashFlow', symbol, period] as const,

    // Market
    marketOverview: () => ['marketOverview'] as const,
    marketSentiment: () => ['marketSentiment'] as const,
    trendingAnalysis: () => ['trendingAnalysis'] as const,
    marketBreadth: () => ['marketBreadth'] as const,

    // Earnings
    earningsSeason: (exchange?: string, limit?: number) => ['earningsSeason', exchange, limit] as const,
    industryBubble: (params?: Record<string, unknown>) => ['industryBubble', params] as const,

    // Global markets
    worldIndices: () => ['worldIndices'] as const,
    forexRates: () => ['forexRates'] as const,
    commodities: () => ['commodities'] as const,

    // Screener
    screener: (params?: Record<string, unknown>) => ['screener', params] as const,

    // Dashboard
    dashboards: (userId?: string) => ['dashboards', userId] as const,
    dashboard: (id: number) => ['dashboard', id] as const,

    // Listing
    symbols: (limit?: number) => ['symbols', limit] as const,
    symbolsByExchange: (exchange: string) => ['symbolsByExchange', exchange] as const,
    symbolsByGroup: (group: string) => ['symbolsByGroup', group] as const,
    industries: () => ['industries'] as const,

    // TTM
    ttmSnapshot: (symbol: string) => ['ttmSnapshot', symbol] as const,
    growthRates: (symbol: string) => ['growthRates', symbol] as const,

    // Trading
    priceBoard: (symbols: string[]) => ['priceBoard', symbols] as const,
    topMovers: (type: string, index: string, limit: number) => ['topMovers', type, index, limit] as const,
    sectorTopMovers: (type: string, limit: number) => ['sectorTopMovers', type, limit] as const,
    sectorsCatalog: (symbolLimit: number) => ['sectorsCatalog', symbolLimit] as const,
    sectorBoard: (params?: Record<string, unknown>) => ['sectorBoard', params] as const,
    moneyFlowTrend: (params?: Record<string, unknown>) => ['moneyFlowTrend', params] as const,

    // Derivatives
    derivativesContracts: () => ['derivativesContracts'] as const,
    derivativesHistory: (symbol: string) => ['derivativesHistory', symbol] as const,

    // Additional equity
    priceDepth: (symbol: string) => ['priceDepth', symbol] as const,
    rsRating: (symbol: string) => ['rsRating', symbol] as const,

    // Insider
    insiderDeals: (symbol: string) => ['insiderDeals', symbol] as const,
    recentInsiderDeals: (limit?: number) => ['recentInsiderDeals', limit] as const,
    insiderSentiment: (symbol: string, days: number) => ['insiderSentiment', symbol, days] as const,
    blockTrades: (symbol?: string, limit?: number) => ['blockTrades', symbol, limit] as const,
    insiderAlerts: (userId?: number, unreadOnly?: boolean) => ['insiderAlerts', userId, unreadOnly] as const,
    alertSettings: (userId: number) => ['alertSettings', userId] as const,

    // Dividends
    dividends: (symbol: string) => ['dividends', symbol] as const,
    tradingStats: (symbol: string) => ['tradingStats', symbol] as const,

    // Top movers
    topGainers: (index: string) => ['topGainers', index] as const,
    topLosers: (index: string) => ['topLosers', index] as const,
    topVolume: (index: string) => ['topVolume', index] as const,
    topValue: (index: string) => ['topValue', index] as const,

    // Ownership
    ownership: (symbol: string) => ['ownership', symbol] as const,
    rating: (symbol: string) => ['rating', symbol] as const,

    // Financials
    financials: (symbol: string, type: string, period: string) => ['financials', symbol, type, period] as const,

    // Technical
    taFull: (symbol: string, timeframe: string) => ['taFull', symbol, timeframe] as const,
    taHistory: (symbol: string, days: number) => ['taHistory', symbol, days] as const,
    taIchimoku: (symbol: string, period: string) => ['taIchimoku', symbol, period] as const,
    taFibonacci: (symbol: string, lookbackDays: number, direction: string) =>
        ['taFibonacci', symbol, lookbackDays, direction] as const,
    microstructure: (symbol: string, params?: Record<string, unknown>) => ['microstructure', symbol, params] as const,

    // RS Rating
    rsLeaders: (limit: number, sector?: string) => ['rsLeaders', limit, sector] as const,
    rsLaggards: (limit: number, sector?: string) => ['rsLaggards', limit, sector] as const,
    rsGainers: (limit: number, lookbackDays: number) => ['rsGainers', limit, lookbackDays] as const,

    // Quant
    quant: (symbol: string, period: string, metrics: string[], source: string) =>
        ['quant', symbol, period, metrics.join(','), source] as const,
    garchVolatility: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['garchVolatility', symbol, period, source, adjustmentMode] as const,
    quantBacktest: (symbol: string, period: string, asOfDate: string, fastWindow: number, slowWindow: number, source: string, adjustmentMode: string) =>
        ['quantBacktest', symbol, period, asOfDate, fastWindow, slowWindow, source, adjustmentMode] as const,
    quantSweep: (symbol: string, period: string, fastWindows: number[], slowWindows: number[], objective: string, source: string, adjustmentMode: string) =>
        ['quantSweep', symbol, period, fastWindows.join(','), slowWindows.join(','), objective, source, adjustmentMode] as const,
    seasonalityMatrix: (symbol: string, granularity: string, period: string, source: string, adjustmentMode: string) =>
        ['seasonalityMatrix', symbol, granularity, period, source, adjustmentMode] as const,
    gammaExposure: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['gammaExposure', symbol, period, source, adjustmentMode] as const,
    momentumProfile: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['momentumProfile', symbol, period, source, adjustmentMode] as const,
    earningsQuality: (symbol: string) => ['earningsQuality', symbol] as const,
    smartMoneyFlow: (symbol: string) => ['smartMoneyFlow', symbol] as const,
    relativeRotation: (symbol: string, lookbackDays: number) =>
        ['relativeRotation', symbol, lookbackDays] as const,
    marketStructureTests: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['marketStructureTests', symbol, period, source, adjustmentMode] as const,
    pairDiagnostics: (symbol: string, other: string, period: string, source: string, adjustmentMode: string) =>
        ['pairDiagnostics', symbol, other, period, source, adjustmentMode] as const,
};
