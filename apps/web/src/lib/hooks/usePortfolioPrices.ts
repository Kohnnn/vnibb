// usePortfolioPrices hook - Fetch real-time prices for portfolio symbols
'use client';

import { useQueries } from '@tanstack/react-query';
import { getQuote, type QuoteResponse } from '@/lib/api';

export interface PositionWithPrice {
    symbol: string;
    currentPrice: number | null;
    change: number | null;
    changePct: number | null;
    isLoading: boolean;
    error: Error | null;
}

export interface PortfolioPricesResult {
    prices: Map<string, PositionWithPrice>;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
}

/**
 * Fetch real-time prices for multiple symbols using parallel queries.
 * Returns a Map for O(1) lookup by symbol.
 */
export function usePortfolioPrices(symbols: string[]): PortfolioPricesResult {
    const queries = useQueries({
        queries: symbols.map(symbol => ({
            queryKey: ['quote', symbol],
            queryFn: () => getQuote(symbol),
            staleTime: 60 * 1000, // 1 minute
            refetchInterval: 60 * 1000, // Auto-refresh every minute
            retry: 2,
            enabled: !!symbol,
        })),
    });

    // Build price map
    const prices = new Map<string, PositionWithPrice>();
    
    queries.forEach((query, idx) => {
        const symbol = symbols[idx];
        if (!symbol) return;

        const data = query.data as QuoteResponse | undefined;
        
        prices.set(symbol, {
            symbol,
            currentPrice: data?.data?.price ?? null,
            change: data?.data?.change ?? null,
            changePct: data?.data?.changePct ?? null,
            isLoading: query.isLoading,
            error: query.error as Error | null,
        });
    });

    const isLoading = queries.some(q => q.isLoading);
    const isError = queries.some(q => q.isError);

    const refetch = () => {
        queries.forEach(q => q.refetch());
    };

    return { prices, isLoading, isError, refetch };
}
