// Technical analysis queries: indicators, chart data, patterns

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import type { Timeframe } from '@/types/technical';

// ============ Query Keys ============

export const technicalQueryKeys = {
    taFull: (symbol: string, timeframe: string) => ['taFull', symbol, timeframe] as const,
    taHistory: (symbol: string, days: number) => ['taHistory', symbol, days] as const,
    taIchimoku: (symbol: string, period: string) => ['taIchimoku', symbol, period] as const,
    taFibonacci: (symbol: string, lookbackDays: number, direction: string) =>
        ['taFibonacci', symbol, lookbackDays, direction] as const,
    microstructure: (symbol: string, params?: Record<string, unknown>) => ['microstructure', symbol, params] as const,
};

// ============ Technical Analysis Queries ============

export function useFullTechnicalAnalysis(
    symbol: string,
    options?: { timeframe?: Timeframe; lookbackDays?: number; enabled?: boolean }
) {
    const timeframe = options?.timeframe || 'D';
    return useQuery({
        queryKey: technicalQueryKeys.taFull(symbol, timeframe),
        queryFn: () => api.getFullTechnicalAnalysis(symbol, { ...options, timeframe }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
    });
}

export function useTechnicalHistory(
    symbol: string,
    options?: { days?: number; enabled?: boolean }
) {
    const days = options?.days || 30;
    return useQuery({
        queryKey: technicalQueryKeys.taHistory(symbol, days),
        queryFn: () => api.getTechnicalHistory(symbol, { days }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
    });
}

export function useIchimokuSeries(
    symbol: string,
    options?: { period?: '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y'; enabled?: boolean }
) {
    const period = options?.period || '1Y';
    return useQuery({
        queryKey: technicalQueryKeys.taIchimoku(symbol, period),
        queryFn: () => api.getIchimokuSeries(symbol, { period }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useFibonacciRetracement(
    symbol: string,
    options?: { lookbackDays?: number; direction?: 'auto' | 'up' | 'down'; enabled?: boolean }
) {
    const lookbackDays = options?.lookbackDays ?? 252;
    const direction = options?.direction || 'auto';
    return useQuery({
        queryKey: technicalQueryKeys.taFibonacci(symbol, lookbackDays, direction),
        queryFn: () => api.getFibonacciRetracement(symbol, { lookbackDays, direction }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useMicrostructureAnalysis(
    symbol: string,
    options?: {
        features?: string[];
        interval?: string;
        lookbackDays?: number;
        valueAreaPct?: number;
        fractalWindow?: number;
        imbalanceRatio?: number;
        enabled?: boolean;
    }
) {
    const params = {
        features: options?.features,
        interval: options?.interval ?? '5m',
        lookbackDays: options?.lookbackDays ?? 7,
        valueAreaPct: options?.valueAreaPct ?? 0.7,
        fractalWindow: options?.fractalWindow ?? 2,
        imbalanceRatio: options?.imbalanceRatio ?? 3,
    };

    return useQuery({
        queryKey: technicalQueryKeys.microstructure(symbol, params),
        queryFn: () => api.getMicrostructureAnalysis(symbol, params),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 30 * 1000,
        retry: 1,
    });
}
