// Dividend Payment Widget - Company Calendar tab

'use client';

import { Calendar } from 'lucide-react';
import { useDividends } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface DividendPaymentWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatValue(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return value.toLocaleString('vi-VN');
}

export function DividendPaymentWidget({ symbol }: DividendPaymentWidgetProps) {
    const isEnabled = Boolean(symbol);
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useDividends(symbol, isEnabled);

    const rows = (data?.data || []).filter((row) => row.value !== null && row.value !== undefined);
    const hasData = rows.length > 0;
    const isFallback = Boolean(error && hasData);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view dividends" icon={<Calendar size={18} />} />;
    }

    return (
        <div aria-label="Dividend payment history" className="h-full flex flex-col">
            <div className="pb-2 border-b border-[var(--border-subtle)]">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note="Currency: VND"
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-x-auto pt-3">
                {isLoading && !hasData ? (
                    <WidgetSkeleton variant="table" lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty
                        message={`No dividend data for ${symbol}`}
                        icon={<Calendar size={18} />}
                    />
                ) : (
                    <table className="data-table w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-[var(--text-muted)] uppercase">
                                <th className="pb-2 pr-3">Ex Date</th>
                                <th className="pb-2 pr-3">Record Date</th>
                                <th className="pb-2 pr-3">Payment Date</th>
                                <th className="pb-2 pr-3">Type</th>
                                <th className="pb-2 text-right">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, idx) => (
                                <tr
                                    key={`${row.ex_date}-${idx}`}
                                    className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                                >
                                    <td className="py-2 pr-3 text-[var(--text-primary)]">{row.ex_date || '-'}</td>
                                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{row.record_date || '-'}</td>
                                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{row.payment_date || '-'}</td>
                                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{row.dividend_type || '-'}</td>
                                    <td className="py-2 text-right text-green-400 font-medium">{formatValue(row.value)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
