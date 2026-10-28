import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { API_BASE_URL } from '@/lib/api';
import { resolveMarketCap, type MarketCapProvenance, type MarketCapResult } from '@/lib/marketCap';

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
    market_cap_provenance?: MarketCapProvenance | null;
    market_cap_result?: MarketCapResult;
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
            const dataMap = data?.data && typeof data.data === 'object' && !Array.isArray(data.data)
                ? data.data as Record<string, StockMetrics>
                : {};
            const rawStocks: StockMetrics[] = Array.isArray(data?.stocks)
                ? data.stocks
                : Object.entries(dataMap).map(([symbol, stock]) => ({ ...stock, symbol: stock?.symbol || symbol }));
            const stocks = rawStocks.map((stock) => {
                const marketCap = resolveMarketCap({ label: stock.symbol, value: stock.metrics?.market_cap, provenance: stock.market_cap_provenance });
                return {
                    ...stock,
                    market_cap_result: marketCap,
                    metrics: { ...stock.metrics, market_cap: marketCap.value },
                };
            });
            const mappedData = stocks.reduce((acc: Record<string, StockMetrics>, stock: StockMetrics) => {
                acc[stock.symbol] = {
                    symbol: stock.symbol,
                    company_name: stock.company_name,
                    name: stock.company_name || stock.name,
                    industry: stock.industry,
                    exchange: stock.exchange,
                    metrics: stock.metrics || {},
                    market_cap_provenance: stock.market_cap_provenance,
                    market_cap_result: stock.market_cap_result,
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
                sector_averages: data?.sector_averages && typeof data.sector_averages === 'object'
                    ? Object.fromEntries(Object.entries(data.sector_averages).filter(([key]) => key !== 'market_cap'))
                    : data?.sector_averages,
                symbols: stocks.map((stock: StockMetrics) => stock.symbol),
                stocks,
                data: mappedData,
                metrics: normalizedMetrics,
                sectorAverages,
                priceHistory: Array.isArray(data?.priceHistory)
                    ? data.priceHistory
                    : Array.isArray(data?.price_history)
                        ? data.price_history
                        : [],
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


