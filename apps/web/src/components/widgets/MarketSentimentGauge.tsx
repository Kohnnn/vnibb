// Market Sentiment Gauge Widget - Aggregate sentiment visualization

'use client';

import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface MarketSentiment {
    overall: string;
    bullish_count: number;
    neutral_count: number;
    bearish_count: number;
    total_articles: number;
    bullish_percentage: number;
    bearish_percentage: number;
    trend_direction: string;
}

export function MarketSentimentGauge() {
    const { data, isLoading } = useQuery<MarketSentiment>({
        queryKey: ['market-sentiment'],
        queryFn: async () => {
            const response = await fetch('/api/v1/news/sentiment');
            if (!response.ok) throw new Error('Failed to fetch sentiment');
            return response.json();
        },
        refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
    });

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center">
                <div className="animate-pulse text-gray-500">Loading sentiment...</div>
            </div>
        );
    }

    if (!data || data.total_articles === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-gray-500">
                <Activity size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No sentiment data available</p>
            </div>
        );
    }

    const neutralPercentage = 100 - data.bullish_percentage - data.bearish_percentage;

    // Determine overall sentiment color
    const sentimentConfig = {
        bullish: {
            icon: TrendingUp,
            color: 'text-green-400',
            bg: 'bg-green-500/20',
            border: 'border-green-500/50',
        },
        neutral: {
            icon: Minus,
            color: 'text-gray-400',
            bg: 'bg-gray-500/20',
            border: 'border-gray-500/50',
        },
        bearish: {
            icon: TrendingDown,
            color: 'text-red-400',
            bg: 'bg-red-500/20',
            border: 'border-red-500/50',
        },
    };

    const config = sentimentConfig[data.overall as keyof typeof sentimentConfig] || sentimentConfig.neutral;
    const Icon = config.icon;

    // Trend arrow
    const trendConfig = {
        improving: { icon: TrendingUp, color: 'text-green-400', label: 'Improving' },
        stable: { icon: Minus, color: 'text-gray-400', label: 'Stable' },
        declining: { icon: TrendingDown, color: 'text-red-400', label: 'Declining' },
    };

    const trend = trendConfig[data.trend_direction as keyof typeof trendConfig] || trendConfig.stable;
    const TrendIcon = trend.icon;

    return (
        <div className="h-full flex flex-col p-4">
            {/* Overall Sentiment */}
            <div className={`flex items-center justify-center gap-3 p-4 rounded-lg border ${config.bg} ${config.border} mb-4`}>
                <Icon size={32} className={config.color} />
                <div>
                    <div className="text-xs text-gray-400 mb-1">Market Sentiment</div>
                    <div className={`text-2xl font-bold capitalize ${config.color}`}>
                        {data.overall}
                    </div>
                </div>
            </div>

            {/* Sentiment Distribution - Horizontal Bar */}
            <div className="mb-4">
                <div className="text-xs text-gray-400 mb-2">Sentiment Distribution</div>
                <div className="flex h-8 rounded overflow-hidden border border-gray-700">
                    {/* Bullish */}
                    <div
                        className="bg-green-500/80 flex items-center justify-center text-xs font-medium text-white transition-all"
                        style={{ width: `${data.bullish_percentage}%` }}
                        title={`Bullish: ${data.bullish_percentage.toFixed(1)}%`}
                    >
                        {data.bullish_percentage > 15 && `${data.bullish_percentage.toFixed(0)}%`}
                    </div>
                    {/* Neutral */}
                    <div
                        className="bg-gray-500/80 flex items-center justify-center text-xs font-medium text-white transition-all"
                        style={{ width: `${neutralPercentage}%` }}
                        title={`Neutral: ${neutralPercentage.toFixed(1)}%`}
                    >
                        {neutralPercentage > 15 && `${neutralPercentage.toFixed(0)}%`}
                    </div>
                    {/* Bearish */}
                    <div
                        className="bg-red-500/80 flex items-center justify-center text-xs font-medium text-white transition-all"
                        style={{ width: `${data.bearish_percentage}%` }}
                        title={`Bearish: ${data.bearish_percentage.toFixed(1)}%`}
                    >
                        {data.bearish_percentage > 15 && `${data.bearish_percentage.toFixed(0)}%`}
                    </div>
                </div>
            </div>

            {/* Counts */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="p-2 bg-green-500/10 border border-green-500/30 rounded">
                    <div className="text-xs text-green-400 mb-1">Bullish</div>
                    <div className="text-lg font-bold text-green-400">{data.bullish_count}</div>
                </div>
                <div className="p-2 bg-gray-500/10 border border-gray-500/30 rounded">
                    <div className="text-xs text-gray-400 mb-1">Neutral</div>
                    <div className="text-lg font-bold text-gray-400">{data.neutral_count}</div>
                </div>
                <div className="p-2 bg-red-500/10 border border-red-500/30 rounded">
                    <div className="text-xs text-red-400 mb-1">Bearish</div>
                    <div className="text-lg font-bold text-red-400">{data.bearish_count}</div>
                </div>
            </div>

            {/* Trend */}
            <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded border border-gray-700/50">
                <span className="text-xs text-gray-400">Trend:</span>
                <div className={`flex items-center gap-1 ${trend.color}`}>
                    <TrendIcon size={14} />
                    <span className="text-sm font-medium">{trend.label}</span>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-auto pt-3 border-t border-gray-800 text-[10px] text-gray-500 text-center">
                Based on {data.total_articles} articles analyzed
            </div>
        </div>
    );
}
