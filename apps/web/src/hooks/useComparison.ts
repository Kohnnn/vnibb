import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { API_BASE_URL } from '@/lib/api';

export interface MetricDefinition {
    id?: string;
    key: string;
    name?: string;
    label: string;
    format: string;
}

export interface StockMetrics {
    symbol: string;
    company_name?: string;
    name?: string;
    industry?: string;
    exchange?: string;
    metrics: Record<string, any>;
}

export interface PricePerformancePoint {
    date: string;
    values: Record<string, number>;
}

export interface ComparisonResponse {
    symbols?: string[];
    metrics: MetricDefinition[];
    data: Record<string, StockMetrics>;
    stocks: StockMetrics[];
    priceHistory: PricePerformancePoint[];
    sectorAverages?: Record<string, number>;
    generated_at: string;
    period?: string;
}

export interface PeerCompany {
    symbol: string;
    name?: string;
    market_cap?: number;
    pe_ratio?: number;
    industry?: string;
}

export interface PeersResponse {
    symbol: string;
    industry?: string;
    count: number;
    peers: PeerCompany[];
}

export const useComparison = (
    symbols: string[],
    options?: { period?: string; enabled?: boolean }
) => {
    const normalizedSymbols = [...symbols]
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
        .sort();
    const period = options?.period ?? 'FY';
    const enabled = options?.enabled ?? true;

    return useQuery<ComparisonResponse>({
        queryKey: ['comparison', normalizedSymbols.join(','), period],
        queryFn: async () => {
            const { data } = await axios.get(`${API_BASE_URL}/comparison`, {
                params: {
                    symbols: normalizedSymbols.join(','),
                    period,
                },
            });
            const stocks: StockMetrics[] = Array.isArray(data?.stocks) ? data.stocks : [];
            const mappedData = stocks.reduce((acc: Record<string, StockMetrics>, stock: StockMetrics) => {
                acc[stock.symbol] = {
                    symbol: stock.symbol,
                    company_name: stock.company_name,
                    name: stock.company_name || stock.name,
                    metrics: stock.metrics || {},
                };
                return acc;
            }, {} as Record<string, StockMetrics>);

            const sectorAccumulator: Record<string, number[]> = {};
            stocks.forEach((stock: StockMetrics) => {
                Object.entries(stock.metrics || {}).forEach(([key, value]) => {
                    if (typeof value !== 'number' || !Number.isFinite(value)) return;
                    if (!sectorAccumulator[key]) sectorAccumulator[key] = [];
                    sectorAccumulator[key].push(value);
                });
            });

            const sectorAverages = Object.fromEntries(
                Object.entries(sectorAccumulator).map(([key, values]) => [
                    key,
                    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
                ])
            );

            const normalizedMetrics = Array.isArray(data?.metrics)
                ? data.metrics.map((metric: any) => ({
                    ...metric,
                    key: metric.id || metric.key,
                    label: metric.name || metric.label,
                }))
                : [];

            return {
                ...data,
                symbols: stocks.map((stock: StockMetrics) => stock.symbol),
                stocks,
                data: mappedData,
                metrics: normalizedMetrics,
                sectorAverages,
                priceHistory: Array.isArray(data?.priceHistory) ? data.priceHistory : [],
            };
        },
        enabled: enabled && normalizedSymbols.length > 0,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
};

export const usePeers = (symbol: string, limit = 5, enabled = true) => {
    return useQuery<PeersResponse>({
        queryKey: ['peers', symbol, limit],
        queryFn: async () => {
            const { data } = await axios.get(`${API_BASE_URL}/equity/${symbol}/peers`, {
                params: { limit },
            });
            return data;
        },
        enabled: enabled && !!symbol,
        staleTime: 60 * 60 * 1000, // 1 hour
    });
};

// Storage Hook for Persistence
const STORAGE_KEY = 'vnibb_comparison_sets';

export const usePeerStorage = (initialSymbol: string) => {
    // Initialize with defaults if not found in storage
    const [peers, setPeers] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [initialSymbol];

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Return stored set for this symbol key if exists, else default
                if (parsed[initialSymbol]) {
                    return parsed[initialSymbol];
                }
            }
        } catch (e) {
            console.warn('Failed to load peers from storage:', e);
        }

        // Default fallback
        return [initialSymbol, 'VNM', 'VIC'].slice(0, 3);
    });

    // Save to storage whenever peers change
    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            const parsed = stored ? JSON.parse(stored) : {};
            parsed[initialSymbol] = peers;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        } catch (e) {
            console.warn('Failed to save peers to storage:', e);
        }
    }, [peers, initialSymbol]);

    return [peers, setPeers] as const;
};

