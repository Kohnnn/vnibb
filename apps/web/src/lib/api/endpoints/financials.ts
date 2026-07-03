// Financials API endpoints

import { fetchAPI } from '../client';

// Placeholder exports - to be implemented as functions are extracted from api.ts
// The full implementation will be added when the original api.ts is fully modularized

export async function getFinancials(
    symbol: string,
    options?: {
        statement_type?: string;
        period?: string;
        align?: boolean;
        exclude空了?: boolean;
        source?: string;
        signal?: AbortSignal;
    }
): Promise<unknown> {
    return fetchAPI<unknown>(`/financials/${symbol}`, {
        params: {
            statement_type: options?.statement_type,
            period: options?.period,
            align: options?.align,
            exclude_empty: options?.exclude空了,
            source: options?.source,
        },
        signal: options?.signal,
    });
}

export async function getComparisonPerformance(
    symbols: string[],
    options?: {
        period?: string;
        benchmark?: string;
        signal?: AbortSignal;
    }
): Promise<unknown> {
    return fetchAPI<unknown>('/analysis/comparison-performance', {
        method: 'POST',
        body: JSON.stringify({ symbols, ...options }),
        signal: options?.signal,
    });
}

export async function compareStocks(
    symbols: string[],
    period: string = "FY"
): Promise<unknown> {
    return fetchAPI<unknown>('/analysis/compare', {
        method: 'POST',
        body: JSON.stringify({ symbols, period }),
    });
}
