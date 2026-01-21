// Quick Stats Widget - Summary statistics at a glance

'use client';

import { Activity, TrendingUp, TrendingDown, BarChart2, DollarSign } from 'lucide-react';
import { useHistoricalPrices, useScreenerData } from '@/lib/queries';

interface QuickStatsWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

export function QuickStatsWidget({ symbol, isEditing, onRemove }: QuickStatsWidgetProps) {
    const { data: prices, isLoading: pricesLoading } = useHistoricalPrices(symbol, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
    const { data: screenerData, isLoading: screenerLoading } = useScreenerData({ symbol, enabled: !!symbol });
    const stock = screenerData?.data?.find(s => s.ticker === symbol) || screenerData?.data?.[0];

    const priceData = prices?.data || [];
    const latest = priceData[priceData.length - 1];
    const prev = priceData[priceData.length - 2];
    const change = latest && prev ? ((latest.close - prev.close) / prev.close * 100) : null;

    // Calculate 30-day high/low
    const closes = priceData.map(p => p.close || 0);
    const high30 = Math.max(...closes);
    const low30 = Math.min(...closes.filter(c => c > 0));

    // Average volume
    const volumes = priceData.map(p => p.volume || 0);
    const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;

    const isLoading = pricesLoading || screenerLoading;

    const stats = [
        {
            label: 'Price',
            value: latest?.close?.toLocaleString() || '-',
            icon: DollarSign,
            color: 'text-blue-400'
        },
        {
            label: 'Change',
            value: change !== null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '-',
            icon: change && change >= 0 ? TrendingUp : TrendingDown,
            color: change && change >= 0 ? 'text-green-400' : 'text-red-400'
        },
        {
            label: '30D High',
            value: high30 > 0 ? high30.toLocaleString() : '-',
            icon: TrendingUp,
            color: 'text-green-400'
        },
        {
            label: '30D Low',
            value: low30 > 0 ? low30.toLocaleString() : '-',
            icon: TrendingDown,
            color: 'text-red-400'
        },
        {
            label: 'Avg Volume',
            value: avgVol > 0 ? `${(avgVol / 1e6).toFixed(1)}M` : '-',
            icon: BarChart2,
            color: 'text-cyan-400'
        },
        {
            label: 'P/E Ratio',
            value: stock?.pe?.toFixed(1) || '-',
            icon: Activity,
            color: 'text-purple-400'
        },
    ];

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-2 px-1 py-1 mb-2 text-xs text-gray-500">
                <Activity size={12} className="text-blue-400" />
                <span>Quick Stats - {symbol}</span>
            </div>

            {/* Stats Grid */}
            <div className="flex-1 overflow-auto">
                {isLoading ? (
                    <div className="grid grid-cols-2 gap-2">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="animate-pulse h-16 bg-gray-800/30 rounded" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {stats.map((stat, i) => (
                            <div
                                key={i}
                                className="p-3 rounded-lg bg-gray-800/30 hover:bg-gray-800/50"
                            >
                                <div className="flex items-center gap-1.5 mb-1">
                                    <stat.icon size={12} className={stat.color} />
                                    <span className="text-[10px] text-gray-500">{stat.label}</span>
                                </div>
                                <div className={`text-lg font-bold ${stat.color}`}>
                                    {stat.value}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
