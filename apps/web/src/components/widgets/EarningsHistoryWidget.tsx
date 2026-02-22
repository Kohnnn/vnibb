// Earnings History Widget - Company Calendar tab

'use client';

import { ChartBar } from 'lucide-react';
import { useFinancialRatios } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface EarningsHistoryWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatEps(value: number | null): string {
    if (value === null) return '-';
    return value.toFixed(2);
}

function formatPercent(value: number | null): string {
    if (value === null) return '-';
    return `${value.toFixed(2)}%`;
}

function formatPeriod(period: string | undefined): string {
    if (!period) return '-';
    return period;
}

export function EarningsHistoryWidget({ symbol }: EarningsHistoryWidgetProps) {
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useFinancialRatios(symbol, { period: 'FY', enabled: !!symbol });

    const rows = data?.data?.slice(0, 8) || [];
    const hasData = rows.length > 0;

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view earnings" icon={<ChartBar size={18} />} />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="pb-2 border-b border-[var(--border-subtle)]">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    note="Financial ratios"
                    align="right"
                />
            </div>
            <div className="flex-1 overflow-x-auto pt-3">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No earnings history available" icon={<ChartBar size={18} />} />
                ) : (
                    <table className="data-table w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-[var(--text-muted)] uppercase">
                                <th className="pb-2 pr-4">Period</th>
                                <th className="pb-2 pr-4 text-right">EPS</th>
                                <th className="pb-2 pr-4 text-right">ROE</th>
                                <th className="pb-2 pr-4 text-right">ROA</th>
                                <th className="pb-2 pr-4 text-right">Net Margin</th>
                                <th className="pb-2 text-right">P/E</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, idx) => (
                                <tr key={`${row.period || 'period'}-${idx}`} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]">
                                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{formatPeriod(row.period)}</td>
                                    <td className="py-2 pr-4 text-right text-[var(--text-primary)] font-medium">{formatEps(row.eps ?? null)}</td>
                                    <td className="py-2 pr-4 text-right text-[var(--text-primary)]">{formatPercent(row.roe ?? null)}</td>
                                    <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{formatPercent(row.roa ?? null)}</td>
                                    <td className="py-2 pr-4 text-right text-green-400 font-medium">{formatPercent(row.net_margin ?? null)}</td>
                                    <td className="py-2 text-right text-blue-400 font-medium">{formatEps(row.pe ?? null)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
