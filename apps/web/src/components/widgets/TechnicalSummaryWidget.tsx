// Technical Summary Widget - Key technical indicators

'use client';

import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Info } from 'lucide-react';
import { useFullTechnicalAnalysis } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
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
        default: return 'text-[var(--text-secondary)]';
    }
}

function getSignalBg(signal: string): string {
    switch (signal?.toLowerCase()) {
        case 'strong_buy':
        case 'buy': return 'bg-green-500/20';
        case 'strong_sell':
        case 'sell': return 'bg-red-500/20';
        default: return 'bg-[var(--bg-tertiary)]';
    }
}

function getTrendColor(strength: string): string {
    switch (strength) {
        case 'very_strong': return 'text-blue-400';
        case 'strong': return 'text-cyan-400';
        case 'moderate': return 'text-yellow-400';
        case 'weak': return 'text-[var(--text-secondary)]';
        default: return 'text-[var(--text-muted)]';
    }
}

function buildSignalGaugeBackground(buyCount: number, neutralCount: number, sellCount: number): string {
    const total = buyCount + neutralCount + sellCount;
    if (total <= 0) {
        return 'conic-gradient(from 180deg, rgba(100,116,139,0.28) 0 100%)';
    }

    const segments = [
        { value: buyCount, color: '#4ade80' },
        { value: neutralCount, color: '#94a3b8' },
        { value: sellCount, color: '#f87171' },
    ];

    let cursor = 0;
    const stops: string[] = [];
    for (const segment of segments) {
        if (segment.value <= 0) continue;
        const nextCursor = cursor + (segment.value / total) * 100;
        stops.push(`${segment.color} ${cursor}% ${nextCursor}%`);
        cursor = nextCursor;
    }

    if (cursor < 100) {
        stops.push(`rgba(100,116,139,0.28) ${cursor}% 100%`);
    }

    return `conic-gradient(from 180deg, ${stops.join(', ')})`;
}

import { WidgetContainer } from '@/components/ui/WidgetContainer';

export function TechnicalSummaryWidget({ symbol, isEditing, onRemove }: TechnicalSummaryWidgetProps) {
    const [timeframe, setTimeframe] = useState<Timeframe>('D');
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useFullTechnicalAnalysis(symbol, { timeframe });

    const ta = data;
    const hasData = Boolean(ta);
    const isFallback = Boolean(error && hasData);
    const signals = ta?.signals;
    const overallSignal = signals?.overall_signal || 'neutral';
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });
    const movingAverageSignals = ta?.moving_averages?.signals
        ? Object.entries(ta.moving_averages.signals).slice(0, 4)
        : [];
    const supportResistance = ta?.levels?.support_resistance;
    const fibonacciLevels = ta?.levels?.fibonacci?.levels
        ? Object.entries(ta.levels.fibonacci.levels)
        : [];
    const buyCount = signals?.buy_count || 0;
    const neutralCount = signals?.neutral_count || 0;
    const sellCount = signals?.sell_count || 0;
    const totalSignals = Math.max(signals?.total_indicators || 0, buyCount + neutralCount + sellCount, 1);
    const gaugeBackground = useMemo(
        () => buildSignalGaugeBackground(buyCount, neutralCount, sellCount),
        [buyCount, neutralCount, sellCount]
    );
    const signalBias = Math.round(((buyCount - sellCount) / totalSignals) * 100);

    const timeframeLabel = {
        'D': 'Daily',
        'W': 'Weekly',
        'M': 'Monthly'
    }[timeframe];

    const headerActions = (
        <div className="flex bg-[var(--bg-secondary)] rounded-md p-0.5 border border-[var(--border-color)] mr-2">
            {(['D', 'W', 'M'] as Timeframe[]).map((tf) => (
                <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded ${timeframe === tf
                            ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
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
            isLoading={isLoading && !hasData}
            headerActions={headerActions}
            noPadding
        >
            {timedOut && isLoading && !hasData ? (
                <WidgetError
                    title="Loading timed out"
                    error={new Error('Technical summary took too long to load.')}
                    onRetry={() => {
                        resetTimeout();
                        refetch();
                    }}
                />
            ) : isLoading && !hasData ? (
                <WidgetSkeleton lines={6} />
            ) : error && !hasData ? (
                <WidgetError error={error as Error} onRetry={() => refetch()} />
            ) : !hasData ? (
                <WidgetEmpty message="No technical data available." />
            ) : (
                <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-3 scrollbar-hide text-left">
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={timeframeLabel}
                        align="right"
                    />

                    {/* Signal Indicator */}
                    <Card className="bg-[var(--bg-secondary)] border-[var(--border-color)] p-2.5 flex flex-col items-center justify-center relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent opacity-30" />
                        <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1 tracking-tighter">Overall Signal</div>
                        <Badge variant="outline" className={`text-sm py-0.5 px-3 font-bold border-none ${getSignalBg(overallSignal)} ${getSignalColor(overallSignal)}`}>
                            {overallSignal.replace('_', ' ').toUpperCase()}
                        </Badge>
                        <div className="relative mt-3 flex h-28 w-28 items-center justify-center rounded-full border border-[var(--border-default)]/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]" style={{ background: gaugeBackground }}>
                            <div className="absolute inset-[14px] rounded-full border border-[var(--border-default)]/60 bg-[var(--bg-secondary)]" />
                            <div className="relative z-10 flex flex-col items-center">
                                <span className="text-xl font-black text-[var(--text-primary)]">{totalSignals}</span>
                                <span className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Signals</span>
                            </div>
                        </div>
                        <div className="mt-3 grid w-full grid-cols-3 gap-2 text-[10px] font-mono">
                            <div className="flex flex-col items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5">
                                <span className="text-green-400 font-bold">{buyCount}</span>
                                <span className="text-[var(--text-muted)]">Buy</span>
                            </div>
                            <div className="flex flex-col items-center rounded-md border border-slate-500/20 bg-slate-500/10 px-2 py-1.5">
                                <span className="text-[var(--text-secondary)] font-bold">{neutralCount}</span>
                                <span className="text-[var(--text-muted)]">Neutral</span>
                            </div>
                            <div className="flex flex-col items-center rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1.5">
                                <span className="text-red-400 font-bold">{sellCount}</span>
                                <span className="text-[var(--text-muted)]">Sell</span>
                            </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-[9px]">
                            <span className="text-[var(--text-muted)]">Trend Strength: </span>
                            <span className={`${getTrendColor(signals?.trend_strength || '')} font-bold capitalize`}>
                                {(signals?.trend_strength || 'N/A').replace('_', ' ')}
                            </span>
                            <span className="text-[var(--text-muted)]">| Bias:</span>
                            <span className={signalBias >= 0 ? 'font-bold text-emerald-400' : 'font-bold text-rose-400'}>
                                {signalBias >= 0 ? '+' : ''}{signalBias}
                            </span>
                        </div>
                    </Card>

                    {/* Moving Averages */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between px-1 text-left">
                            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Moving Averages</span>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger><Info size={10} className="text-[var(--text-muted)]" /></TooltipTrigger>
                                    <TooltipContent className="text-[10px] bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-secondary)]">SMA/EMA crossovers and price relative position</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                            {movingAverageSignals.map(([name, signal]) => {
                                const isSMA = name.startsWith('sma');
                                const val = isSMA ? ta?.moving_averages?.sma?.[name] : ta?.moving_averages?.ema?.[name];
                                return (
                                    <div key={name} className="flex flex-col p-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-color)] transition-colors">
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[10px] text-[var(--text-secondary)] font-bold">{name.toUpperCase()}</span>
                                            <span className={`text-[9px] font-bold ${getSignalColor(signal)}`}>{signal.toUpperCase()}</span>
                                        </div>
                                        <div className="text-xs text-[var(--text-primary)] font-mono">{val?.toLocaleString()}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Oscillators */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between px-1 text-left">
                            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Oscillators</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                            <div className="flex flex-col p-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] items-center">
                                <span className="text-[9px] text-[var(--text-muted)] font-bold">RSI</span>
                                <span className={`text-[11px] font-mono ${getSignalColor(ta?.oscillators?.rsi?.signal || '')}`}>
                                    {ta?.oscillators?.rsi?.value?.toFixed(1) || '--'}
                                </span>
                            </div>
                            <div className="flex flex-col p-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] items-center">
                                <span className="text-[9px] text-[var(--text-muted)] font-bold">MACD</span>
                                <span className={`text-[11px] font-mono ${getSignalColor(ta?.oscillators?.macd?.signal || '')}`}>
                                    {ta?.oscillators?.macd?.histogram?.toFixed(2) || '--'}
                                </span>
                            </div>
                            <div className="flex flex-col p-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] items-center">
                                <span className="text-[9px] text-[var(--text-muted)] font-bold">STOCH</span>
                                <span className={`text-[11px] font-mono ${getSignalColor(ta?.oscillators?.stochastic?.signal || '')}`}>
                                    {ta?.oscillators?.stochastic?.k?.toFixed(1) || '--'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Support & Resistance */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between px-1 text-left">
                            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Levels</span>
                        </div>
                        <div className="space-y-1 text-left">
                            <div className="flex justify-between items-center p-1.5 rounded bg-red-950/10 border-l-2 border-red-500/50">
                                <span className="text-[10px] text-[var(--text-secondary)] font-bold uppercase">Resistance</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-[var(--text-primary)] font-mono">{supportResistance?.nearest_resistance?.toLocaleString() || '--'}</span>
                                    <span className="text-[9px] text-red-400">{supportResistance?.resistance_proximity_pct != null ? `+${supportResistance.resistance_proximity_pct.toFixed(1)}%` : '--'}</span>
                                </div>
                            </div>
                            <div className="flex justify-between items-center p-1.5 rounded bg-green-950/10 border-l-2 border-green-500/50">
                                <span className="text-[10px] text-[var(--text-secondary)] font-bold uppercase">Support</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-[var(--text-primary)] font-mono">{supportResistance?.nearest_support?.toLocaleString() || '--'}</span>
                                    <span className="text-[9px] text-green-400">{supportResistance?.support_proximity_pct != null ? `-${supportResistance.support_proximity_pct.toFixed(1)}%` : '--'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Fibonacci */}
                    <div className="pb-2">
                        <div className="flex items-center justify-between px-1 mb-1.5 text-left">
                            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Fibonacci Retracement</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] p-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] font-mono text-left">
                            {fibonacciLevels.map(([ratio, level]) => (
                                <div key={ratio} className="flex justify-between">
                                    <span className="text-[var(--text-muted)] font-bold">{ratio}</span>
                                    <span className="text-[var(--text-secondary)]">{level.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </WidgetContainer>
    );
}
