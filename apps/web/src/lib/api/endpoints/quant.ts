// Quant API endpoints

import { fetchAPI } from '../client';

export async function getQuantMetrics(
    symbol: string,
    options?: {
        period?: string;
        signal?: AbortSignal;
    }
): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/metrics/${symbol}`, {
        params: {
            period: options?.period,
        },
        signal: options?.signal,
    });
}

export async function getSeasonalityMatrix(
    symbol: string,
    options?: {
        interval?: string;
        years?: number;
        signal?: AbortSignal;
    }
): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/seasonality/${symbol}`, {
        params: {
            interval: options?.interval,
            years: options?.years,
        },
        signal: options?.signal,
    });
}

export async function runQuantBacktest(
    symbol: string,
    options?: {
        strategy?: string;
        start_date?: string;
        end_date?: string;
        signal?: AbortSignal;
    }
): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/backtest/${symbol}`, {
        method: 'POST',
        body: options ? JSON.stringify(options) : undefined,
        signal: options?.signal,
    });
}

export async function runQuantSweep(
    symbol: string,
    options?: {
        parameters?: Record<string, unknown>;
        signal?: AbortSignal;
    }
): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/sweep/${symbol}`, {
        method: 'POST',
        body: options?.parameters ? JSON.stringify(options.parameters) : undefined,
        signal: options?.signal,
    });
}

export async function getMarketStructureTests(
    symbol: string,
    options?: { signal?: AbortSignal }
): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/structure/${symbol}`, {
        signal: options?.signal,
    });
}

export async function getPairDiagnostics(
    symbol1: string,
    symbol2: string,
    options?: { signal?: AbortSignal }
): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/pair/${symbol1}/${symbol2}`, {
        signal: options?.signal,
    });
}

export async function getGammaExposure(
    symbol: string,
    options?: { signal?: AbortSignal }
): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/gamma/${symbol}`, {
        signal: options?.signal,
    });
}

export async function getMomentumProfile(
    symbol: string,
    options?: { signal?: AbortSignal }
): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/momentum/${symbol}`, {
        signal: options?.signal,
    });
}

export async function getEarningsQuality(symbol: string): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/earnings-quality/${symbol}`);
}

export async function getSmartMoneyFlow(symbol: string): Promise<unknown> {
    return fetchAPI<unknown>(`/quant/smart-money/${symbol}`);
}

export async function getRelativeRotation(
    symbols: string[],
    options?: {
        period?: string;
        signal?: AbortSignal;
    }
): Promise<unknown> {
    return fetchAPI<unknown>('/quant/relative-rotation', {
        method: 'POST',
        body: JSON.stringify({ symbols, period: options?.period }),
        signal: options?.signal,
    });
}
