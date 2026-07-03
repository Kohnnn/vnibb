// Screener queries: stock screener data and snapshots

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { logClientError } from '../clientLogger';
import { useDataSources } from '@/contexts/DataSourcesContext';
import type { VnstockSource } from '@/contexts/DataSourcesContext';

// Helper hook to get the preferred VnStock source
function useVnstockSource(): VnstockSource {
    try {
        const { preferredVnstockSource } = useDataSources();
        return preferredVnstockSource;
    } catch {
        return 'KBS';
    }
}

// ============ Query Keys ============

export const screenerQueryKeys = {
    screener: (params?: Record<string, unknown>) => ['screener', params] as const,
};

// ============ Screener Queries ============

export function useScreenerData(options?: {
    symbol?: string;
    exchange?: string;
    industry?: string;
    limit?: number;
    source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
    // Dynamic filters (new)
    filters?: string;
    sort?: string;
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
    let preferredSource: VnstockSource = 'KBS';

    try {
        const { preferredVnstockSource } = useDataSources();
        preferredSource = preferredVnstockSource;
    } catch {
        // Outside of DataSourcesProvider, use default
    }

    const source = options?.source ?? preferredSource;

    return useQuery({
        queryKey: screenerQueryKeys.screener({ ...options, source }),
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
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 2,
    });
}
