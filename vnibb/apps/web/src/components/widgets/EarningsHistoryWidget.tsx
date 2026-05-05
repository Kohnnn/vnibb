// Earnings History Widget - company earnings timeline

'use client';

import { useMemo } from 'react';
import { ChartBar } from 'lucide-react';

import { useIncomeStatement } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useUnit } from '@/contexts/UnitContext';
import { formatFinancialPeriodLabel, isCanonicalQuarterPeriod, periodSortKey } from '@/lib/financialPeriods';
import { convertFinancialValueForUnit, formatNumber, formatPercent } from '@/lib/units';

interface EarningsHistoryWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

export function EarningsHistoryWidget({ symbol }: EarningsHistoryWidgetProps) {
    const { config: unitConfig } = useUnit();
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useIncomeStatement(symbol, { period: 'quarter', enabled: !!symbol, limit: 8 });

    const rows = useMemo(
        () => [...(data?.data || [])]
            .filter((row) => isCanonicalQuarterPeriod(row.period))
            .sort((left, right) => periodSortKey(right.period) - periodSortKey(left.period)),
        [data?.data]
    );
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
                    note="Latest first"
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
                                <th className="pb-2 pr-4 text-right">Revenue</th>
                                <th className="pb-2 pr-4 text-right">Pre-tax</th>
                                <th className="pb-2 pr-4 text-right">Net Income</th>
                                <th className="pb-2 pr-4 text-right">EPS</th>
                                <th className="pb-2 text-right">Net Margin</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, idx) => {
                                const netMargin = row.revenue && row.net_income
                                    ? (row.net_income / row.revenue) * 100
                                    : null;

                                return (
                                    <tr key={`${row.period || 'period'}-${idx}`} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]">
                                        <td className="py-2 pr-4 text-[var(--text-secondary)]">{formatFinancialPeriodLabel(row.period, { mode: 'quarter' })}</td>
                                        <td className="py-2 pr-4 text-right text-[var(--text-primary)]">{formatNumber(convertFinancialValueForUnit(row.revenue ?? null, unitConfig, row.period), { decimals: 0 })}</td>
                                        <td className="py-2 pr-4 text-right text-[var(--text-primary)]">{formatNumber(convertFinancialValueForUnit(row.pre_tax_profit ?? row.profit_before_tax ?? null, unitConfig, row.period), { decimals: 0 })}</td>
                                        <td className="py-2 pr-4 text-right text-[var(--text-primary)]">{formatNumber(convertFinancialValueForUnit(row.net_income ?? null, unitConfig, row.period), { decimals: 0 })}</td>
                                        <td className="py-2 pr-4 text-right text-[var(--text-primary)] font-medium">{formatNumber(convertFinancialValueForUnit(row.eps ?? null, unitConfig, row.period), { decimals: 2 })}</td>
                                        <td className="py-2 text-right text-green-400 font-medium">{formatPercent(netMargin, { decimals: 2, input: 'percent', clamp: 'margin' })}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
