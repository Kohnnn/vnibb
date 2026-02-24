// Dividend Payment Widget - Company Calendar tab

'use client';

import { Calendar } from 'lucide-react';
import { useDividends } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { formatPercent, formatVND } from '@/lib/formatters';
import type { DividendRecord } from '@/lib/api';

interface DividendPaymentWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatDividendType(type: string | null | undefined): string {
    if (!type) return 'Dividend';
    const normalized = type.toLowerCase();
    if (normalized === 'cash') return 'Cash';
    if (normalized === 'stock') return 'Stock';
    if (normalized === 'mixed') return 'Mixed';
    return 'Other';
}

function formatDividendValue(row: DividendRecord): string {
    if (row.cash_dividend !== null && row.cash_dividend !== undefined) {
        return formatVND(row.cash_dividend);
    }
    if (row.stock_dividend !== null && row.stock_dividend !== undefined) {
        return `${row.stock_dividend.toFixed(2)}% stock`;
    }
    if (row.dividend_ratio !== null && row.dividend_ratio !== undefined) {
        return String(row.dividend_ratio);
    }
    if (row.value !== null && row.value !== undefined) {
        return formatVND(row.value);
    }
    return '-';
}

function formatDividendYield(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return formatPercent(value);
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

    const rows = (data?.data || []).filter(
        (row) =>
            (row.cash_dividend !== null && row.cash_dividend !== undefined) ||
            (row.stock_dividend !== null && row.stock_dividend !== undefined) ||
            (row.value !== null && row.value !== undefined) ||
            (row.dividend_ratio !== null && row.dividend_ratio !== undefined)
    );
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
                    note="Yield uses latest close"
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
                                <th className="pb-2 pr-3">Year</th>
                                <th className="pb-2 pr-3 text-right">Yield</th>
                                <th className="pb-2 text-right">Payout</th>
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
                                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{formatDividendType(row.dividend_type || row.type)}</td>
                                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{row.year || row.fiscal_year || row.issue_year || '-'}</td>
                                    <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{formatDividendYield(row.dividend_yield)}</td>
                                    <td className="py-2 text-right text-green-400 font-medium">{formatDividendValue(row)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
