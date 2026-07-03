// Widget hooks for data fetching and state management

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAPI } from '@/lib/api/client';
import type { WidgetHealthStatus } from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const widgetQueryKeys = {
  all: ['widgets'] as const,
  detail: (id: string) => ['widgets', id] as const,
  data: (id: string, endpoint: string) => ['widgets', id, endpoint] as const,
};

// ============================================================================
// Data Fetching Hooks
// ============================================================================

/**
 * Generic widget data fetcher
 */
export function useWidgetData<T>(
  widgetId: string,
  endpoint: string,
  params?: Record<string, unknown>,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) {
  const [healthStatus, setHealthStatus] = useState<WidgetHealthStatus>('unknown');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const query = useQuery({
    queryKey: [...widgetQueryKeys.data(widgetId, endpoint), params],
    queryFn: async () => {
      setHealthStatus('unknown');
      try {
        const data = await fetchAPI<T>(endpoint, { params: params as Record<string, string | number | boolean | undefined> });
        setHealthStatus('healthy');
        setLastUpdated(new Date());
        return data;
      } catch (error) {
        setHealthStatus('error');
        throw error;
      }
    },
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes default
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  return {
    ...query,
    healthStatus,
    lastUpdated,
  };
}

// ============================================================================
// Equity Widget Hooks
// ============================================================================

/**
 * Fetch quote data for a symbol
 */
export function useEquityQuote(symbol: string, options?: { enabled?: boolean }) {
  return useWidgetData<{ symbol: string; data: Record<string, unknown> }>(
    `quote-${symbol}`,
    `/equity/${symbol}/quote`,
    undefined,
    { enabled: !!symbol && options?.enabled !== false, staleTime: 30 * 1000 }
  );
}

/**
 * Fetch profile data for a symbol
 */
export function useEquityProfile(symbol: string, options?: { enabled?: boolean }) {
  return useWidgetData(
    `profile-${symbol}`,
    `/equity/${symbol}/profile`,
    undefined,
    { enabled: !!symbol && options?.enabled !== false }
  );
}

/**
 * Fetch historical prices for a symbol
 */
export function useEquityHistorical(
  symbol: string,
  params?: {
    interval?: string;
    startDate?: string;
    endDate?: string;
  },
  options?: { enabled?: boolean }
) {
  return useWidgetData(
    `historical-${symbol}`,
    '/equity/historical',
    { symbol, ...params },
    { enabled: !!symbol && options?.enabled !== false }
  );
}

/**
 * Fetch financial ratios for a symbol
 */
export function useFinancialRatios(
  symbol: string,
  params?: { period?: string },
  options?: { enabled?: boolean }
) {
  return useWidgetData(
    `ratios-${symbol}`,
    `/equity/${symbol}/ratios`,
    params,
    { enabled: !!symbol && options?.enabled !== false }
  );
}

// ============================================================================
// Market Widget Hooks
// ============================================================================

/**
 * Fetch market overview
 */
export function useMarketOverview(options?: { enabled?: boolean }) {
  return useWidgetData(
    'market-overview',
    '/market/overview',
    undefined,
    { enabled: options?.enabled !== false, staleTime: 60 * 1000 }
  );
}

/**
 * Fetch top movers
 */
export function useTopMovers(
  type: 'gainers' | 'losers' | 'volume',
  options?: { enabled?: boolean }
) {
  const endpoint = type === 'volume' ? '/market/top-volume' 
    : type === 'losers' ? '/market/top-losers' 
    : '/market/top-gainers';
  
  return useWidgetData(
    `top-${type}`,
    endpoint,
    undefined,
    { enabled: options?.enabled !== false, staleTime: 60 * 1000 }
  );
}

// ============================================================================
// Health Utilities
// ============================================================================

/**
 * Determine health status based on query state
 */
export function useWidgetHealth() {
  const queryClient = useQueryClient();
  
  const getHealthStatus = useCallback((widgetId: string): WidgetHealthStatus => {
    const queryCache = queryClient.getQueryCache();
    const queries = queryCache.getAll() as unknown as Array<{ queryKey: unknown[]; state: { status: string }; isStale: boolean }>;
    const matchingQuery = queries.find(q => 
      q.queryKey[0] === 'widgets' && 
      typeof q.queryKey[1] === 'string' && 
      q.queryKey[1].startsWith(widgetId)
    );
    
    if (!matchingQuery) return 'unknown';
    if (matchingQuery.state.status === 'error') return 'error';
    if (matchingQuery.isStale) return 'stale';
    return 'healthy';
  }, [queryClient]);
  
  return { getHealthStatus };
}
