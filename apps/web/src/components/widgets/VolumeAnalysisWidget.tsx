// Volume Analysis Widget - Volume profile and analysis

'use client';

import { BarChart2, TrendingUp, TrendingDown } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface VolumeAnalysisWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatVolume(vol: number): string {
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`;
    return vol.toLocaleString();
}

export function VolumeAnalysisWidget({ symbol }: VolumeAnalysisWidgetProps) {
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useHistoricalPrices(symbol, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });

    const prices = data?.data || [];

    const volumes = prices.map((p) => p.volume || 0);
    const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
    const maxVolume = Math.max(...volumes, 1);
    const latestVolume = volumes[volumes.length - 1] || 0;
    const volumeChange = avgVolume > 0 ? ((latestVolume - avgVolume) / avgVolume) * 100 : 0;

    const recentData = prices.slice(-10).map((p, i) => ({
        date: p.time || '',
        volume: p.volume || 0,
        close: p.close || 0,
        change: prices[prices.length - 10 + i - 1]
            ? ((p.close || 0) - (prices[prices.length - 10 + i - 1]?.close || 0))
            : 0,
    }));

    const hasData = prices.length > 0;
    const isFallback = Boolean(error && hasData);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view volume" />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs">
                    <BarChart2 size={12} className="text-cyan-400" />
                    <span className="text-gray-400">Avg: {formatVolume(avgVolume)}</span>
                    <span className={volumeChange >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {volumeChange >= 0 ? '+' : ''}{volumeChange.toFixed(0)}%
                    </span>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded"
                    type="button"
                >
                    <BarChart2 size={12} className={isFetching ? 'animate-pulse' : ''} />
                </button>
            </div>

            <div className="pb-2 border-b border-gray-800/50">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note="30-day volume"
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-auto pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No volume data" icon={<BarChart2 size={18} />} />
                ) : (
                    <div className="space-y-1">
                        {recentData.map((day, i) => {
                            const widthPct = maxVolume > 0 ? (day.volume / maxVolume) * 100 : 0;
                            const isUp = day.change >= 0;
                            const isAboveAvg = day.volume > avgVolume;

                            return (
                                <div key={i} className="flex items-center gap-2">
                                    <div className="w-12 text-[10px] text-gray-500 shrink-0">
                                        {day.date.slice(5)}
                                    </div>
                                    <div className="flex-1 h-5 bg-gray-800/30 rounded overflow-hidden relative">
                                        <div
                                            className={`h-full transition-all ${isUp
                                                ? isAboveAvg ? 'bg-green-500' : 'bg-green-500/50'
                                                : isAboveAvg ? 'bg-red-500' : 'bg-red-500/50'
                                                }`}
                                            style={{ width: `${widthPct}%` }}
                                        />
                                        <span className="absolute right-1 top-0.5 text-[10px] text-gray-400">
                                            {formatVolume(day.volume)}
                                        </span>
                                    </div>
                                    <div className="w-8 shrink-0">
                                        {isUp ? (
                                            <TrendingUp size={12} className="text-green-400" />
                                        ) : (
                                            <TrendingDown size={12} className="text-red-400" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-center gap-4 pt-2 text-[10px] text-gray-500">
                <div className="flex items-center gap-1">
                    <div className="w-3 h-2 bg-green-500 rounded" />
                    <span>↑ High Vol</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-2 bg-red-500/50 rounded" />
                    <span>↓ Low Vol</span>
                </div>
            </div>
        </div>
    );
}
