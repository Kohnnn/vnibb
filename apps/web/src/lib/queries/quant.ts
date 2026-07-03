// Quantitative analysis queries: RS rating, momentum, GARCH, backtesting

'use client';

import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { useVnstockSource } from './common';

// ============ Query Keys ============

export const quantQueryKeys = {
    rsLeaders: (limit: number, sector?: string) => ['rsLeaders', limit, sector] as const,
    rsLaggards: (limit: number, sector?: string) => ['rsLaggards', limit, sector] as const,
    rsGainers: (limit: number, lookbackDays: number) => ['rsGainers', limit, lookbackDays] as const,
    quant: (symbol: string, period: string, metrics: string[], source: string) =>
        ['quant', symbol, period, metrics.join(','), source] as const,
    garchVolatility: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['garchVolatility', symbol, period, source, adjustmentMode] as const,
    quantBacktest: (
        symbol: string,
        period: string,
        fastWindow: number,
        slowWindow: number,
        source: string,
        adjustmentMode: string
    ) => ['quantBacktest', symbol, period, fastWindow, slowWindow, source, adjustmentMode] as const,
    quantSweep: (
        symbol: string,
        period: string,
        fastWindows: number[],
        slowWindows: number[],
        objective: string,
        source: string,
        adjustmentMode: string
    ) => ['quantSweep', symbol, period, fastWindows.join(','), slowWindows.join(','), objective, source, adjustmentMode] as const,
    seasonalityMatrix: (
        symbol: string,
        granularity: string,
        period: string,
        source: string,
        adjustmentMode: string
    ) => ['seasonalityMatrix', symbol, granularity, period, source, adjustmentMode] as const,
    gammaExposure: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['gammaExposure', symbol, period, source, adjustmentMode] as const,
    momentumProfile: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['momentumProfile', symbol, period, source, adjustmentMode] as const,
    earningsQuality: (symbol: string) => ['earningsQuality', symbol] as const,
    smartMoneyFlow: (symbol: string) => ['smartMoneyFlow', symbol] as const,
    relativeRotation: (symbol: string, lookbackDays: number) =>
        ['relativeRotation', symbol, lookbackDays] as const,
    marketStructureTests: (symbol: string, period: string, source: string, adjustmentMode: string) =>
        ['marketStructureTests', symbol, period, source, adjustmentMode] as const,
    pairDiagnostics: (symbol: string, other: string, period: string, source: string, adjustmentMode: string) =>
        ['pairDiagnostics', symbol, other, period, source, adjustmentMode] as const,
};

// ============ RS Rating Queries ============

export function useRSLeaders(
    limit: number = 50,
    options?: { sector?: string; enabled?: boolean }
) {
    return useQuery({
        queryKey: quantQueryKeys.rsLeaders(limit, options?.sector),
        queryFn: () => api.getRSLeaders({ limit, sector: options?.sector }),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useRSLaggards(
    limit: number = 50,
    options?: { sector?: string; enabled?: boolean }
) {
    return useQuery({
        queryKey: quantQueryKeys.rsLaggards(limit, options?.sector),
        queryFn: () => api.getRSLaggards({ limit, sector: options?.sector }),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useRSGainers(
    limit: number = 50,
    lookbackDays: number = 7,
    options?: { enabled?: boolean }
) {
    return useQuery({
        queryKey: quantQueryKeys.rsGainers(limit, lookbackDays),
        queryFn: () => api.getRSGainers({ limit, lookbackDays }),
        enabled: options?.enabled !== false,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

// ============ Quant Metrics Queries ============

export function useQuantMetrics(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        metrics?: api.QuantMetric[];
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '5Y';
    const metrics = options?.metrics || ['volume_delta'];
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';
    return useQuery({
        queryKey: [...quantQueryKeys.quant(symbol, period, metrics, source), adjustmentMode] as const,
        queryFn: () => api.getQuantMetrics(symbol, { period, metrics, source, adjustmentMode }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

// ============ GARCH Volatility ============

export type GarchVolatilityState =
    | { status: 'ok'; response: api.QuantResponse; metric: api.GarchVolatilityMetric | null; error?: string | null }
    | { status: 'not_deployed' };

export function isGarchNotDeployedError(error: unknown): boolean {
    if (!(error instanceof api.APIError)) return false;
    if (error.status === 404 || error.status === 405) return true;
    return (
        error.status === 400 &&
        typeof error.message === 'string' &&
        error.message.toLowerCase().includes('garch_volatility')
    );
}

export function useGarchVolatility(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '5Y';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';
    return useQuery<GarchVolatilityState>({
        queryKey: quantQueryKeys.garchVolatility(symbol, period, source, adjustmentMode),
        queryFn: async () => {
            try {
                const response = await api.getQuantMetrics(symbol, {
                    period,
                    metrics: ['garch_volatility'],
                    source,
                    adjustmentMode,
                });
                return {
                    status: 'ok',
                    response,
                    metric: response.data.metrics.garch_volatility ?? null,
                    error: response.error,
                };
            } catch (error) {
                if (isGarchNotDeployedError(error)) {
                    return { status: 'not_deployed' };
                }
                throw error;
            }
        },
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
}

// ============ Backtesting Queries ============

export function useQuantBacktest(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        fastWindow?: number;
        slowWindow?: number;
        initialCapital?: number;
        feeBps?: number;
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '5Y';
    const fastWindow = options?.fastWindow ?? 20;
    const slowWindow = options?.slowWindow ?? 50;
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';

    return useQuery({
        queryKey: quantQueryKeys.quantBacktest(symbol, period, fastWindow, slowWindow, source, adjustmentMode),
        queryFn: () => api.runQuantBacktest(symbol, {
            period,
            initial_capital: options?.initialCapital,
            fee_bps: options?.feeBps,
            source,
            adjustment_mode: adjustmentMode,
            strategy: {
                type: 'moving_average_crossover',
                fast_window: fastWindow,
                slow_window: slowWindow,
            },
        }),
        enabled: options?.enabled !== false && !!symbol && fastWindow < slowWindow,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
}

export function useQuantSweep(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        fastWindows?: number[];
        slowWindows?: number[];
        objective?: api.QuantSweepRequest['objective'];
        initialCapital?: number;
        feeBps?: number;
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '5Y';
    const fastWindows = options?.fastWindows ?? [10, 20, 50];
    const slowWindows = options?.slowWindows ?? [50, 100, 200];
    const objective = options?.objective || 'sharpe_daily_rf0';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';
    const hasValidCombo = fastWindows.some((fast) => slowWindows.some((slow) => fast < slow));

    return useQuery({
        queryKey: quantQueryKeys.quantSweep(symbol, period, fastWindows, slowWindows, objective, source, adjustmentMode),
        queryFn: () => api.runQuantSweep(symbol, {
            period,
            initial_capital: options?.initialCapital,
            fee_bps: options?.feeBps,
            source,
            adjustment_mode: adjustmentMode,
            fast_windows: fastWindows,
            slow_windows: slowWindows,
            objective,
        }),
        enabled: options?.enabled !== false && !!symbol && hasValidCombo,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
}

// ============ Advanced Quant Queries ============

export function useSeasonalityMatrix(
    symbol: string,
    options?: {
        granularity?: api.SeasonalityGranularity;
        period?: api.QuantPeriod;
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const granularity = options?.granularity || 'monthly';
    const period = options?.period || '5Y';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';

    return useQuery({
        queryKey: quantQueryKeys.seasonalityMatrix(symbol, granularity, period, source, adjustmentMode),
        queryFn: () => api.getSeasonalityMatrix(symbol, { granularity, period, source, adjustmentMode }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: granularity === 'hourly' ? 60 * 1000 : 5 * 60 * 1000,
        retry: 2,
    });
}

export function useGammaExposure(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '3Y';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';

    return useQuery({
        queryKey: quantQueryKeys.gammaExposure(symbol, period, source, adjustmentMode),
        queryFn: () => api.getGammaExposure(symbol, { period, source, adjustmentMode }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useMomentumProfile(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '3Y';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';

    return useQuery({
        queryKey: quantQueryKeys.momentumProfile(symbol, period, source, adjustmentMode),
        queryFn: () => api.getMomentumProfile(symbol, { period, source, adjustmentMode }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export type PairDiagnosticsState =
    | { status: 'ok'; payload: api.PairDiagnosticsPayload; error?: string | null }
    | { status: 'not_deployed' };

export function usePairDiagnostics(
    symbol: string,
    other: string,
    options?: {
        period?: api.QuantPeriod;
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '3Y';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';
    return useQuery<PairDiagnosticsState>({
        queryKey: quantQueryKeys.pairDiagnostics(symbol, other, period, source, adjustmentMode),
        queryFn: async () => {
            try {
                const response = await api.getPairDiagnostics(symbol, other, { period, source, adjustmentMode });
                return { status: 'ok', payload: response.data, error: response.error };
            } catch (error) {
                const status = (error as api.APIError)?.status;
                if (status === 404 || status === 405) {
                    return { status: 'not_deployed' };
                }
                throw error;
            }
        },
        enabled: options?.enabled !== false && !!symbol && !!other && symbol !== other,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
}

export function useMarketStructureTests(
    symbol: string,
    options?: {
        period?: api.QuantPeriod;
        source?: 'KBS' | 'VCI' | 'MSN' | 'FMP';
        adjustmentMode?: 'raw' | 'adjusted';
        enabled?: boolean;
    }
) {
    const preferredSource = useVnstockSource();
    const period = options?.period || '5Y';
    const source = options?.source || preferredSource;
    const adjustmentMode = options?.adjustmentMode || 'adjusted';
    return useQuery({
        queryKey: quantQueryKeys.marketStructureTests(symbol, period, source, adjustmentMode),
        queryFn: async () => {
            try {
                return await api.getMarketStructureTests(symbol, { period, source, adjustmentMode });
            } catch (error) {
                const status = (error as api.APIError)?.status;
                if (status === 404 || status === 405) return null;
                throw error;
            }
        },
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
}

export function useEarningsQuality(symbol: string, enabled = true) {
    return useQuery({
        queryKey: quantQueryKeys.earningsQuality(symbol),
        queryFn: () => api.getEarningsQuality(symbol),
        enabled: enabled && !!symbol,
        staleTime: 15 * 60 * 1000,
        retry: 2,
    });
}

export function useSmartMoneyFlow(symbol: string, enabled = true) {
    return useQuery({
        queryKey: quantQueryKeys.smartMoneyFlow(symbol),
        queryFn: () => api.getSmartMoneyFlow(symbol),
        enabled: enabled && !!symbol,
        staleTime: 5 * 60 * 1000,
        retry: 2,
    });
}

export function useRelativeRotation(
    symbol: string,
    options?: {
        lookbackDays?: number;
        enabled?: boolean;
    }
) {
    const lookbackDays = options?.lookbackDays ?? 260;
    return useQuery({
        queryKey: quantQueryKeys.relativeRotation(symbol, lookbackDays),
        queryFn: () => api.getRelativeRotation(symbol, { lookbackDays }),
        enabled: options?.enabled !== false && !!symbol,
        staleTime: 10 * 60 * 1000,
        retry: 2,
    });
}
