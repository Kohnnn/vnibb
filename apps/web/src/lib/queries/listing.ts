// Listing queries: symbols, exchanges, industries

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';

// ============ Query Keys ============

export const listingQueryKeys = {
    symbols: (limit?: number) => ['symbols', limit] as const,
    symbolsByExchange: (exchange: string) => ['symbolsByExchange', exchange] as const,
    symbolsByGroup: (group: string) => ['symbolsByGroup', group] as const,
    industries: () => ['industries'] as const,
    ttmSnapshot: (symbol: string) => ['ttmSnapshot', symbol] as const,
    growthRates: (symbol: string) => ['growthRates', symbol] as const,
};

// ============ Listing Queries ============

export function useSymbols(options?: { limit?: number; enabled?: boolean }) {
    return useQuery({
        queryKey: listingQueryKeys.symbols(options?.limit),
        queryFn: () => api.getSymbols({ limit: options?.limit }),
        enabled: options?.enabled !== false,
        staleTime: 60 * 60 * 1000,
    });
}

export function useSymbolsByExchange(
    exchange: 'HOSE' | 'HNX' | 'UPCOM',
    enabled = true
) {
    return useQuery({
        queryKey: listingQueryKeys.symbolsByExchange(exchange),
        queryFn: () => api.getSymbolsByExchange(exchange),
        enabled: enabled && !!exchange,
        staleTime: 60 * 60 * 1000,
    });
}

export function useSymbolsByGroup(group: string, enabled = true) {
    return useQuery({
        queryKey: listingQueryKeys.symbolsByGroup(group),
        queryFn: () => api.getSymbolsByGroup(group),
        enabled: enabled && !!group,
        staleTime: 60 * 60 * 1000,
    });
}

export function useIndustries(enabled = true) {
    return useQuery({
        queryKey: listingQueryKeys.industries(),
        queryFn: () => api.getIndustries(),
        enabled,
        staleTime: 24 * 60 * 60 * 1000,
    });
}

export function useTTMSnapshot(symbol: string, enabled = true) {
    return useQuery({
        queryKey: listingQueryKeys.ttmSnapshot(symbol),
        queryFn: () => api.getTTMSnapshot(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useGrowthRates(symbol: string, enabled = true) {
    return useQuery({
        queryKey: listingQueryKeys.growthRates(symbol),
        queryFn: () => api.getGrowthRates(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}
