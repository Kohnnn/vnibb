'use client';

import { Gem } from 'lucide-react';
import { useCommodities } from '@/lib/queries';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';

function formatPrice(value: number | null | undefined): string {
    if (value === null || value === undefined) return '--';
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function CommoditiesWidget() {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useCommodities();

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
                    <WidgetEmpty message="No commodities data available" icon={<Gem size={18} />} />
                ) : (
                    rows.map((row, index) => {
                        const spread = (row.sell_price ?? 0) - (row.buy_price ?? 0);
                        return (
                            <div
                                key={`${row.source}-${row.symbol}-${index}`}
                                className="flex items-center justify-between p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40"
                            >
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                        {row.name || row.symbol || 'Commodity'}
                                    </div>
                                    <div className="text-[10px] text-[var(--text-muted)]">{row.source}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                                        Buy {formatPrice(row.buy_price)}
                                    </div>
                                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                                        Sell {formatPrice(row.sell_price)}
                                    </div>
                                    <div className={`text-[10px] font-mono ${spread >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                                        Spread {spread >= 0 ? '+' : ''}{formatPrice(spread)}
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
