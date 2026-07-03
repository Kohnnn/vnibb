// Comparison queries: peer companies and stock comparison

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '../pollingPolicy';

// ============ Comparison Queries ============

export function useComparison(
    symbols: string[],
    options?: { enabled?: boolean; refetchInterval?: number; period?: string }
) {
    return useQuery({
        queryKey: ['comparison', symbols.join(','), options?.period ?? 'FY'] as const,
        queryFn: () => api.compareStocks(symbols, options?.period ?? 'FY'),
        enabled: options?.enabled !== false && symbols.length > 0,
        staleTime: 60 * 1000,
        refetchInterval:
            options?.refetchInterval ??
            (() => getAdaptiveRefetchInterval(POLLING_PRESETS.movers)),
        refetchIntervalInBackground: false,
        networkMode: 'online',
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
        staleTime: 24 * 60 * 60 * 1000,
        retry: 2,
    });
}
