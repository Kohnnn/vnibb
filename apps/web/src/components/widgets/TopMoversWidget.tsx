'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { useTopMovers } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';

interface TopMoversWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
    onSymbolClick?: (symbol: string) => void;
}

type ViewMode = 'gainer' | 'loser';

export function TopMoversWidget({ isEditing, onRemove, onSymbolClick, lastRefresh }: TopMoversWidgetProps & { lastRefresh?: number }) {
    const [mode, setMode] = useState<ViewMode>('gainer');
    const { data, isLoading, refetch, isRefetching } = useTopMovers({
        type: mode,
        limit: 10,
        index: 'VNINDEX',
    });

    useEffect(() => {
        if (lastRefresh) {
            refetch();
        }
    }, [lastRefresh, refetch]);

    const stocks = data?.data || [];

    return (
        <WidgetContainer
            title="Market Movers"
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            noPadding
        >
            <div className="h-full flex flex-col">
                <div className="flex items-center justify-between px-2 py-1.5 mb-2 border-b border-gray-800/50">
                    <div className="flex bg-gray-800 rounded text-[10px]">
                        <button
                            onClick={() => setMode('gainer')}
                            className={`px-3 py-1 rounded flex items-center gap-1 ${mode === 'gainer' ? 'bg-green-600 text-white' : 'text-gray-400'
                                }`}
                        >
                            <TrendingUp size={10} /> Gainers
                        </button>
                        <button
                            onClick={() => setMode('loser')}
                            className={`px-3 py-1 rounded flex items-center gap-1 ${mode === 'loser' ? 'bg-red-600 text-white' : 'text-gray-400'
                                }`}
                        >
                            <TrendingDown size={10} /> Losers
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-auto px-1">
                    {isLoading ? (
                        <div className="space-y-1 p-2">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="animate-pulse h-8 bg-gray-800/30 rounded" />
                            ))}
                        </div>
                    ) : stocks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                            <TrendingUp size={24} className="mb-2 opacity-30" />
                            <p className="text-xs text-gray-400">No data available</p>
                        </div>
                    ) : (
                        <div className="space-y-0.5 text-left">
                            {stocks.map((stock, index) => {
                                const changePct = stock.price_change_pct ?? 0;
                                const isUp = changePct >= 0;
                                return (
                                    <div
                                        key={stock.symbol}
                                        onClick={() => onSymbolClick?.(stock.symbol)}
                                        className="flex items-center justify-between py-1.5 px-2 hover:bg-gray-800/30 rounded cursor-pointer group transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-500 text-[10px] w-4">{index + 1}</span>
                                            <span className="font-bold text-blue-400 group-hover:text-blue-300 text-xs">{stock.symbol}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-white text-xs font-mono">
                                                {stock.last_price?.toLocaleString() || '-'}
                                            </span>
                                            <span className={`text-[10px] font-bold min-w-[50px] text-right ${isUp
                                                ? 'text-green-400'
                                                : 'text-red-400'
                                                }`}>
                                                {isUp ? '+' : ''}{changePct.toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export default TopMoversWidget;
