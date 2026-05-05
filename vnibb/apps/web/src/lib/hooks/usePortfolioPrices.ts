// usePortfolioPrices hook - Fetch real-time prices for portfolio symbols
'use client';

import { useQueries } from '@tanstack/react-query';
import { fetchStockQuote, quoteQueryKey, type StockQuoteView } from '@/lib/queries';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';

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
            queryKey: quoteQueryKey(symbol),
            queryFn: ({ signal }) => fetchStockQuote(symbol, signal),
            staleTime: 30 * 1000, // Align with shared quote cache policy
            refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.quotes),
            refetchIntervalInBackground: false,
            networkMode: 'online' as const,
            retry: 2,
            enabled: !!symbol,
        })),
    });

    // Build price map
    const prices = new Map<string, PositionWithPrice>();
    
    queries.forEach((query, idx) => {
        const symbol = symbols[idx];
        if (!symbol) return;

        const data = query.data as StockQuoteView | undefined;
        
        prices.set(symbol, {
            symbol,
            currentPrice: data?.price ?? null,
            change: data?.change ?? null,
            changePct: data?.changePct ?? null,
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
