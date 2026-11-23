// Dividend Payment Widget - Company Calendar tab

'use client';

import { useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { useDividends } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { DividendCoverageNotice } from './DividendCoverageNotice';
import { admittedDividendRows, dividendCoverageBasis, dividendDistributionExport, dividendExport, dividendRowLabel, readDividendCoverage } from '@/lib/dividendHistory';
import { formatDividendPayout } from '@/lib/formatters';
import { EMPTY_VALUE } from '@/lib/units';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';

/** Payout is a magnitude, not a signed direction: brand §13 leaves it in ink. */
function payoutCell(row: Parameters<typeof formatDividendPayout>[0]) {
    const payout = formatDividendPayout(row);
    return <span className={payout === EMPTY_VALUE ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{payout}</span>;
}

interface DividendPaymentWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}


export function DividendPaymentWidget({ symbol, onDataChange }: DividendPaymentWidgetProps) {
    const isEnabled = Boolean(symbol);
    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useDividends(symbol, isEnabled);

    const coverage = readDividendCoverage(data);
    const rows = admittedDividendRows(data);
    const hasData = rows.length > 0;
    const failure = error?.message || data?.error;
    const isFallback = Boolean(failure && hasData);

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            empty: !hasData,
            apiGroup: '/equity',
            endpoint: `/equity/${symbol}/dividends`,
            sourceLabel: 'Retained dividend observations',
            lastDataDate: null,
            fetchedAt: dataUpdatedAt,
            cached: isFallback,
            refreshStatus: isFallback ? 'failed' : undefined,
            coverage: coverage?.status === 'partial' ? 'partial' : 'unknown',
            observationStatus: isLoading && !hasData ? 'loading' : hasData ? 'available' : 'unavailable',
            basis: dividendCoverageBasis(coverage),
            exportData: dividendExport(coverage, rows.map(dividendDistributionExport)),
            extra: { rows: rows.length },
        }));
    }, [coverage, dataUpdatedAt, hasData, isFallback, isLoading, onDataChange, rows, symbol]);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view dividends" icon={<Calendar size={18} />} />;
    }

    return (
        <div aria-label="Dividend payment observations" className="h-full flex flex-col">
            <div className="pb-2 border-b border-[var(--border-subtle)]">
                <WidgetMeta
                    updatedAt={null}
                    fetchedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    align="right"
                />
            </div>

            <div className="min-h-0 flex-1 overflow-auto space-y-2 pt-3">
                {(!isLoading || coverage) && <DividendCoverageNotice coverage={coverage} failed={Boolean(failure)} />}
                {isLoading && !hasData ? (
                    <WidgetSkeleton variant="table" lines={6} />
                ) : failure && !hasData ? (
                    <WidgetError error={new Error(failure)} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty
                        message={`No qualified dividend observations for ${symbol}`}
                        icon={<Calendar size={18} />}
                    />
                ) : (
                    <table className="data-table w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-[var(--text-muted)] uppercase">
                                <th className="pb-2 pr-3">Ex Date</th>
                                <th className="pb-2 pr-3">Record Date</th>
                                <th className="pb-2 pr-3">Payment Date</th>
                                <th className="pb-2 pr-3">Distribution</th>
                                <th className="pb-2 text-right">Payout</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, idx) => (
                                <tr
                                    key={`${row.dataset}-${row.observation_id ?? idx}`}
                                    className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                                >
                                    <td className="py-2 pr-3 text-[var(--text-primary)]">{row.ex_date || EMPTY_VALUE}</td>
                                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{row.record_date || EMPTY_VALUE}</td>
                                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{row.payment_date || EMPTY_VALUE}</td>
                                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{dividendRowLabel(row)}</td>
                                    <td className="py-2 text-right font-medium">{payoutCell(row)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
