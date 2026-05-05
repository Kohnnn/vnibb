/**
 * useStockData Hook
 * 
 * A unified hook for fetching comprehensive stock data.
 * Aggregates profile, quote, and financial metrics with integrated caching.
 */

'use client';

import { useMemo } from 'react';
import { 
    useProfile, 
    useStockQuote, 
    useScreenerData, 
    useHistoricalPrices 
} from '@/lib/queries';
import { apiCache, CACHE_TTL } from '@/lib/apiCache';

export interface UnifiedStockData {
    symbol: string;
    profile: any;
    quote: any;
    metrics: any;
    historical: any;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    isFromCache: boolean;
    refetch: () => void;
}

export function useStockData(symbol: string, enabled = true): UnifiedStockData {
    // Check manual cache for the unified object
    const cacheKey = `unified:${symbol}`;
    const cachedData = apiCache.get<any>(cacheKey);

    // Profile Data (10 min stale)
    const profileQuery = useProfile(symbol, enabled && !cachedData);
    
    // Quote Data (30 sec stale)
    const quoteQuery = useStockQuote(symbol, enabled && !cachedData);
    
    // Financial Metrics (from screener endpoint)
    const metricsQuery = useScreenerData({ 
        symbol, 
        enabled: enabled && !cachedData 
    });

    // Historical Prices
    const historyQuery = useHistoricalPrices(symbol, {
        enabled: enabled && !cachedData
    });

    const isLoading = profileQuery.isLoading || quoteQuery.isLoading || metricsQuery.isLoading;
    const isError = profileQuery.isError || quoteQuery.isError || metricsQuery.isError;
    const error = (profileQuery.error || quoteQuery.error || metricsQuery.error) as Error | null;

    const refetch = () => {
        apiCache.invalidate(`unified:${symbol}`);
        profileQuery.refetch();
        quoteQuery.refetch();
        metricsQuery.refetch();
        historyQuery.refetch();
    };

    const unifiedData = useMemo(() => {
        if (cachedData) return cachedData;

        if (profileQuery.data && quoteQuery.data && metricsQuery.data) {
            const data = {
                symbol,
                profile: profileQuery.data,
                quote: quoteQuery.data,
                metrics: metricsQuery.data.data?.[0] || null,
                historical: historyQuery.data?.data || [],
            };
            
            // Store in manual cache for 1 minute to bridge query transitions
            apiCache.set(cacheKey, data, 60000);
            return data;
        }

        return null;
    }, [symbol, profileQuery.data, quoteQuery.data, metricsQuery.data, historyQuery.data, cachedData]);

    return {
        symbol,
        profile: unifiedData?.profile || null,
        quote: unifiedData?.quote || null,
        metrics: unifiedData?.metrics || null,
        historical: unifiedData?.historical || [],
        isLoading,
        isError,
        error,
        isFromCache: !!cachedData,
        refetch
    };
}
