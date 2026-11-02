// Market Ribbon - Persistent top bar showing Vietnam market indices

'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import * as api from '@/lib/api';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { useMemo, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface IndexData {
    symbol: string;
    price: number;
    change: number;
    change_pct: number;
    direction?: 'up' | 'down' | 'unchanged';
}

function IndexTicker({ symbol, price, change, change_pct, direction }: IndexData) {
    const isPositive = change >= 0;
    const formatNumber = (n: number) => n?.toLocaleString('vi-VN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) || '0.00';

    return (
        <div className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-1.5 transition-colors duration-500",
            direction === 'up' ? "border-[var(--color-positive)] bg-[var(--color-positive-bg)]" :
            direction === 'down' ? "border-[var(--color-negative)] bg-[var(--color-negative-bg)]" :
            "border-[var(--border-default)] bg-[var(--bg-secondary)]"
        )}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">{symbol}</span>
            <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
                {formatNumber(price)}
            </span>
            <div className={cn(
                "flex items-center gap-1 text-[10px] font-bold",
                isPositive ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]'
            )}>
                {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                <span>{isPositive ? '+' : ''}{formatNumber(change)}</span>
                <span className="opacity-80">({isPositive ? '+' : ''}{change_pct?.toFixed(2) || '0.00'}%)</span>
            </div>
        </div>
    );
}

export function MarketRibbon() {
    const { data: initialData, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ['marketOverview'],
        queryFn: async () => api.getMarketOverview(),
        staleTime: 60000,
    });

    const indexSymbols = useMemo(() => ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX", "VN-INDEX", "HNX-INDEX"], []);
    const { prices: livePrices, isConnected } = useWebSocket({ symbols: indexSymbols });

    const [mergedData, setMergedData] = useState<Record<string, any>>({});

    useEffect(() => {
        if (initialData?.data) {
            const initialMap: Record<string, any> = {};
            initialData.data.forEach((item: any) => {
                initialMap[getSymbol(item)] = item;
            });
            setMergedData(prev => ({ ...initialMap, ...prev }));
        }
    }, [initialData]);

    useEffect(() => {
        if (livePrices.size > 0) {
            const updates: Record<string, any> = {};
            livePrices.forEach((val, key) => {
                updates[key] = {
                    ...mergedData[key],
                    price: val.price,
                    change: val.change,
                    change_pct: val.change_pct,
                    direction: val.direction
                };
            });
            setMergedData(prev => ({ ...prev, ...updates }));
        }
    }, [livePrices]);

    const vnindex = mergedData['VNINDEX'] || mergedData['VN-INDEX'];
    const hnxindex = mergedData['HNXINDEX'] || mergedData['HNX-INDEX'];
    const upcomindex = mergedData['UPCOMINDEX'] || mergedData['UPCOM'];



    return (
        <div className="sticky top-0 z-[100] border-b border-[var(--border-color)] bg-[var(--bg-primary)] px-4 py-2">
            <div className="flex items-center justify-between max-w-[1800px] mx-auto">
                <div className="flex items-center gap-3">
                    {vnindex && (
                        <IndexTicker
                            symbol="VN-INDEX"
                            price={getPrice(vnindex)}
                            change={getChange(vnindex)}
                            change_pct={getChangePct(vnindex)}
                            direction={vnindex.direction}
                        />
                    )}
                    {hnxindex && (
                        <IndexTicker
                            symbol="HNX-INDEX"
                            price={getPrice(hnxindex)}
                            change={getChange(hnxindex)}
                            change_pct={getChangePct(hnxindex)}
                            direction={hnxindex.direction}
                        />
                    )}
                    {upcomindex && (
                        <IndexTicker
                            symbol="UPCOM"
                            price={getPrice(upcomindex)}
                            change={getChange(upcomindex)}
                            change_pct={getChangePct(upcomindex)}
                            direction={upcomindex.direction}
                        />
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        {isConnected ? (
                            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                                <Wifi size={12} className="animate-pulse" />
                                <span>Live</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                                <WifiOff size={12} />
                                <span>Delayed</span>
                            </div>
                        )}
                    </div>

                    <div className="h-4 w-px bg-[var(--border-subtle)]" />

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                            title="Refresh Indices"
                        >
                            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper functions for data extraction
function getPrice(item: any): number {
    return (item.price || item.current_value || item.close || 0);
}

function getChange(item: any): number {
    return (item.change || 0);
}

function getChangePct(item: any): number {
    return (item.change_pct || item.pct_change || item.changePct || 0);
}

function getSymbol(item: any): string {
    return (item.symbol || item.index_name || item.index_code || '');
}

