// TanStack Query hooks for data fetching

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { DashboardCreate, WidgetCreate } from '@/types/dashboard';
import type { AlertSettings } from '@/types/insider';
import { useDataSources, type VnstockSource } from '@/contexts/DataSourcesContext';

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
    historical: (symbol: string) => ['historical', symbol] as const,
    profile: (symbol: string) => ['profile', symbol] as const,
    companyNews: (symbol: string) => ['companyNews', symbol] as const,
    companyEvents: (symbol: string) => ['companyEvents', symbol] as const,
    shareholders: (symbol: string) => ['shareholders', symbol] as const,
    officers: (symbol: string) => ['officers', symbol] as const,
    intraday: (symbol: string) => ['intraday', symbol] as const,
    financialRatios: (symbol: string, period: string) => ['financialRatios', symbol, period] as const,
    foreignTrading: (symbol: string) => ['foreignTrading', symbol] as const,
    subsidiaries: (symbol: string) => ['subsidiaries', symbol] as const,
    balanceSheet: (symbol: string, period: string) => ['balanceSheet', symbol, period] as const,
    incomeStatement: (symbol: string, period: string) => ['incomeStatement', symbol, period] as const,
    cashFlow: (symbol: string, period: string) => ['cashFlow', symbol, period] as const,
    marketOverview: () => ['marketOverview'] as const,
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
    // RS Rating System (Phase 2)
    rsLeaders: (limit: number, sector?: string) => ['rsLeaders', limit, sector] as const,
    rsLaggards: (limit: number, sector?: string) => ['rsLaggards', limit, sector] as const,
    rsGainers: (limit: number, lookbackDays: number) => ['rsGainers', limit, lookbackDays] as const,
};

// ============ Equity Queries ============

export function useHistoricalPrices(
    symbol: string,
    options?: {
        startDate?: string;
        endDate?: string;
        interval?: string;
        source?: string;
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

    return useQuery({
        queryKey: [...queryKeys.historical(symbol), source],
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
                console.error(`[useProfile] Failed to fetch profile for ${symbol}:`, error);
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
    const period = options?.period || 'year';
    return useQuery({
        queryKey: queryKeys.financialRatios(symbol, period),
        queryFn: ({ signal }) => api.getFinancialRatios(symbol, { period }, signal),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
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
    options?: { period?: string; enabled?: boolean }
) {
    const period = options?.period || 'year';
    return useQuery({
        queryKey: queryKeys.balanceSheet(symbol, period),
        queryFn: () => api.getBalanceSheet(symbol, { period }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}

export function useIncomeStatement(
    symbol: string,
    options?: { period?: string; enabled?: boolean }
) {
    const period = options?.period || 'year';
    return useQuery({
        queryKey: queryKeys.incomeStatement(symbol, period),
        queryFn: () => api.getIncomeStatement(symbol, { period }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}

export function useCashFlow(
    symbol: string,
    options?: { period?: string; enabled?: boolean }
) {
    const period = options?.period || 'year';
    return useQuery({
        queryKey: queryKeys.cashFlow(symbol, period),
        queryFn: () => api.getCashFlow(symbol, { period }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
}


export function useMarketOverview(enabled = true) {
    return useQuery({
        queryKey: queryKeys.marketOverview(),
        queryFn: ({ signal }) => api.getMarketOverview(signal),
        enabled,
        staleTime: 60 * 1000, // 1 minute
    });
}


// ============ Screener Queries ============

export function useScreenerData(options?: {
    symbol?: string;
    exchange?: string;
    industry?: string;
    limit?: number;
    source?: 'VCI' | 'TCBS' | 'DNSE';
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
                console.error(`[useScreenerData] Failed to fetch screener data:`, error);
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

export function useDashboards(userId = 'anonymous') {
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
        refetchInterval: options?.refetchInterval ?? 60000, // Auto-refresh every 1 min
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
        refetchInterval: options?.refetchInterval ?? 60000, // Auto-refresh every 1 min
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
        refetchInterval: options?.refetchInterval ?? 60000, // Auto-refresh every 1 min
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
        refetchInterval: options?.refetchInterval ?? 30000,
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

/**
 * Hook to fetch current stock quote from dedicated quote endpoint.
 * Uses 30-second cache for real-time freshness.
 */
export function useStockQuote(symbol: string, enabled = true) {
    return useQuery({
        queryKey: quoteQueryKey(symbol),
        queryFn: async ({ signal }) => {
            try {
                const response = await api.getQuote(symbol, signal);
                // Transform to consistent interface
                return {
                    symbol: response.symbol,
                    price: response.data.price,
                    change: response.data.change,
                    changePct: response.data.changePct,
                    volume: response.data.volume,
                    high: response.data.high,
                    low: response.data.low,
                    open: response.data.open,
                    cached: response.cached,
                };
            } catch (error) {
                console.error(`[useStockQuote] Failed to fetch quote for ${symbol}:`, error);
                throw error;
            }
        },
        enabled: enabled && !!symbol,

        staleTime: 30 * 1000,  // 30 seconds - real-time needs freshness
        refetchInterval: 30000, // Auto-refresh every 30 seconds
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
        period?: 'year' | 'quarter';
        limit?: number;
        enabled?: boolean;
    }
) {
    const type = options?.type || 'income';
    const period = options?.period || 'year';
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
    options?: { enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: ['comparison', symbols.join(',')] as const,
        queryFn: () => api.compareStocks(symbols),
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

