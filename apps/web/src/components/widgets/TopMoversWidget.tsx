'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Activity } from 'lucide-react';
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
                {/* Mode Toggle */}
                <div className="flex items-center justify-center px-3 py-2 border-b border-gray-800/50">
                    <div className="flex bg-gray-900 rounded-lg p-0.5 text-[10px]">
                        <button
                            onClick={() => setMode('gainer')}
                            className={`px-4 py-1.5 rounded-md flex items-center gap-1.5 transition-all ${mode === 'gainer'
                                ? 'bg-green-600 text-white shadow-lg shadow-green-600/20'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            <TrendingUp size={12} /> Gainers
                        </button>
                        <button
                            onClick={() => setMode('loser')}
                            className={`px-4 py-1.5 rounded-md flex items-center gap-1.5 transition-all ${mode === 'loser'
                                ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            <TrendingDown size={12} /> Losers
                        </button>
                    </div>
                </div>

                {/* Stock List */}
                <div className="flex-1 overflow-auto px-2 py-1">
                    {isLoading ? (
                        <div className="space-y-1 p-1">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="skeleton-premium h-9 rounded-lg" style={{ animationDelay: `${i * 50}ms` }} />
                            ))}
                        </div>
                    ) : stocks.length === 0 ? (
                        <div className="empty-state-premium">
                            <div className="empty-state-premium__icon">
                                <Activity />
                            </div>
                            <div className="empty-state-premium__title">No Data</div>
                            <div className="empty-state-premium__description">Market mover data will appear when available.</div>
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {stocks.map((stock, index) => {
                                const changePct = stock.price_change_pct ?? 0;
                                const isUp = changePct >= 0;
                                return (
                                    <div
                                        key={stock.symbol}
                                        onClick={() => onSymbolClick?.(stock.symbol)}
                                        className={`flex items-center justify-between py-2 px-2.5 rounded-lg cursor-pointer group transition-all ${isUp
                                                ? 'hover:bg-green-500/10 hover:border-green-500/20'
                                                : 'hover:bg-red-500/10 hover:border-red-500/20'
                                            } border border-transparent`}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <span className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded ${index < 3
                                                    ? isUp ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                                                    : 'bg-gray-800/50 text-gray-500'
                                                }`}>
                                                {index + 1}
                                            </span>
                                            <span className="font-bold text-blue-400 group-hover:text-blue-300 text-xs tracking-wide">
                                                {stock.symbol}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-white text-xs font-mono tabular-nums">
                                                {stock.last_price?.toLocaleString() || '-'}
                                            </span>
                                            <span className={`text-[11px] font-bold min-w-[55px] text-right px-1.5 py-0.5 rounded ${isUp
                                                    ? 'text-green-400 bg-green-500/10'
                                                    : 'text-red-400 bg-red-500/10'
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
