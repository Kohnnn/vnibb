// Insider queries: insider deals, alerts, and sentiment

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api';
import type { AlertSettings } from '@/types/insider';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '../pollingPolicy';

// ============ Query Keys ============

export const insiderQueryKeys = {
    insiderDeals: (symbol: string) => ['insiderDeals', symbol] as const,
    recentInsiderDeals: (limit?: number) => ['recentInsiderDeals', limit] as const,
    insiderSentiment: (symbol: string, days: number) => ['insiderSentiment', symbol, days] as const,
    blockTrades: (symbol?: string, limit?: number) => ['blockTrades', symbol, limit] as const,
    insiderAlerts: (userId?: number, unreadOnly?: boolean) => ['insiderAlerts', userId, unreadOnly] as const,
    alertSettings: (userId: number) => ['alertSettings', userId] as const,
};

// ============ Insider Queries ============

export function useInsiderDeals(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: insiderQueryKeys.insiderDeals(symbol),
        queryFn: () => api.getInsiderDeals(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 10 * 60 * 1000,
    });
}

export function useRecentInsiderDeals(options?: { limit?: number; enabled?: boolean }) {
    return useQuery({
        queryKey: insiderQueryKeys.recentInsiderDeals(options?.limit),
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
        queryKey: insiderQueryKeys.insiderSentiment(symbol, days),
        queryFn: () => api.getInsiderSentiment(symbol, days),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useBlockTrades(
    options?: { symbol?: string; limit?: number; enabled?: boolean; refetchInterval?: number }
) {
    return useQuery({
        queryKey: insiderQueryKeys.blockTrades(options?.symbol, options?.limit),
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
        queryKey: insiderQueryKeys.insiderAlerts(options?.userId, options?.unreadOnly),
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
        queryKey: insiderQueryKeys.alertSettings(userId),
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
            queryClient.invalidateQueries({ queryKey: insiderQueryKeys.alertSettings(userId) });
        },
    });
}
