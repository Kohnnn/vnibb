// Technical Summary Widget - Key technical indicators

'use client';

import { useState } from 'react';
import { Activity, RefreshCw, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { useFullTechnicalAnalysis } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Signal, Timeframe } from '@/types/technical';

interface TechnicalSummaryWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function getSignalColor(signal: string): string {
    switch (signal?.toLowerCase()) {
        case 'strong_buy':
        case 'buy': return 'text-green-400';
        case 'strong_sell':
        case 'sell': return 'text-red-400';
        default: return 'text-gray-400';
    }
}

function getSignalBg(signal: string): string {
    switch (signal?.toLowerCase()) {
        case 'strong_buy':
        case 'buy': return 'bg-green-500/20';
        case 'strong_sell':
        case 'sell': return 'bg-red-500/20';
        default: return 'bg-gray-500/20';
    }
}

function getTrendColor(strength: string): string {
    switch (strength) {
        case 'very_strong': return 'text-blue-400';
        case 'strong': return 'text-cyan-400';
        case 'moderate': return 'text-yellow-400';
        case 'weak': return 'text-gray-400';
        default: return 'text-gray-500';
    }
}

import { WidgetContainer } from '@/components/ui/WidgetContainer';

export function TechnicalSummaryWidget({ symbol, isEditing, onRemove }: TechnicalSummaryWidgetProps) {
    const [timeframe, setTimeframe] = useState<Timeframe>('D');
    const { data, isLoading, refetch, isRefetching } = useFullTechnicalAnalysis(symbol, { timeframe });

    const ta = data;
    const signals = ta?.signals;
    const overallSignal = signals?.overall_signal || 'neutral';

    const timeframeLabel = {
        'D': 'Daily',
        'W': 'Weekly',
        'M': 'Monthly'
    }[timeframe];

    const headerActions = (
        <div className="flex bg-gray-900 rounded-md p-0.5 border border-gray-800 mr-2">
            {(['D', 'W', 'M'] as Timeframe[]).map((tf) => (
                <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded ${timeframe === tf
                            ? 'bg-gray-800 text-white shadow-sm'
                            : 'text-gray-500 hover:text-gray-300'
                        } transition-all`}
                >
                    {tf}
                </button>
            ))}
        </div>
    );

    return (
        <WidgetContainer
            title="Technical Analysis"
            symbol={symbol}
            subtitle={timeframeLabel}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            headerActions={headerActions}
            noPadding
        >
            {isLoading ? (
                <div className="space-y-4 p-4">
                    <Skeleton className="h-16 w-full rounded-lg bg-gray-800/50" />
                    <Skeleton className="h-32 w-full rounded-lg bg-gray-800/50" />
                    <Skeleton className="h-32 w-full rounded-lg bg-gray-800/50" />
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4 scrollbar-hide text-left">
                    {/* Signal Indicator */}
                    <Card className="bg-gray-900/40 border-gray-800 p-3 flex flex-col items-center justify-center relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500/50 to-transparent opacity-30" />
                        <div className="text-[10px] text-gray-500 uppercase font-semibold mb-1 tracking-tighter">Overall Signal</div>
                        <Badge variant="outline" className={`text-sm py-0.5 px-3 font-bold border-none ${getSignalBg(overallSignal)} ${getSignalColor(overallSignal)}`}>
                            {overallSignal.replace('_', ' ').toUpperCase()}
                        </Badge>
                        <div className="flex gap-4 mt-3 text-[10px] font-mono">
                            <div className="flex flex-col items-center">
                                <span className="text-green-400 font-bold">{signals?.buy_count || 0}</span>
                                <span className="text-gray-600">Buy</span>
                            </div>
                            <div className="flex flex-col items-center">
                                <span className="text-gray-400 font-bold">{signals?.neutral_count || 0}</span>
                                <span className="text-gray-600">Neutral</span>
                            </div>
                            <div className="flex flex-col items-center">
                                <span className="text-red-400 font-bold">{signals?.sell_count || 0}</span>
                                <span className="text-gray-600">Sell</span>
                            </div>
                        </div>
                        <div className="mt-2 text-[9px]">
                            <span className="text-gray-500">Trend Strength: </span>
                            <span className={`${getTrendColor(signals?.trend_strength || '')} font-bold capitalize`}>
                                {(signals?.trend_strength || 'N/A').replace('_', ' ')}
                            </span>
                        </div>
                    </Card>

                    {/* Moving Averages */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between px-1 text-left">
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Moving Averages</span>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger><Info size={10} className="text-gray-600" /></TooltipTrigger>
                                    <TooltipContent className="text-[10px] bg-gray-900 border-gray-800">SMA/EMA crossovers and price relative position</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            {ta?.moving_averages && Object.entries(ta.moving_averages.signals).slice(0, 4).map(([name, signal], i) => {
                                const isSMA = name.startsWith('sma');
                                const val = isSMA ? ta.moving_averages.sma[name] : ta.moving_averages.ema[name];
                                return (
                                    <div key={name} className="flex flex-col p-2 rounded bg-gray-800/20 border border-gray-800/10 hover:border-gray-800/50 transition-colors">
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[10px] text-gray-400 font-bold">{name.toUpperCase()}</span>
                                            <span className={`text-[9px] font-bold ${getSignalColor(signal)}`}>{signal.toUpperCase()}</span>
                                        </div>
                                        <div className="text-xs text-white font-mono">{val?.toLocaleString()}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Oscillators */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between px-1 text-left">
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Oscillators</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                            <div className="flex flex-col p-1.5 rounded bg-gray-800/20 items-center">
                                <span className="text-[9px] text-gray-500 font-bold">RSI</span>
                                <span className={`text-[11px] font-mono ${getSignalColor(ta?.oscillators.rsi.signal || '')}`}>
                                    {ta?.oscillators.rsi.value?.toFixed(1) || '--'}
                                </span>
                            </div>
                            <div className="flex flex-col p-1.5 rounded bg-gray-800/20 items-center">
                                <span className="text-[9px] text-gray-500 font-bold">MACD</span>
                                <span className={`text-[11px] font-mono ${getSignalColor(ta?.oscillators.macd.signal || '')}`}>
                                    {ta?.oscillators.macd.histogram?.toFixed(2) || '--'}
                                </span>
                            </div>
                            <div className="flex flex-col p-1.5 rounded bg-gray-800/20 items-center">
                                <span className="text-[9px] text-gray-500 font-bold">STOCH</span>
                                <span className={`text-[11px] font-mono ${getSignalColor(ta?.oscillators.stochastic.signal || '')}`}>
                                    {ta?.oscillators.stochastic.k?.toFixed(1) || '--'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Support & Resistance */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between px-1 text-left">
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Levels</span>
                        </div>
                        <div className="space-y-1 text-left">
                            <div className="flex justify-between items-center p-2 rounded bg-red-950/10 border-l-2 border-red-500/50">
                                <span className="text-[10px] text-gray-400 font-bold uppercase">Resistance</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-white font-mono">{ta?.levels.support_resistance.nearest_resistance?.toLocaleString() || '--'}</span>
                                    <span className="text-[9px] text-red-400">+{ta?.levels.support_resistance.resistance_proximity_pct?.toFixed(1)}%</span>
                                </div>
                            </div>
                            <div className="flex justify-between items-center p-2 rounded bg-green-950/10 border-l-2 border-green-500/50">
                                <span className="text-[10px] text-gray-400 font-bold uppercase">Support</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-white font-mono">{ta?.levels.support_resistance.nearest_support?.toLocaleString() || '--'}</span>
                                    <span className="text-[9px] text-green-400">-{ta?.levels.support_resistance.support_proximity_pct?.toFixed(1)}%</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Fibonacci */}
                    <div className="pb-2">
                        <div className="flex items-center justify-between px-1 mb-1.5 text-left">
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Fibonacci Retracement</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] p-2 rounded bg-gray-900/60 font-mono text-left">
                            {ta?.levels.fibonacci.levels && Object.entries(ta.levels.fibonacci.levels).map(([ratio, level]) => (
                                <div key={ratio} className="flex justify-between">
                                    <span className="text-gray-600 font-bold">{ratio}</span>
                                    <span className="text-gray-300">{level.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </WidgetContainer>
    );
}

