// Insider Trading API endpoints

import { fetchAPI } from '../client';
import type {
    InsiderTrade,
    BlockTrade,
    InsiderAlert,
    AlertSettings,
    InsiderSentiment
} from '@/types/insider';

export async function getInsiderDeals(
    symbol: string,
    options?: { limit?: number; signal?: AbortSignal }
): Promise<{ data: InsiderTrade[] }> {
    return fetchAPI<{ data: InsiderTrade[] }>(`/insider/deals/${symbol}`, {
        params: {
            limit: options?.limit,
        },
        signal: options?.signal,
    });
}

export async function getRecentInsiderDeals(
    options?: { limit?: number; days?: number; signal?: AbortSignal }
): Promise<{ data: InsiderTrade[] }> {
    return fetchAPI<{ data: InsiderTrade[] }>('/insider/recent', {
        params: {
            limit: options?.limit,
            days: options?.days,
        },
        signal: options?.signal,
    });
}

export async function getInsiderSentiment(symbol: string): Promise<InsiderSentiment> {
    return fetchAPI<InsiderSentiment>(`/insider/sentiment/${symbol}`);
}

export async function getBlockTrades(
    options?: { limit?: number; minValue?: number; signal?: AbortSignal }
): Promise<{ data: BlockTrade[] }> {
    return fetchAPI<{ data: BlockTrade[] }>('/insider/block-trades', {
        params: {
            limit: options?.limit,
            min_value: options?.minValue,
        },
        signal: options?.signal,
    });
}

export async function getInsiderAlerts(
    userId: number,
    options?: { signal?: AbortSignal }
): Promise<{ data: InsiderAlert[] }> {
    return fetchAPI<{ data: InsiderAlert[] }>(`/insider/alerts/${userId}`, {
        signal: options?.signal,
    });
}

export async function markAlertRead(alertId: number): Promise<InsiderAlert> {
    return fetchAPI<InsiderAlert>(`/insider/alerts/${alertId}/read`, {
        method: 'POST',
    });
}

export async function getAlertSettings(userId: number): Promise<AlertSettings> {
    return fetchAPI<AlertSettings>(`/insider/settings/${userId}`);
}

export async function updateAlertSettings(
    userId: number,
    settings: Partial<AlertSettings>
): Promise<AlertSettings> {
    return fetchAPI<AlertSettings>(`/insider/settings/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(settings),
    });
}

export async function getDividends(symbol: string): Promise<unknown> {
    return fetchAPI<unknown>(`/equity/${symbol}/dividends`);
}

export async function getTradingStats(symbol: string): Promise<unknown> {
    return fetchAPI<unknown>(`/equity/${symbol}/trading-stats`);
}
