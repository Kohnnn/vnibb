'use client';

import { DollarSign } from 'lucide-react';
import { useForexRates } from '@/lib/queries';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';

function formatRate(value: number | null | undefined): string {
    if (value === null || value === undefined) return '--';
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function ForexRatesWidget() {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useForexRates();

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

            <div className="flex-1 overflow-auto pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No forex rates available" icon={<DollarSign size={18} />} />
                ) : (
                    <table className="data-table w-full text-xs">
                        <thead className="text-[var(--text-muted)] sticky top-0 bg-[var(--bg-secondary)]">
                            <tr className="border-b border-[var(--border-subtle)]">
                                <th className="text-left py-1.5 px-1 font-medium">Pair</th>
                                <th className="text-right py-1.5 px-1 font-medium">Buy</th>
                                <th className="text-right py-1.5 px-1 font-medium">Sell</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={`${row.currency_code}-${index}`} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--bg-tertiary)]/40">
                                    <td className="py-1.5 px-1 font-medium text-[var(--text-primary)]">{row.currency_code}/VND</td>
                                    <td className="py-1.5 px-1 text-right text-[var(--text-secondary)] font-mono">
                                        {formatRate(row.buy_transfer ?? row.buy_cash)}
                                    </td>
                                    <td className="py-1.5 px-1 text-right text-[var(--text-secondary)] font-mono">
                                        {formatRate(row.sell)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
