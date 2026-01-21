'use client';

import { useEffect, useState } from 'react';
import { BarChart2, RefreshCw, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus, Clock, AlertCircle } from 'lucide-react';
import { useMarketOverview } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';

interface MarketOverviewWidgetProps {
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatValue(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}${value.toFixed(2)}%`;
}

const MOCK_STATS: Record<string, { up: number; down: number; flat: number }> = {
    'VN-INDEX': { up: 245, down: 180, flat: 62 },
    'VN30': { up: 18, down: 10, flat: 2 },
    'HNX': { up: 95, down: 72, flat: 28 },
    'UPCOM': { up: 120, down: 98, flat: 45 },
};

export function MarketOverviewWidget({ id, isEditing, onRemove, lastRefresh }: MarketOverviewWidgetProps & { id?: string, lastRefresh?: number }) {
    const { data, isLoading, isError, refetch, isRefetching } = useMarketOverview();
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    useEffect(() => {
        setLastUpdated(new Date());
    }, []);

    useEffect(() => {
        if (lastRefresh) {
            refetch();
            setLastUpdated(new Date());
        }
    }, [lastRefresh, refetch]);

    useEffect(() => {
        const interval = setInterval(() => {
            refetch();
            setLastUpdated(new Date());
        }, 30000);
        return () => clearInterval(interval);
    }, [refetch]);

    const indices = data?.data || [];

    return (
        <WidgetContainer
            title="Vietnam Markets"
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            noPadding
        >
            <div className="h-full flex flex-col p-1">
                <div className="flex-1 overflow-auto p-2">
                    {isLoading ? (
                        <div className="grid grid-cols-2 gap-2">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="animate-pulse h-20 bg-gray-800/30 rounded-lg" />
                            ))}
                        </div>
                    ) : isError ? (
                        <div className="flex flex-col items-center justify-center h-32 text-red-500">
                            <AlertCircle size={24} className="mb-2" />
                            <p className="text-xs text-center text-gray-400">Failed to load market data</p>
                        </div>
                    ) : indices.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                            <BarChart2 size={24} className="mb-2 opacity-30" />
                            <p className="text-xs">No market data</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            {indices.map((idx, i) => {
                                const isUp = (idx.change_pct || 0) >= 0;
                                const stats = MOCK_STATS[idx.index_name] || { up: 0, down: 0, flat: 0 };

                                return (
                                    <div
                                        key={i}
                                        className={`p-3 rounded-lg border transition-all hover:scale-[1.02] ${isUp
                                            ? 'bg-green-500/5 border-green-500/20 hover:border-green-500/40'
                                            : 'bg-red-500/5 border-red-500/20 hover:border-red-500/40'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-gray-300 uppercase">
                                                {idx.index_name}
                                            </span>
                                            {isUp ? (
                                                <TrendingUp size={14} className="text-green-400" />
                                            ) : (
                                                <TrendingDown size={14} className="text-red-400" />
                                            )}
                                        </div>

                                        <div className={`text-xl font-bold mb-0.5 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                            {formatValue(idx.current_value)}
                                        </div>

                                        <div className={`text-sm font-medium mb-2 ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                                            {formatPct(idx.change_pct)}
                                        </div>

                                        <div className="flex items-center gap-1.5 text-[10px]">
                                            <span className="flex items-center gap-0.5 text-green-400">
                                                <ArrowUp size={10} />{stats.up}
                                            </span>
                                            <span className="flex items-center gap-0.5 text-gray-400">
                                                <Minus size={10} />{stats.flat}
                                            </span>
                                            <span className="flex items-center gap-0.5 text-red-400">
                                                <ArrowDown size={10} />{stats.down}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1 px-2 py-1 border-t border-gray-800 text-[10px] text-gray-500">
                    <Clock size={10} />
                    <span suppressHydrationWarning>Updated {lastUpdated?.toLocaleTimeString() ?? '--:--:--'}</span>
                </div>
            </div>
        </WidgetContainer>
    );
}

export default MarketOverviewWidget;
