'use client';

import { Globe, TrendingDown, TrendingUp } from 'lucide-react';
import { useWorldIndices } from '@/lib/queries';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';

function formatValue(value: number | null | undefined): string {
    if (value === null || value === undefined) return '--';
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function WorldIndicesWidget() {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useWorldIndices();

    const rows = data?.data || [];
    const hasData = rows.length > 0;
    const isFallback = Boolean(data?.error);

    return (
        <div className="h-full flex flex-col">
            <div className="pb-2 border-b border-[var(--border-subtle)]">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note={data?.source || 'vnstock'}
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-auto space-y-1 pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No world index data available" icon={<Globe size={18} />} />
                ) : (
                    rows.map((row, index) => {
                        const isUp = (row.change_pct || 0) >= 0;
                        return (
                            <div
                                key={`${row.symbol}-${index}`}
                                className="flex items-center justify-between p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40"
                            >
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                        {row.name || row.symbol}
                                    </div>
                                    <div className="text-[10px] text-[var(--text-muted)]">{row.symbol}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs font-mono text-[var(--text-primary)]">{formatValue(row.value)}</div>
                                    <div className={`text-[11px] flex items-center justify-end gap-1 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                        {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                        {isUp ? '+' : ''}{(row.change_pct || 0).toFixed(2)}%
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
