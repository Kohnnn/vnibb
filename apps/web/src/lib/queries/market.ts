// Market queries: indices, movers, heatmap, and market overview

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '../pollingPolicy';

// ============ Query Keys ============

export const marketQueryKeys = {
    marketOverview: () => ['marketOverview'] as const,
    marketSentiment: () => ['marketSentiment'] as const,
    trendingAnalysis: () => ['trendingAnalysis'] as const,
    marketBreadth: () => ['marketBreadth'] as const,
    earningsSeason: (exchange?: string, limit?: number) => ['earningsSeason', exchange, limit] as const,
    industryBubble: (params?: Record<string, unknown>) => ['industryBubble', params] as const,
    worldIndices: () => ['worldIndices'] as const,
    forexRates: () => ['forexRates'] as const,
    commodities: () => ['commodities'] as const,
    topMovers: (type: string, index: string, limit: number) => ['topMovers', type, index, limit] as const,
    sectorTopMovers: (type: string, limit: number) => ['sectorTopMovers', type, limit] as const,
    sectorsCatalog: (symbolLimit: number) => ['sectorsCatalog', symbolLimit] as const,
    sectorBoard: (params?: Record<string, unknown>) => ['sectorBoard', params] as const,
    moneyFlowTrend: (params?: Record<string, unknown>) => ['moneyFlowTrend', params] as const,
    sectorPerformance: () => ['sectorPerformance'] as const,
    topGainers: (index: string) => ['topGainers', index] as const,
    topLosers: (index: string) => ['topLosers', index] as const,
    topVolume: (index: string) => ['topVolume', index] as const,
    topValue: (index: string) => ['topValue', index] as const,
    priceBoard: (symbols: string[]) => ['priceBoard', symbols] as const,
    marketHeatmap: (options?: Record<string, unknown>) => ['marketHeatmap', options] as const,
    marketFreshness: () => ['marketFreshness'] as const,
    dataSourcesFreshness: () => ['dataSourcesFreshness'] as const,
};

// ============ Market Overview ============

export function useMarketOverview(enabled = true) {
    return useQuery({
        queryKey: marketQueryKeys.marketOverview(),
        queryFn: ({ signal }) => api.getMarketOverview(signal),
        enabled,
        staleTime: 20 * 1000,
        refetchInterval: enabled
            ? () => getAdaptiveRefetchInterval(POLLING_PRESETS.marketOverview)
            : false,
        refetchIntervalInBackground: false,
    });
}

export function useMarketBreadth(enabled = true) {
    return useQuery({
        queryKey: marketQueryKeys.marketBreadth(),
        queryFn: () => api.getMarketBreadth(),
        enabled,
        staleTime: 60 * 1000,
        retry: 2,
    });
}

export function useMarketSentiment(enabled = true) {
    return useQuery({
        queryKey: marketQueryKeys.marketSentiment(),
        queryFn: () => api.getMarketSentiment(),
        enabled,
        staleTime: 10 * 60 * 1000,
    });
}

export function useTrendingAnalysis(enabled = true) {
    return useQuery({
        queryKey: marketQueryKeys.trendingAnalysis(),
        queryFn: () => api.getTrendingAnalysis(),
        enabled,
        staleTime: 10 * 60 * 1000,
    });
}

// ============ Global Markets ============

export function useWorldIndices(enabled = true) {
    return useQuery({
        queryKey: marketQueryKeys.worldIndices(),
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
        queryKey: marketQueryKeys.forexRates(),
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
        queryKey: marketQueryKeys.commodities(),
        queryFn: () => api.getCommodities({ limit: 20 }),
        enabled,
        staleTime: 5 * 60 * 1000,
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.movers),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

// ============ Top Movers ============

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
        queryKey: marketQueryKeys.topMovers(type, index, limit),
        queryFn: () => api.getTopMovers({ type, index, limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
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
        queryKey: marketQueryKeys.sectorTopMovers(type, limit),
        queryFn: () => api.getSectorTopMovers({ type, limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchInterval:
            options?.refetchInterval ??
            (() => getAdaptiveRefetchInterval(POLLING_PRESETS.movers)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

export function useTopGainers(
    index: 'VNINDEX' | 'HNX' | 'VN30' = 'VNINDEX',
    options?: { limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: marketQueryKeys.topGainers(index),
        queryFn: () => api.getTopGainers({ index, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

export function useTopLosers(
    index: 'VNINDEX' | 'HNX' | 'VN30' = 'VNINDEX',
    options?: { limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: marketQueryKeys.topLosers(index),
        queryFn: () => api.getTopLosers({ index, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

export function useTopVolume(
    index: 'VNINDEX' | 'HNX' | 'VN30' = 'VNINDEX',
    options?: { limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: marketQueryKeys.topVolume(index),
        queryFn: () => api.getTopVolume({ index, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

export function useTopValue(
    index: 'VNINDEX' | 'HNX' | 'VN30' = 'VNINDEX',
    options?: { limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: marketQueryKeys.topValue(index),
        queryFn: () => api.getTopValue({ index, limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

// ============ Price Board ============

export function usePriceBoard(
    symbols: string[],
    options?: { enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: marketQueryKeys.priceBoard(symbols),
        queryFn: () => api.getPriceBoard(symbols),
        enabled: options?.enabled !== false && symbols.length > 0,
        staleTime: 10 * 1000,
        refetchInterval:
            options?.refetchInterval ??
            (() => getAdaptiveRefetchInterval(POLLING_PRESETS.priceBoard)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
    });
}

// ============ Sector Analysis ============

export function useSectorPerformance(options?: {
    enabled?: boolean;
    refetchInterval?: number;
}) {
    return useQuery({
        queryKey: marketQueryKeys.sectorPerformance(),
        queryFn: () => api.getSectorPerformance(),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchInterval:
            options?.refetchInterval ??
            (() => getAdaptiveRefetchInterval(POLLING_PRESETS.movers)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
        retry: 2,
    });
}

export function useSectorsCatalog(options?: {
    symbolLimit?: number;
    enabled?: boolean;
}) {
    const symbolLimit = options?.symbolLimit || 50;

    return useQuery({
        queryKey: marketQueryKeys.sectorsCatalog(symbolLimit),
        queryFn: () => api.getSectorsCatalog({ symbolLimit }),
        enabled: options?.enabled !== false,
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
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
        queryKey: marketQueryKeys.sectorBoard(options),
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
        queryKey: marketQueryKeys.moneyFlowTrend(options),
        queryFn: () => api.getMoneyFlowTrend(options),
        enabled: options?.enabled !== false && Boolean(options?.symbol || options?.symbols || options?.sector),
        staleTime: 2 * 60 * 1000,
        retry: 2,
    });
}

// ============ Earnings & Industry ============

export function useEarningsSeason(options?: { exchange?: string; limit?: number; enabled?: boolean }) {
    return useQuery({
        queryKey: marketQueryKeys.earningsSeason(options?.exchange, options?.limit),
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
        queryKey: marketQueryKeys.industryBubble(options),
        queryFn: () => api.getIndustryBubble(options),
        enabled: options.enabled !== false && !!options.symbol,
        staleTime: 5 * 60 * 1000,
    });
}

// ============ Market Heatmap ============

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
        queryKey: marketQueryKeys.marketHeatmap(options),
        queryFn: () => api.getMarketHeatmap(options),
        enabled: options?.enabled !== false,
        staleTime: 60 * 1000,
        refetchInterval: options?.refetchInterval,
        retry: 2,
    });
}

// ============ System Freshness ============

export function useMarketFreshness(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: marketQueryKeys.marketFreshness(),
        queryFn: () => api.getMarketFreshness(),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000,
        refetchInterval: 10 * 60 * 1000,
    });
}

export function useDataSourcesFreshness(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: marketQueryKeys.dataSourcesFreshness(),
        queryFn: () => api.getDataSourcesFreshness(),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000,
        refetchInterval: 10 * 60 * 1000,
    });
}
