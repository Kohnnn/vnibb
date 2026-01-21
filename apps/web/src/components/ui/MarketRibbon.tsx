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
            "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-500",
            direction === 'up' ? "bg-green-500/20 border-green-500/40 scale-[1.02]" : 
            direction === 'down' ? "bg-red-500/20 border-red-500/40 scale-[1.02]" :
            "bg-[#1e293b]/60 border-[#334155]/50"
        )}>
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{symbol}</span>
            <span className="text-sm font-black text-white font-mono">
                {formatNumber(price)}
            </span>
            <div className={cn(
                "flex items-center gap-1 text-[10px] font-bold",
                isPositive ? 'text-green-400' : 'text-red-400'
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
        <div className="bg-[#0f172a]/90 border-b border-[#1e293b] px-4 py-2 backdrop-blur-sm sticky top-0 z-[100]">
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
                            <div className="flex items-center gap-1 text-[10px] font-black text-green-500 uppercase tracking-widest">
                                <Wifi size={12} className="animate-pulse" />
                                <span>Live</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 text-[10px] font-black text-red-500 uppercase tracking-widest opacity-50">
                                <WifiOff size={12} />
                                <span>Delayed</span>
                            </div>
                        )}
                    </div>

                    <div className="h-4 w-px bg-gray-800" />

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
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

