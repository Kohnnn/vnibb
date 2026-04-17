// TanStack Query hooks for data fetching

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { DashboardCreate, WidgetCreate } from '@/types/dashboard';
import type { AlertSettings } from '@/types/insider';
import { useDataSources, type VnstockSource } from '@/contexts/DataSourcesContext';
import { logClientError } from './clientLogger';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from './pollingPolicy';

// Helper hook to get the preferred VnStock source
export function useVnstockSource(): VnstockSource {
    try {
        const { preferredVnstockSource } = useDataSources();
        return preferredVnstockSource;
    } catch {
        // If used outside of DataSourcesProvider, default to KBS
        return 'KBS';

    }
}

// ============ Query Keys ============

export const queryKeys = {
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
    profile: (symbol: string) => ['profile', symbol] as const,
    companyNews: (symbol: string) => ['companyNews', symbol] as const,
    companyEvents: (symbol: string) => ['companyEvents', symbol] as const,
    analystEstimates: (symbol: string) => ['analystEstimates', symbol] as const,
    shareholders: (symbol: string) => ['shareholders', symbol] as const,
    officers: (symbol: string) => ['officers', symbol] as const,
    intraday: (symbol: string) => ['intraday', symbol] as const,
    financialRatios: (symbol: string, period: string) => ['financialRatios', symbol, period] as const,
    ratioHistory: (symbol: string, period: string, ratios: string[]) => ['ratioHistory', symbol, period, ratios] as const,
    foreignTrading: (symbol: string) => ['foreignTrading', symbol] as const,
    transactionFlow: (symbol: string, days: number) => ['transactionFlow', symbol, days] as const,
    correlationMatrix: (symbol: string, days: number, topN: number) => ['correlationMatrix', symbol, days, topN] as const,
    subsidiaries: (symbol: string) => ['subsidiaries', symbol] as const,
    balanceSheet: (symbol: string, period: string) => ['balanceSheet', symbol, period] as const,
    incomeStatement: (symbol: string, period: string) => ['incomeStatement', symbol, period] as const,
    cashFlow: (symbol: string, period: string) => ['cashFlow', symbol, period] as const,
    marketOverview: () => ['marketOverview'] as const,
    marketBreadth: () => ['marketBreadth'] as const,
    earningsSeason: (exchange?: string, limit?: number) => ['earningsSeason', exchange, limit] as const,
    industryBubble: (params?: Record<string, unknown>) => ['industryBubble', params] as const,
    worldIndices: () => ['worldIndices'] as const,
    forexRates: () => ['forexRates'] as const,
    commodities: () => ['commodities'] as const,
    screener: (params?: Record<string, unknown>) => ['screener', params] as const,
    dashboards: (userId?: string) => ['dashboards', userId] as const,
    dashboard: (id: number) => ['dashboard', id] as const,
    // Listing
    symbols: (limit?: number) => ['symbols', limit] as const,
    symbolsByExchange: (exchange: string) => ['symbolsByExchange', exchange] as const,
    symbolsByGroup: (group: string) => ['symbolsByGroup', group] as const,
    industries: () => ['industries'] as const,
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
    // Insider & Alerts
    insiderDeals: (symbol: string) => ['insiderDeals', symbol] as const,
    recentInsiderDeals: (limit?: number) => ['recentInsiderDeals', limit] as const,
    insiderSentiment: (symbol: string, days: number) => ['insiderSentiment', symbol, days] as const,
    blockTrades: (symbol?: string) => ['blockTrades', symbol] as const,
    insiderAlerts: (userId?: number, unreadOnly?: boolean) => ['insiderAlerts', userId, unreadOnly] as const,
    alertSettings: (userId: number) => ['alertSettings', userId] as const,
    // Dividends & Stats
    dividends: (symbol: string) => ['dividends', symbol] as const,
    tradingStats: (symbol: string) => ['tradingStats', symbol] as const,
    // Top Movers
    topGainers: (index: string) => ['topGainers', index] as const,
    topLosers: (index: string) => ['topLosers', index] as const,
    topVolume: (index: string) => ['topVolume', index] as const,
    topValue: (index: string) => ['topValue', index] as const,
    // Ownership & Rating
    ownership: (symbol: string) => ['ownership', symbol] as const,
    rating: (symbol: string) => ['rating', symbol] as const,
    // Unified Financials
    financials: (symbol: string, type: string, period: string) => ['financials', symbol, type, period] as const,
    // Technical Analysis
    taFull: (symbol: string, timeframe: string) => ['taFull', symbol, timeframe] as const,
    taHistory: (symbol: string, days: number) => ['taHistory', symbol, days] as const,
    taIchimoku: (symbol: string, period: string) => ['taIchimoku', symbol, period] as const,
    taFibonacci: (symbol: string, lookbackDays: number, direction: string) =>
        ['taFibonacci', symbol, lookbackDays, direction] as const,
    // RS Rating System (Phase 2)
    rsLeaders: (limit: number, sector?: string) => ['rsLeaders', limit, sector] as const,
    rsLaggards: (limit: number, sector?: string) => ['rsLaggards', limit, sector] as const,
    rsGainers: (limit: number, lookbackDays: number) => ['rsGainers', limit, lookbackDays] as const,
    quant: (symbol: string, period: string, metrics: string[], source: string) =>
        ['quant', symbol, period, metrics.join(','), source] as const,
    gammaExposure: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['gammaExposure', symbol, period, source, adjustmentMode] as const,
    momentumProfile: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['momentumProfile', symbol, period, source, adjustmentMode] as const,
    earningsQuality: (symbol: string) => ['earningsQuality', symbol] as const,
    smartMoneyFlow: (symbol: string) => ['smartMoneyFlow', symbol] as const,
    relativeRotation: (symbol: string, lookbackDays: number) =>
        ['relativeRotation', symbol, lookbackDays] as const,
};

// ============ Equity Queries ============

export function useHistoricalPrices(
    symbol: string,
    options?: {
        startDate?: string;
        endDate?: string;
        interval?: string;
        source?: string;
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    // Get the preferred source from context, but allow override via options
    let preferredSource: VnstockSource = 'KBS';

    try {
        const { preferredVnstockSource } = useDataSources();
        preferredSource = preferredVnstockSource;
    } catch {
        // Outside of DataSourcesProvider, use default
    }

    const source = options?.source ?? preferredSource;
    const historyParams = {
        startDate: options?.startDate,
        endDate: options?.endDate,
        interval: options?.interval,
        source,
        adjustmentMode: options?.adjustmentMode,
    }

    return useQuery({
        queryKey: queryKeys.historical(symbol, historyParams),
        queryFn: () => api.getHistoricalPrices(symbol, { ...options, source }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000, // Increase to 5 minutes
        gcTime: 15 * 60 * 1000,   // Cache for 15 minutes
    });
}


export function useProfile(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.profile(symbol),
        queryFn: async ({ signal }) => {
            try {
                return await api.getProfile(symbol, signal);
            } catch (error) {
                if ((error as Error)?.name === 'AbortError') {
                    throw error;
                }
                logClientError(`[useProfile] Failed to fetch profile for ${symbol}:`, error);
                throw error;
            }
        },
        enabled: enabled && !!symbol,

        staleTime: 10 * 60 * 1000, // Increase to 10 minutes
        gcTime: 30 * 60 * 1000,   // Cache for 30 minutes
        retry: 2,
    });
}


export function useCompanyNews(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.companyNews(symbol),
        queryFn: () => api.getCompanyNews(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}

export function useCompanyEvents(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.companyEvents(symbol),
        queryFn: () => api.getCompanyEvents(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 10 * 60 * 1000, // 10 minutes
    });
}

export function useAnalystEstimates(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.analystEstimates(symbol),
        queryFn: () => api.getAnalystEstimates(symbol),
        enabled: enabled && !!symbol,
        staleTime: 10 * 60 * 1000,
    });
}

export function useShareholders(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.shareholders(symbol),
        queryFn: () => api.getShareholders(symbol),
        enabled: enabled && !!symbol,
        staleTime: 30 * 60 * 1000, // 30 minutes
    });
}

export function useOfficers(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.officers(symbol),
        queryFn: () => api.getOfficers(symbol),
        enabled: enabled && !!symbol,
        staleTime: 30 * 60 * 1000, // 30 minutes
    });
}

export function useIntraday(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.intraday(symbol),
        queryFn: () => api.getIntraday(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 30 * 1000, // 30 seconds - refresh frequently
    });
}

export function useFinancialRatios(
    symbol: string,
    options?: { period?: string; enabled?: boolean }
) {
    const period = options?.period || 'FY';
    return useQuery({
        queryKey: queryKeys.financialRatios(symbol, period),
        queryFn: ({ signal }) => api.getFinancialRatios(symbol, { period }, signal),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}

export function useRatioHistory(
    symbol: string,
    options?: {
        ratios?: string[];
        period?: 'year' | 'quarter';
        limit?: number;
        enabled?: boolean;
    }
) {
    const ratios = options?.ratios || ['pe', 'pb', 'ps', 'ev_ebitda'];
    const period = options?.period || 'year';
    return useQuery({
        queryKey: queryKeys.ratioHistory(symbol, period, ratios),
        queryFn: () => api.getRatioHistory(symbol, { ratios, period, limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useMetricsHistory(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: ['metricsHistory', symbol, options?.limit],
        queryFn: () => api.getMetricsHistory(symbol, options?.limit),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}


export function useForeignTrading(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.foreignTrading(symbol),
        queryFn: () => api.getForeignTrading(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}

export function useTransactionFlow(
    symbol: string,
    options?: { days?: number; enabled?: boolean }
) {
    const days = options?.days || 30;
    return useQuery({
        queryKey: queryKeys.transactionFlow(symbol, days),
        queryFn: () => api.getTransactionFlow(symbol, { days }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
    });
}

export function useCorrelationMatrix(
    symbol: string,
    options?: { days?: number; topN?: number; enabled?: boolean }
) {
    const days = options?.days || 60
    const topN = options?.topN || 10
    return useQuery({
        queryKey: queryKeys.correlationMatrix(symbol, days, topN),
        queryFn: () => api.getCorrelationMatrix(symbol, { days, top_n: topN }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 10 * 60 * 1000,
        retry: 2,
    })
}

export function useSubsidiaries(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.subsidiaries(symbol),
        queryFn: () => api.getSubsidiaries(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}

export function useBalanceSheet(
    symbol: string,
    options?: { period?: string; enabled?: boolean; limit?: number }
) {
    const period = options?.period || 'FY';
    const limit = options?.limit;
    return useQuery({
        queryKey: [...queryKeys.balanceSheet(symbol, period), limit],
        queryFn: () => api.getBalanceSheet(symbol, { period, limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}

export function useIncomeStatement(
    symbol: string,
    options?: { period?: string; enabled?: boolean; limit?: number }
) {
    const period = options?.period || 'FY';
    const limit = options?.limit;
    return useQuery({
        queryKey: [...queryKeys.incomeStatement(symbol, period), limit],
        queryFn: () => api.getIncomeStatement(symbol, { period, limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}

export function useCashFlow(
    symbol: string,
    options?: { period?: string; enabled?: boolean; limit?: number }
) {
    const period = options?.period || 'FY';
    const limit = options?.limit;
    return useQuery({
        queryKey: [...queryKeys.cashFlow(symbol, period), limit],
        queryFn: () => api.getCashFlow(symbol, { period, limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}


export function useMarketOverview(enabled = true) {
    return useQuery({
        queryKey: queryKeys.marketOverview(),
        queryFn: ({ signal }) => api.getMarketOverview(signal),
        enabled,
        staleTime: 20 * 1000,
        refetchInterval: enabled ? 20 * 1000 : false,
        refetchIntervalInBackground: false,
    });
}

export function useMarketBreadth(enabled = true) {
    return useQuery({
        queryKey: queryKeys.marketBreadth(),
        queryFn: () => api.getMarketBreadth(),
        enabled,
        staleTime: 60 * 1000,
        retry: 2,
    });
}

export function useEarningsSeason(options?: { exchange?: string; limit?: number; enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.earningsSeason(options?.exchange, options?.limit),
        queryFn: () => api.getEarningsSeason({ exchange: options?.exchange, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useIndustryBubble(options: {
    symbol: string;
    x_metric?: string;
    y_metric?: string;
    size_metric?: string;
    top_n?: number;
    enabled?: boolean;
}) {
    return useQuery({
        queryKey: queryKeys.industryBubble(options),
        queryFn: () => api.getIndustryBubble(options),
        enabled: options.enabled !== false && !!options.symbol,
        staleTime: 5 * 60 * 1000,
    });
}

export function useWorldIndices(enabled = true) {
    return useQuery({
        queryKey: queryKeys.worldIndices(),
        queryFn: () => api.getWorldIndices({ limit: 8 }),
        enabled,
        staleTime: 2 * 60 * 1000,
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.movers),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

export function useForexRates(enabled = true) {
    return useQuery({
        queryKey: queryKeys.forexRates(),
        queryFn: () => api.getForexRates({ limit: 12 }),
        enabled,
        staleTime: 5 * 60 * 1000,
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.movers),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

export function useCommodities(enabled = true) {
    return useQuery({
        queryKey: queryKeys.commodities(),
        queryFn: () => api.getCommodities({ limit: 20 }),
        enabled,
        staleTime: 5 * 60 * 1000,
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.movers),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}


// ============ Screener Queries ============

export function useScreenerData(options?: {
    symbol?: string;
    exchange?: string;
    industry?: string;
    limit?: number;
    source?: 'KBS' | 'VCI' | 'DNSE';
    // Dynamic filters (new)
    filters?: string; // JSON encoded FilterGroup
    sort?: string;    // Multi-sort string: "field:order,field2:order2"
    // Legacy filters (kept for backward compatibility)
    pe_min?: number;
    pe_max?: number;
    pb_min?: number;
    pb_max?: number;
    ps_min?: number;
    ps_max?: number;
    roe_min?: number;
    roa_min?: number;
    debt_to_equity_max?: number;
    market_cap_min?: number;
    market_cap_max?: number;
    volume_min?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    enabled?: boolean;
}) {
    // Get the preferred source from context, but allow override via options
    let preferredSource: VnstockSource = 'KBS';

    try {
        const { preferredVnstockSource } = useDataSources();
        preferredSource = preferredVnstockSource;
    } catch {
        // Outside of DataSourcesProvider, use default
    }

    const source = options?.source ?? preferredSource;

    return useQuery({
        queryKey: queryKeys.screener({ ...options, source }),
        queryFn: async ({ signal }) => {
            try {
                return await api.getScreenerData({ ...options, source }, signal);
            } catch (error) {
                if ((error as Error)?.name === 'AbortError') {
                    throw error;
                }
                logClientError('[useScreenerData] Failed to fetch screener data:', error);
                throw error;
            }
        },
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000, // Increase to 5 minutes
        gcTime: 10 * 60 * 1000,  // Cache for 10 minutes
        retry: 2,
    });
}


// ============ Dashboard Queries ============

export function useDashboards(userId = 'current') {
    return useQuery({
        queryKey: queryKeys.dashboards(userId),
        queryFn: () => api.getDashboards(userId),
    });
}

export function useDashboard(id: number, enabled = true) {
    return useQuery({
        queryKey: queryKeys.dashboard(id),
        queryFn: () => api.getDashboard(id),
        enabled: enabled && !!id,
    });
}

// ============ Dashboard Mutations ============

export function useCreateDashboard() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: DashboardCreate) => api.createDashboard(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        },
    });
}

export function useUpdateDashboard() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<DashboardCreate> }) =>
            api.updateDashboard(id, data),
        onSuccess: (_, { id }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(id) });
            queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        },
    });
}

export function useDeleteDashboard() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: number) => api.deleteDashboard(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        },
    });
}

export function useAddWidget() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ dashboardId, data }: { dashboardId: number; data: WidgetCreate }) =>
            api.addWidget(dashboardId, data),
        onSuccess: (_, { dashboardId }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(dashboardId) });
        },
    });
}

export function useRemoveWidget() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ dashboardId, widgetId }: { dashboardId: number; widgetId: number }) =>
            api.removeWidget(dashboardId, widgetId),
        onSuccess: (_, { dashboardId }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(dashboardId) });
        },
    });
}

// ============ Listing Queries ============

export function useSymbols(options?: { limit?: number; enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.symbols(options?.limit),
        queryFn: () => api.getSymbols({ limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 60 * 1000, // 1 hour - symbols don't change often
    });
}

export function useSymbolsByExchange(
    exchange: 'HOSE' | 'HNX' | 'UPCOM',
    enabled = true
) {
    return useQuery({
        queryKey: queryKeys.symbolsByExchange(exchange),
        queryFn: () => api.getSymbolsByExchange(exchange),
        enabled: enabled && !!exchange,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}

export function useSymbolsByGroup(group: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.symbolsByGroup(group),
        queryFn: () => api.getSymbolsByGroup(group),
        enabled: enabled && !!group,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}

export function useIndustries(enabled = true) {
    return useQuery({
        queryKey: queryKeys.industries(),
        queryFn: () => api.getIndustries(),
        enabled,
        staleTime: 24 * 60 * 60 * 1000, // 24 hours - industries rarely change
    });
}

// ============ Trading Queries ============

export function usePriceBoard(
    symbols: string[],
    options?: { enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: queryKeys.priceBoard(symbols),
        queryFn: () => api.getPriceBoard(symbols),
        enabled: options?.enabled !== false && symbols.length > 0,
        staleTime: 10 * 1000, // 10 seconds - real-time data
        refetchInterval: options?.refetchInterval ?? 15000, // Auto-refresh every 15s
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

export function useTopMovers(options?: {
    type?: 'gainer' | 'loser' | 'volume' | 'value';
    index?: 'VNINDEX' | 'HNX' | 'VN30';
    limit?: number;
    enabled?: boolean;
    refetchInterval?: number;
}) {
    const type = options?.type || 'gainer';
    const index = options?.index || 'VNINDEX';
    const limit = options?.limit || 10;

    return useQuery({
        queryKey: queryKeys.topMovers(type, index, limit),
        queryFn: () => api.getTopMovers({ type, index, limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000, // 1 minute
        refetchInterval:
            options?.refetchInterval ??
            (() => getAdaptiveRefetchInterval(POLLING_PRESETS.movers)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

export function useSectorTopMovers(options?: {
    type?: 'gainers' | 'losers';
    limit?: number;
    enabled?: boolean;
    refetchInterval?: number;
}) {
    const type = options?.type || 'gainers';
    const limit = options?.limit || 5;

    return useQuery({
        queryKey: queryKeys.sectorTopMovers(type, limit),
        queryFn: () => api.getSectorTopMovers({ type, limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000, // 1 minute
        refetchInterval:
            options?.refetchInterval ??
            (() => getAdaptiveRefetchInterval(POLLING_PRESETS.movers)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

export function useSectorsCatalog(options?: {
    symbolLimit?: number;
    enabled?: boolean;
}) {
    const symbolLimit = options?.symbolLimit || 50;

    return useQuery({
        queryKey: queryKeys.sectorsCatalog(symbolLimit),
        queryFn: () => api.getSectorsCatalog({ symbolLimit }),
        enabled: options?.enabled !== false,
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
    });
}

// ============ Sector Performance Hook ============

export function useSectorPerformance(options?: {
    enabled?: boolean;
    refetchInterval?: number;
}) {
    return useQuery({
        queryKey: ['sectorPerformance'] as const,
        queryFn: () => api.getSectorPerformance(),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000, // 1 minute
        refetchInterval:
            options?.refetchInterval ??
            (() => getAdaptiveRefetchInterval(POLLING_PRESETS.movers)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
        retry: 2,
    });
}

export function useSectorBoard(options?: {
    limit_per_sector?: number;
    sectors?: string;
    sort_by?: 'volume' | 'market_cap' | 'change_pct';
    enabled?: boolean;
    refetchInterval?: number;
}) {
    return useQuery({
        queryKey: queryKeys.sectorBoard(options),
        queryFn: () => api.getSectorBoard(options),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchInterval:
            options?.refetchInterval ?? (() => getAdaptiveRefetchInterval(POLLING_PRESETS.movers)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

export function useMoneyFlowTrend(options?: {
    symbol?: string;
    symbols?: string;
    sector?: string;
    timeframe?: 'short' | 'medium' | 'long';
    trail_length?: number;
    enabled?: boolean;
}) {
    return useQuery({
        queryKey: queryKeys.moneyFlowTrend(options),
        queryFn: () => api.getMoneyFlowTrend(options),
        enabled: options?.enabled !== false && Boolean(options?.symbol || options?.symbols || options?.sector),
        staleTime: 2 * 60 * 1000,
        retry: 2,
    });
}

// ============ Derivatives Queries ============

export function useDerivativesContracts(enabled = true) {
    return useQuery({
        queryKey: queryKeys.derivativesContracts(),
        queryFn: () => api.getDerivativesContracts(),
        enabled,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}

export function useDerivativesHistory(
    symbol: string,
    options?: { startDate?: string; endDate?: string; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.derivativesHistory(symbol),
        queryFn: () => api.getDerivativesHistory(symbol, options),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 1000, // 1 minute
    });
}

// ============ Additional Equity Queries ============

export function usePriceDepth(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.priceDepth(symbol),
        queryFn: () => api.getPriceDepth(symbol),
        enabled: enabled && !!symbol,
        staleTime: 5 * 1000, // 5 seconds - real-time order book
    });
}

export function useInsiderDeals(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.insiderDeals(symbol),
        queryFn: () => api.getInsiderDeals(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 10 * 60 * 1000,
    });
}

export function useRecentInsiderDeals(options?: { limit?: number; enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.recentInsiderDeals(options?.limit),
        queryFn: () => api.getRecentInsiderDeals({ limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000,
    });
}

export function useInsiderSentiment(
    symbol: string,
    options?: { days?: number; enabled?: boolean }
) {
    const days = options?.days || 90;
    return useQuery({
        queryKey: queryKeys.insiderSentiment(symbol, days),
        queryFn: () => api.getInsiderSentiment(symbol, days),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useBlockTrades(
    options?: { symbol?: string; limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: queryKeys.blockTrades(options?.symbol),
        queryFn: () => api.getBlockTrades({ symbol: options?.symbol, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 30 * 1000,
        refetchInterval:
            options?.refetchInterval ??
            (() => getAdaptiveRefetchInterval(POLLING_PRESETS.alerts)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

export function useInsiderAlerts(
    options?: { userId?: number; unreadOnly?: boolean; limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.insiderAlerts(options?.userId, options?.unreadOnly),
        queryFn: () => api.getInsiderAlerts(options),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
    });
}

export function useMarkAlertRead() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (alertId: number) => api.markAlertRead(alertId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['insiderAlerts'] });
        },
    });
}

export function useAlertSettings(userId: number, enabled = true) {
    return useQuery({
        queryKey: queryKeys.alertSettings(userId),
        queryFn: () => api.getAlertSettings(userId),
        enabled: enabled && !!userId,
        staleTime: 60 * 60 * 1000,
    });
}

export function useUpdateAlertSettings() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ userId, settings }: { userId: number; settings: Partial<AlertSettings> }) =>
            api.updateAlertSettings(userId, settings),
        onSuccess: (_, { userId }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.alertSettings(userId) });
        },
    });
}

export function useDividends(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.dividends(symbol),
        queryFn: () => api.getDividends(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour - dividend data doesn't change frequently
    });
}

export function useTradingStats(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.tradingStats(symbol),
        queryFn: () => api.getTradingStats(symbol),
        enabled: enabled && !!symbol,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}

// ============ Stock Quote Hook ============

/**
 * Query key for stock quotes
 */
export const quoteQueryKey = (symbol: string) => ['quote', symbol] as const;

export interface StockQuoteView {
    symbol: string;
    price: number | null;
    change: number | null;
    changePct: number | null;
    prevClose: number | null;
    volume: number | null;
    value: number | null;
    high: number | null;
    low: number | null;
    open: number | null;
    updatedAt: string | null;
    cached: boolean;
}

export async function fetchStockQuote(symbol: string, signal?: AbortSignal): Promise<StockQuoteView> {
    const response = await api.getQuote(symbol, signal);
    const quoteData = response.data ?? {};
    const price = quoteData.price ?? null;
    const change = quoteData.change ?? quoteData.change_1d ?? null;
    const prevClose = quoteData.prevClose ?? quoteData.prev_close ?? null;
    const derivedChangePct =
        change !== null && prevClose !== null && Number(prevClose) !== 0
            ? (Number(change) / Number(prevClose)) * 100
            : null;

    return {
        symbol: response.symbol || quoteData.symbol || symbol,
        price,
        change,
        changePct:
            quoteData.changePct ?? quoteData.change_pct ?? quoteData.changePercent ?? derivedChangePct,
        prevClose,
        volume: quoteData.volume ?? null,
        value: quoteData.value ?? null,
        high: quoteData.high ?? null,
        low: quoteData.low ?? null,
        open: quoteData.open ?? null,
        updatedAt: quoteData.updatedAt ?? quoteData.updated_at ?? null,
        cached: response.cached,
    };
}

/**
 * Hook to fetch current stock quote from dedicated quote endpoint.
 * Uses 30-second cache for real-time freshness.
 */
export function useStockQuote(symbol: string, enabled = true) {
    return useQuery({
        queryKey: quoteQueryKey(symbol),
        queryFn: async ({ signal }) => {
            try {
                return await fetchStockQuote(symbol, signal);
            } catch (error) {
                if ((error as Error)?.name === 'AbortError') {
                    throw error;
                }
                logClientError(`[useStockQuote] Failed to fetch quote for ${symbol}:`, error);
                throw error;
            }
        },
        enabled: enabled && !!symbol,

        staleTime: 30 * 1000,  // 30 seconds - real-time needs freshness
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.quotes),
        refetchIntervalInBackground: false,
        networkMode: 'online',
        retry: 2,
    });
}

// ============ Top Movers Hooks ============

export function useTopGainers(
    index: 'VNINDEX' | 'HNX' | 'VN30' = 'VNINDEX',
    options?: { limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: queryKeys.topGainers(index),
        queryFn: () => api.getTopGainers({ index, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000, // 1 minute
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

export function useTopLosers(
    index: 'VNINDEX' | 'HNX' | 'VN30' = 'VNINDEX',
    options?: { limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: queryKeys.topLosers(index),
        queryFn: () => api.getTopLosers({ index, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000, // 1 minute
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

export function useTopVolume(
    index: 'VNINDEX' | 'HNX' | 'VN30' = 'VNINDEX',
    options?: { limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: queryKeys.topVolume(index),
        queryFn: () => api.getTopVolume({ index, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000, // 1 minute
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

export function useTopValue(
    index: 'VNINDEX' | 'HNX' | 'VN30' = 'VNINDEX',
    options?: { limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: queryKeys.topValue(index),
        queryFn: () => api.getTopValue({ index, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000, // 1 minute
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

// ============ Ownership & Rating Hooks ============

export function useOwnership(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.ownership(symbol),
        queryFn: () => api.getOwnership(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour - ownership doesn't change frequently
        retry: 2,
    });
}

export function useRating(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.rating(symbol),
        queryFn: () => api.getRating(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour - ratings don't change frequently
        retry: 2,
    });
}

// ============ Unified Financials Hook ============

export function useFinancials(
    symbol: string,
    options?: {
        type?: 'income' | 'balance' | 'cashflow';
        period?: 'year' | 'quarter' | 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'TTM';
        limit?: number;
        enabled?: boolean;
    }
) {
    const type = options?.type || 'income';
    const period = options?.period || 'FY';
    return useQuery({
        queryKey: queryKeys.financials(symbol, type, period),
        queryFn: () => api.getFinancials(symbol, { type, period, limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour - financial statements don't change frequently
        retry: 2,
    });
}

// ============ Comparison Analysis Hook ============

export function useComparison(
    symbols: string[],
    options?: { enabled?: boolean; refetchInterval?: number; period?: string }
) {
    return useQuery({
        queryKey: ['comparison', symbols.join(','), options?.period ?? 'FY'] as const,
        queryFn: () => api.compareStocks(symbols, options?.period ?? 'FY'),
        enabled: options?.enabled !== false && symbols.length > 0,
        staleTime: 60 * 1000, // 1 minute 
        refetchInterval: options?.refetchInterval ?? 60000,
        retry: 2,
    });
}

export function usePeerCompanies(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: ['peers', symbol] as const,
        queryFn: () => api.getPeerCompanies(symbol, options?.limit),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 24 * 60 * 60 * 1000, // 24 hours - peers don't change often
        retry: 2,
    });
}


// ============ Technical Analysis Queries ============

export function useFullTechnicalAnalysis(
    symbol: string,
    options?: { timeframe?: string; lookbackDays?: number; enabled?: boolean }
) {
    const timeframe = options?.timeframe || 'D';
    return useQuery({
        queryKey: queryKeys.taFull(symbol, timeframe),
        queryFn: () => api.getFullTechnicalAnalysis(symbol, { ...options, timeframe }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}

export function useTechnicalHistory(
    symbol: string,
    options?: { days?: number; enabled?: boolean }
) {
    const days = options?.days || 30;
    return useQuery({
        queryKey: queryKeys.taHistory(symbol, days),
        queryFn: () => api.getTechnicalHistory(symbol, { days }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}

export function useIchimokuSeries(
    symbol: string,
    options?: { period?: '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y'; enabled?: boolean }
) {
    const period = options?.period || '1Y'
    return useQuery({
        queryKey: queryKeys.taIchimoku(symbol, period),
        queryFn: () => api.getIchimokuSeries(symbol, { period }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    })
}

export function useFibonacciRetracement(
    symbol: string,
    options?: { lookbackDays?: number; direction?: 'auto' | 'up' | 'down'; enabled?: boolean }
) {
    const lookbackDays = options?.lookbackDays ?? 252
    const direction = options?.direction || 'auto'
    return useQuery({
        queryKey: queryKeys.taFibonacci(symbol, lookbackDays, direction),
        queryFn: () => api.getFibonacciRetracement(symbol, { lookbackDays, direction }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    })
}

// ============ Quant Queries ============

export function useQuantMetrics(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        metrics?: api.QuantMetric[];
        source?: 'KBS' | 'VCI' | 'DNSE';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '5Y';
    const metrics = options?.metrics || ['volume_delta'];
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';
    return useQuery({
        queryKey: [...queryKeys.quant(symbol, period, metrics, source), adjustmentMode] as const,
        queryFn: () => api.getQuantMetrics(symbol, { period, metrics, source, adjustmentMode }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useGammaExposure(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        source?: 'KBS' | 'VCI' | 'DNSE';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '3Y';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';

    return useQuery({
        queryKey: queryKeys.gammaExposure(symbol, period, source, adjustmentMode),
        queryFn: () => api.getGammaExposure(symbol, { period, source, adjustmentMode }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useMomentumProfile(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        source?: 'KBS' | 'VCI' | 'DNSE';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '3Y';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';

    return useQuery({
        queryKey: queryKeys.momentumProfile(symbol, period, source, adjustmentMode),
        queryFn: () => api.getMomentumProfile(symbol, { period, source, adjustmentMode }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useEarningsQuality(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.earningsQuality(symbol),
        queryFn: () => api.getEarningsQuality(symbol),
        enabled: enabled && !!symbol,
        staleTime: 15 * 60 * 1000,
        retry: 2,
    });
}

export function useSmartMoneyFlow(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.smartMoneyFlow(symbol),
        queryFn: () => api.getSmartMoneyFlow(symbol),
        enabled: enabled && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useRelativeRotation(
    symbol: string,
    options?: {
        lookbackDays?: number;
        enabled?: boolean;
    }
) {
    const lookbackDays = options?.lookbackDays ?? 260;
    return useQuery({
        queryKey: queryKeys.relativeRotation(symbol, lookbackDays),
        queryFn: () => api.getRelativeRotation(symbol, { lookbackDays }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 10 * 60 * 1000,
        retry: 2,
    });
}

// ============ RS Rating Queries ============

export function useRSLeaders(
    limit: number = 50,
    options?: { sector?: string; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.rsLeaders(limit, options?.sector),
        queryFn: () => api.getRSLeaders({ limit, sector: options?.sector }),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 2,
    });
}

export function useRSLaggards(
    limit: number = 50,
    options?: { sector?: string; enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.rsLaggards(limit, options?.sector),
        queryFn: () => api.getRSLaggards({ limit, sector: options?.sector }),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 2,
    });
}

export function useRSGainers(
    limit: number = 50,
    lookbackDays: number = 7,
    options?: { enabled?: boolean }
) {
    return useQuery({
        queryKey: queryKeys.rsGainers(limit, lookbackDays),
        queryFn: () => api.getRSGainers({ limit, lookbackDays }),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 2,
    });
}

export function useRSRating(symbol: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.rsRating(symbol),
        queryFn: () => api.getRSRating(symbol),
        enabled: enabled && !!symbol,
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: 2,
    });
}

export function useRSRatingHistory(symbol: string, limit: number = 100, enabled = true) {
    return useQuery({
        queryKey: ['rsRatingHistory', symbol, limit] as const,
        queryFn: () => api.getRSHistory(symbol, limit),
        enabled: enabled && !!symbol,
        staleTime: 10 * 60 * 1000, // 10 minutes
        retry: 2,
    });
}


// ============ Market Heatmap Query ============

export function useMarketHeatmap(options?: {
    group_by?: 'sector' | 'industry' | 'vn30' | 'hnx30';
    color_metric?: 'change_pct' | 'weekly_pct' | 'monthly_pct' | 'ytd_pct';
    size_metric?: 'market_cap' | 'volume' | 'value_traded';
    exchange?: 'HOSE' | 'HNX' | 'UPCOM' | 'ALL';
    limit?: number;
    use_cache?: boolean;
    enabled?: boolean;
    refetchInterval?: number;
}) {
    return useQuery({
        queryKey: ['marketHeatmap', options] as const,
        queryFn: () => api.getMarketHeatmap(options),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000, // 1 minute
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}
