// Volume Analysis Widget - Volume profile and analysis

'use client';

import { BarChart2, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';

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

export function VolumeAnalysisWidget({ symbol, isEditing, onRemove }: VolumeAnalysisWidgetProps) {
    const { data, isLoading, refetch, isRefetching } = useHistoricalPrices(symbol, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });

    const prices = data?.data || [];

    // Calculate volume metrics
    const volumes = prices.map(p => p.volume || 0);
    const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
    const maxVolume = Math.max(...volumes, 1);
    const latestVolume = volumes[volumes.length - 1] || 0;
    const volumeChange = avgVolume > 0 ? ((latestVolume - avgVolume) / avgVolume) * 100 : 0;

    // Get last 10 days for display
    const recentData = prices.slice(-10).map((p, i) => ({
        date: p.time || '',
        volume: p.volume || 0,
        close: p.close || 0,
        change: prices[prices.length - 10 + i - 1]
            ? ((p.close || 0) - (prices[prices.length - 10 + i - 1]?.close || 0))
            : 0,
    }));

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
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
                    disabled={isRefetching}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded"
                >
                    <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Volume Bars */}
            <div className="flex-1 overflow-auto">
                {isLoading ? (
                    <div className="space-y-2">
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="animate-pulse h-6 bg-gray-800/30 rounded" />
                        ))}
                    </div>
                ) : recentData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                        <BarChart2 size={24} className="mb-2 opacity-30" />
                        <p className="text-xs">No volume data</p>
                    </div>
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

            {/* Legend */}
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
