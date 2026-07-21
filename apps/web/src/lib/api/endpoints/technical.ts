// Technical Analysis API endpoints

import { fetchAPI } from '../client';
import type {
    FibonacciRetracementResponse,
    FullTechnicalAnalysis,
    IchimokuSeriesResponse,
    SignalSummary,
    TechnicalIndicators,
} from '@/types/technical';

export async function getTechnicalIndicators(
    symbol: string,
    options?: {
        interval?: string;
        period?: number;
        indicators?: string[];
        signal?: AbortSignal;
    }
): Promise<TechnicalIndicators> {
    return fetchAPI<TechnicalIndicators>(`/analysis/indicators/${symbol}`, {
        params: {
            interval: options?.interval,
            period: options?.period,
            indicators: options?.indicators?.join(','),
        },
        signal: options?.signal,
    });
}

export async function getFullTechnicalAnalysis(
    symbol: string,
    options?: {
        timeframe?: 'D' | 'W' | 'M';
        lookbackDays?: number;
        signal?: AbortSignal;
    }
): Promise<FullTechnicalAnalysis> {
    return fetchAPI<FullTechnicalAnalysis>(`/analysis/ta/${symbol}/full`, {
        params: {
            timeframe: options?.timeframe,
            lookback_days: options?.lookbackDays,
        },
        signal: options?.signal,
    });
}

export async function getTechnicalHistory(
    symbol: string,
    options?: {
        interval?: string;
        period?: number;
        signal?: AbortSignal;
    }
): Promise<unknown> {
    return fetchAPI<unknown>(`/analysis/history/${symbol}`, {
        params: {
            interval: options?.interval,
            period: options?.period,
        },
        signal: options?.signal,
    });
}

export async function getIchimokuSeries(
    symbol: string,
    options?: {
        interval?: string;
        signal?: AbortSignal;
    }
): Promise<IchimokuSeriesResponse> {
    return fetchAPI<IchimokuSeriesResponse>(`/analysis/ichimoku/${symbol}`, {
        params: {
            interval: options?.interval,
        },
        signal: options?.signal,
    });
}

export async function getFibonacciRetracement(
    symbol: string,
    options?: {
        interval?: string;
        start_date?: string;
        end_date?: string;
        signal?: AbortSignal;
    }
): Promise<FibonacciRetracementResponse> {
    return fetchAPI<FibonacciRetracementResponse>(`/analysis/fibonacci/${symbol}`, {
        params: {
            interval: options?.interval,
            start_date: options?.start_date,
            end_date: options?.end_date,
        },
        signal: options?.signal,
    });
}

export async function getSignalSummary(
    symbol: string,
    options?: {
        interval?: string;
        signal?: AbortSignal;
    }
): Promise<SignalSummary> {
    return fetchAPI<SignalSummary>(`/analysis/signals/${symbol}`, {
        params: {
            interval: options?.interval,
        },
        signal: options?.signal,
    });
}
