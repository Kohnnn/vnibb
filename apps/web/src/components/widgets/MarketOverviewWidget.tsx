'use client';

import { useEffect, useState } from 'react';
import { BarChart2, RefreshCw, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus, Clock, AlertCircle, Activity } from 'lucide-react';
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
            <div className="h-full flex flex-col">
                <div className="flex-1 overflow-auto p-3">
                    {isLoading ? (
                        <div className="index-cards-grid">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="skeleton-premium h-24 rounded-xl" />
                            ))}
                        </div>
                    ) : isError ? (
                        <div className="empty-state-premium">
                            <div className="empty-state-premium__icon">
                                <AlertCircle />
                            </div>
                            <div className="empty-state-premium__title">Connection Failed</div>
                            <div className="empty-state-premium__description">Unable to fetch market data. Check backend status.</div>
                        </div>
                    ) : indices.length === 0 ? (
                        <div className="empty-state-premium">
                            <div className="empty-state-premium__icon">
                                <Activity />
                            </div>
                            <div className="empty-state-premium__title">No Market Data</div>
                            <div className="empty-state-premium__description">Market data will appear when available.</div>
                        </div>
                    ) : (
                        <div className="index-cards-grid">
                            {indices.map((idx, i) => {
                                const isUp = (idx.change_pct || 0) >= 0;
                                const stats = MOCK_STATS[idx.index_name] || { up: 0, down: 0, flat: 0 };

                                return (
                                    <div
                                        key={i}
                                        className={`index-card ${isUp ? 'up' : 'down'}`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="index-card__name">
                                                {idx.index_name}
                                            </span>
                                            {isUp ? (
                                                <TrendingUp size={14} className="text-green-400" />
                                            ) : (
                                                <TrendingDown size={14} className="text-red-400" />
                                            )}
                                        </div>

                                        <div className={`index-card__value ${isUp ? 'data-value-up' : 'data-value-down'}`}>
                                            {formatValue(idx.current_value)}
                                        </div>

                                        <div className={`index-card__change ${isUp ? 'data-value-up' : 'data-value-down'}`}>
                                            {formatPct(idx.change_pct)}
                                        </div>

                                        <div className="flex items-center gap-2 mt-2 text-[9px]">
                                            <span className="flex items-center gap-0.5 text-green-400/80">
                                                <ArrowUp size={8} />{stats.up}
                                            </span>
                                            <span className="flex items-center gap-0.5 text-gray-500">
                                                <Minus size={8} />{stats.flat}
                                            </span>
                                            <span className="flex items-center gap-0.5 text-red-400/80">
                                                <ArrowDown size={8} />{stats.down}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1.5 px-3 py-2 border-t border-gray-800/50 bg-gray-900/30 text-[9px] text-gray-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span suppressHydrationWarning>Updated {lastUpdated?.toLocaleTimeString() ?? '--:--:--'}</span>
                </div>
            </div>
        </WidgetContainer>
    );
}

export default MarketOverviewWidget;
