// Equity queries: stock quotes, profiles, financials, and related data

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { logClientError } from '../clientLogger';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '../pollingPolicy';
import { useDataSources } from '@/contexts/DataSourcesContext';
import type { VnstockSource } from '@/contexts/DataSourcesContext';

// Helper hook to get the preferred VnStock source
export function useVnstockSource(): VnstockSource {
    try {
        const { preferredVnstockSource } = useDataSources();
        return preferredVnstockSource;
    } catch {
        return 'KBS';
    }
}

// ============ Query Keys ============

export const equityQueryKeys = {
    profile: (symbol: string) => ['profile', symbol] as const,
    companyNews: (symbol: string) => ['companyNews', symbol] as const,
    companyEvents: (symbol: string) => ['companyEvents', symbol] as const,
    analystEstimates: (symbol: string) => ['analystEstimates', symbol] as const,
    fundamentalAnalysis: (symbol: string) => ['fundamentalAnalysis', symbol] as const,
    shareholders: (symbol: string) => ['shareholders', symbol] as const,
    officers: (symbol: string) => ['officers', symbol] as const,
    intraday: (symbol: string) => ['intraday', symbol] as const,
    financialRatios: (symbol: string, period: string) => ['financialRatios', symbol, period] as const,
    ratioHistory: (symbol: string, period: string, ratios: string[]) => ['ratioHistory', symbol, period, ratios] as const,
    metricsHistory: (symbol: string, limit?: number) => ['metricsHistory', symbol, limit] as const,
    foreignTrading: (symbol: string, limit?: number) => ['foreignTrading', symbol, limit] as const,
    transactionFlow: (symbol: string, days: number) => ['transactionFlow', symbol, days] as const,
    flowCoverage: (days: number) => ['flowCoverage', days] as const,
    correlationMatrix: (symbol: string, days: number, topN: number) => ['correlationMatrix', symbol, days, topN] as const,
    subsidiaries: (symbol: string) => ['subsidiaries', symbol] as const,
    balanceSheet: (symbol: string, period: string) => ['balanceSheet', symbol, period] as const,
    incomeStatement: (symbol: string, period: string) => ['incomeStatement', symbol, period] as const,
    cashFlow: (symbol: string, period: string) => ['cashFlow', symbol, period] as const,
    ownership: (symbol: string) => ['ownership', symbol] as const,
    rating: (symbol: string) => ['rating', symbol] as const,
    financials: (symbol: string, type: string, period: string) => ['financials', symbol, type, period] as const,
    priceDepth: (symbol: string) => ['priceDepth', symbol] as const,
    dividends: (symbol: string) => ['dividends', symbol] as const,
    tradingStats: (symbol: string) => ['tradingStats', symbol] as const,
    rsRating: (symbol: string) => ['rsRating', symbol] as const,
    rsRatingHistory: (symbol: string, limit: number) => ['rsRatingHistory', symbol, limit] as const,
};

// ============ Profile & Company Queries ============

export function useProfile(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.profile(symbol),
        queryFn: async ({ signal }) => {
            try {
                return await api.getProfile(symbol, signal);
            } catch (error) {
                if ((error as Error)?.name === 'AbortError') {
                    throw error;
                }
                logClientError(`[useProfile] Failed to fetch profile for ${symbol}:`, error);
                throw error;
            }
        },
        enabled: enabled && !!symbol,
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 2,
    });
}

export function useCompanyNews(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: equityQueryKeys.companyNews(symbol),
        queryFn: () => api.getCompanyNews(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
    });
}

export function useCompanyEvents(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: equityQueryKeys.companyEvents(symbol),
        queryFn: () => api.getCompanyEvents(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 10 * 60 * 1000,
    });
}

export function useAnalystEstimates(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.analystEstimates(symbol),
        queryFn: () => api.getAnalystEstimates(symbol),
        enabled: enabled && !!symbol,
        staleTime: 10 * 60 * 1000,
    });
}

export function useFundamentalAnalysis(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.fundamentalAnalysis(symbol),
        queryFn: ({ signal }) => api.getFundamentalAnalysis(symbol, signal),
        enabled: enabled && !!symbol,
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

export function useShareholders(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.shareholders(symbol),
        queryFn: () => api.getShareholders(symbol),
        enabled: enabled && !!symbol,
        staleTime: 30 * 60 * 1000,
    });
}

export function useOfficers(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.officers(symbol),
        queryFn: () => api.getOfficers(symbol),
        enabled: enabled && !!symbol,
        staleTime: 30 * 60 * 1000,
    });
}

// ============ Trading Data Queries ============

export function useIntraday(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: equityQueryKeys.intraday(symbol),
        queryFn: () => api.getIntraday(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 30 * 1000,
    });
}

export function usePriceDepth(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.priceDepth(symbol),
        queryFn: () => api.getPriceDepth(symbol),
        enabled: enabled && !!symbol,
        staleTime: 5 * 1000,
    });
}

export function useForeignTrading(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: equityQueryKeys.foreignTrading(symbol, options?.limit),
        queryFn: () => api.getForeignTrading(symbol, { limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.foreignTrading),
    });
}

export function useTransactionFlow(
    symbol: string,
    options?: { days?: number; enabled?: boolean }
) {
    const days = options?.days || 30;
    return useQuery({
        queryKey: equityQueryKeys.transactionFlow(symbol, days),
        queryFn: () => api.getTransactionFlow(symbol, { days }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
    });
}

export function useFlowCoverage(options?: { days?: number; enabled?: boolean }) {
    const days = options?.days || 30;
    return useQuery({
        queryKey: equityQueryKeys.flowCoverage(days),
        queryFn: () => api.getFlowCoverage({ days }),
        enabled: options?.enabled !== false,
        staleTime: 30 * 60 * 1000,
    });
}

export function useCorrelationMatrix(
    symbol: string,
    options?: { days?: number; topN?: number; enabled?: boolean }
) {
    const days = options?.days || 60;
    const topN = options?.topN || 10;
    return useQuery({
        queryKey: equityQueryKeys.correlationMatrix(symbol, days, topN),
        queryFn: () => api.getCorrelationMatrix(symbol, { days, top_n: topN }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 10 * 60 * 1000,
        retry: 2,
    });
}

// ============ Financial Queries ============

export function useFinancialRatios(
    symbol: string,
    options?: { period?: string; enabled?: boolean }
) {
    const period = options?.period || 'FY';
    return useQuery({
        queryKey: equityQueryKeys.financialRatios(symbol, period),
        queryFn: ({ signal }) => api.getFinancialRatios(symbol, { period }, signal),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useRatioHistory(
    symbol: string,
    options?: {
        ratios?: string[];
        period?: 'year' | 'quarter';
        limit?: number;
        enabled?: boolean;
    }
) {
    const ratios = options?.ratios || ['pe', 'pb', 'ps', 'ev_ebitda'];
    const period = options?.period || 'year';
    return useQuery({
        queryKey: equityQueryKeys.ratioHistory(symbol, period, ratios),
        queryFn: () => api.getRatioHistory(symbol, { ratios, period, limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useMetricsHistory(
    symbol: string,
    options?: { limit?: number; enabled?: boolean }
) {
    return useQuery({
        queryKey: equityQueryKeys.metricsHistory(symbol, options?.limit),
        queryFn: () => api.getMetricsHistory(symbol, options?.limit),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useSubsidiaries(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.subsidiaries(symbol),
        queryFn: () => api.getSubsidiaries(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useBalanceSheet(
    symbol: string,
    options?: { period?: string; enabled?: boolean; limit?: number }
) {
    const period = options?.period || 'FY';
    const limit = options?.limit;
    return useQuery({
        queryKey: [...equityQueryKeys.balanceSheet(symbol, period), limit],
        queryFn: () => api.getBalanceSheet(symbol, { period, limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useIncomeStatement(
    symbol: string,
    options?: { period?: string; enabled?: boolean; limit?: number }
) {
    const period = options?.period || 'FY';
    const limit = options?.limit;
    return useQuery({
        queryKey: [...equityQueryKeys.incomeStatement(symbol, period), limit],
        queryFn: () => api.getIncomeStatement(symbol, { period, limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useCashFlow(
    symbol: string,
    options?: { period?: string; enabled?: boolean; limit?: number }
) {
    const period = options?.period || 'FY';
    const limit = options?.limit;
    return useQuery({
        queryKey: [...equityQueryKeys.cashFlow(symbol, period), limit],
        queryFn: () => api.getCashFlow(symbol, { period, limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useFinancials(
    symbol: string,
    options?: {
        type?: 'income' | 'balance' | 'cashflow';
        period?: 'year' | 'quarter' | 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'TTM';
        limit?: number;
        enabled?: boolean;
    }
) {
    const type = options?.type || 'income';
    const period = options?.period || 'FY';
    return useQuery({
        queryKey: equityQueryKeys.financials(symbol, type, period),
        queryFn: () => api.getFinancials(symbol, { type, period, limit: options?.limit }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 60 * 60 * 1000,
        retry: 2,
    });
}

// ============ Ownership & Rating Queries ============

export function useOwnership(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.ownership(symbol),
        queryFn: () => api.getOwnership(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000,
        retry: 2,
    });
}

export function useRating(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.rating(symbol),
        queryFn: () => api.getRating(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000,
        retry: 2,
    });
}

export function useRSRating(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.rsRating(symbol),
        queryFn: () => api.getRSRating(symbol),
        enabled: enabled && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useRSRatingHistory(symbol: string, limit: number = 100, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.rsRatingHistory(symbol, limit),
        queryFn: () => api.getRSHistory(symbol, limit),
        enabled: enabled && !!symbol,
        staleTime: 10 * 60 * 1000,
        retry: 2,
    });
}

// ============ Dividends & Stats Queries ============

export function useDividends(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.dividends(symbol),
        queryFn: () => api.getDividends(symbol),
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000,
    });
}

export function useTradingStats(symbol: string, enabled = true) {
    return useQuery({
        queryKey: equityQueryKeys.tradingStats(symbol),
        queryFn: () => api.getTradingStats(symbol),
        enabled: enabled && !!symbol,
        staleTime: 5 * 60 * 1000,
    });
}

// ============ Historical Prices (Stock Quote) ============

export const quoteQueryKey = (symbol: string) => ['quote', symbol] as const;

export interface StockQuoteView {
    symbol: string;
    price: number | null;
    change: number | null;
    changePct: number | null;
    prevClose: number | null;
    volume: number | null;
    value: number | null;
    high: number | null;
    low: number | null;
    open: number | null;
    updatedAt: string | null;
    cached: boolean;
}

export async function fetchStockQuote(symbol: string, signal?: AbortSignal): Promise<StockQuoteView> {
    const response = await api.getQuote(symbol, signal);
    const quoteData = response.data ?? {};
    const price = quoteData.price ?? null;
    const change = quoteData.change ?? quoteData.change_1d ?? null;
    const prevClose = quoteData.prevClose ?? quoteData.prev_close ?? quoteData.reference_price ?? quoteData.ref_price ?? null;
    const derivedChangePct =
        change !== null && prevClose !== null && Number(prevClose) !== 0
            ? (Number(change) / Number(prevClose)) * 100
            : null;

    return {
        symbol: response.symbol || quoteData.symbol || symbol,
        price,
        change,
        changePct:
            quoteData.changePct ?? quoteData.change_pct ?? quoteData.changePercent ?? derivedChangePct,
        prevClose,
        volume: quoteData.volume ?? null,
        value: quoteData.value ?? null,
        high: quoteData.high ?? quoteData.day_high ?? null,
        low: quoteData.low ?? quoteData.day_low ?? null,
        open: quoteData.open ?? quoteData.day_open ?? null,
        updatedAt: quoteData.updatedAt ?? quoteData.updated_at ?? null,
        cached: response.cached,
    };
}

export function useStockQuote(symbol: string, enabled = true) {
    return useQuery({
        queryKey: quoteQueryKey(symbol),
        queryFn: async ({ signal }) => {
            try {
                return await fetchStockQuote(symbol, signal);
            } catch (error) {
                if ((error as Error)?.name === 'AbortError') {
                    throw error;
                }
                logClientError(`[useStockQuote] Failed to fetch quote for ${symbol}:`, error);
                throw error;
            }
        },
        enabled: enabled && !!symbol,
        staleTime: 30 * 1000,
        refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.quotes),
        refetchIntervalInBackground: false,
        networkMode: 'online',
        retry: 2,
    });
}

// Historical prices query
export const historicalQueryKey = (
    symbol: string,
    params?: {
        startDate?: string;
        endDate?: string;
        interval?: string;
        source?: string;
        adjustmentMode?: 'raw' | 'adjusted';
    }
) => ['historical', symbol, params] as const;

export function useHistoricalPrices(
    symbol: string,
    options?: {
        startDate?: string;
        endDate?: string;
        interval?: string;
        source?: string;
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    let preferredSource: VnstockSource = 'KBS';

    try {
        const { preferredVnstockSource } = useDataSources();
        preferredSource = preferredVnstockSource;
    } catch {
        // Outside of DataSourcesProvider, use default
    }

    const source = options?.source ?? preferredSource;
    const historyParams = {
        startDate: options?.startDate,
        endDate: options?.endDate,
        interval: options?.interval,
        source,
        adjustmentMode: options?.adjustmentMode,
    };

    return useQuery({
        queryKey: historicalQueryKey(symbol, historyParams),
        queryFn: () => api.getHistoricalPrices(symbol, { ...options, source }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
}
