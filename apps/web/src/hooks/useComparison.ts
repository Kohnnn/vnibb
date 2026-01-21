import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import axios from 'axios';

export interface MetricDefinition {
    key: string;
    label: string;
    format: string;
}

export interface StockMetrics {
    symbol: string;
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
    symbols: string[];
    metrics: MetricDefinition[];
    data: Record<string, StockMetrics>;
    priceHistory: PricePerformancePoint[];
    sectorAverages?: Record<string, number>;
    generated_at: string;
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

export const useComparison = (symbols: string[], period = '1Y', enabled = true) => {
    return useQuery<ComparisonResponse>({
        queryKey: ['comparison', symbols.sort().join(','), period],
        queryFn: async () => {
            const { data } = await axios.get('/api/v1/analysis/', {
                params: {
                    symbols: symbols.join(','),
                    period,
                },
            });
            return data;
        },
        enabled: enabled && symbols.length > 0,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
};

export const usePeers = (symbol: string, limit = 5, enabled = true) => {
    return useQuery<PeersResponse>({
        queryKey: ['peers', symbol, limit],
        queryFn: async () => {
            const { data } = await axios.get(`/api/v1/analysis/peers/${symbol}`, {
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

