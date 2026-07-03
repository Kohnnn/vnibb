// Market API endpoints

import { fetchAPI } from '../client';
import type { MarketOverviewResponse } from '@/types/equity';

// Re-export types that are shared
export type { QuoteData, QuoteResponse } from './equity';

export async function getMarketOverview(signal?: AbortSignal): Promise<MarketOverviewResponse> {
    return fetchAPI<MarketOverviewResponse>('/market/overview', {
        timeout: 15000,
        signal,
    });
}

export async function getWorldIndices(options?: { limit?: number }): Promise<unknown> {
    return fetchAPI<unknown>('/market/world-indices', {
        params: {
            limit: options?.limit,
        },
    });
}

export async function getForexRates(options?: { limit?: number }): Promise<unknown> {
    return fetchAPI<unknown>('/market/forex-rates', {
        params: {
            limit: options?.limit,
        },
    });
}

export async function getCommodities(options?: { limit?: number }): Promise<unknown> {
    return fetchAPI<unknown>('/market/commodities', {
        params: {
            limit: options?.limit,
        },
    });
}

export async function getMarketBreadth(): Promise<unknown> {
    return fetchAPI<unknown>('/market/breadth');
}

export async function getMarketHeatmap(options?: {
    index?: string;
    sortBy?: string;
    limit?: number;
    signal?: AbortSignal;
}): Promise<unknown> {
    return fetchAPI<unknown>('/market/heatmap', {
        params: {
            index: options?.index,
            sort_by: options?.sortBy,
            limit: options?.limit,
        },
        signal: options?.signal,
    });
}

export async function getIndustryBubble(options: {
    index?: string;
    period?: string;
    limit?: number;
    signal?: AbortSignal;
}): Promise<unknown> {
    return fetchAPI<unknown>('/market/industry-bubble', {
        params: {
            index: options.index,
            period: options.period,
            limit: options.limit,
        },
        signal: options.signal,
    });
}

export async function getSectorsCatalog(options?: { signal?: AbortSignal }): Promise<unknown> {
    return fetchAPI<unknown>('/market/sectors', {
        signal: options?.signal,
    });
}

export async function getSectorPerformance(_options?: {
    index?: string;
    period?: string;
    signal?: AbortSignal;
}): Promise<unknown> {
    return fetchAPI<unknown>('/market/sector-performance');
}

export async function getTopGainers(options?: {
    index?: string;
    limit?: number;
    signal?: AbortSignal;
}): Promise<unknown> {
    return fetchAPI<unknown>('/market/top-gainers', {
        params: {
            index: options?.index,
            limit: options?.limit,
        },
        signal: options?.signal,
    });
}

export async function getTopLosers(options?: {
    index?: string;
    limit?: number;
    signal?: AbortSignal;
}): Promise<unknown> {
    return fetchAPI<unknown>('/market/top-losers', {
        params: {
            index: options?.index,
            limit: options?.limit,
        },
        signal: options?.signal,
    });
}

export async function getTopVolume(options?: {
    index?: string;
    limit?: number;
    signal?: AbortSignal;
}): Promise<unknown> {
    return fetchAPI<unknown>('/market/top-volume', {
        params: {
            index: options?.index,
            limit: options?.limit,
        },
        signal: options?.signal,
    });
}

export async function getTopValue(options?: {
    index?: string;
    limit?: number;
    signal?: AbortSignal;
}): Promise<unknown> {
    return fetchAPI<unknown>('/market/top-value', {
        params: {
            index: options?.index,
            limit: options?.limit,
        },
        signal: options?.signal,
    });
}
