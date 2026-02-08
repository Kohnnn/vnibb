// Financial Statements Widget - Income Statement, Balance Sheet, Cash Flow
'use client';

import { useState, useMemo } from 'react';
import { ExportButton } from '@/components/common/ExportButton';
import { exportFinancials } from '@/lib/api';
import { useFinancials } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

type StatementType = 'income' | 'balance' | 'cashflow';
type Period = 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'TTM';

interface FinancialStatementsWidgetProps {
    symbol?: string;
    isEditing?: boolean;
}

interface FinancialRow {
    label: string;
    values: Array<number | null | undefined>;
    isHeader?: boolean;
    indent?: number;
}

const LABELS: Record<StatementType, { key: string; label: string; isHeader?: boolean; indent?: number }[]> = {
    income: [
        { key: 'revenue', label: 'Revenue', isHeader: true },
        { key: 'gross_profit', label: 'Gross Profit', isHeader: true },
        { key: 'operating_income', label: 'Operating Income', isHeader: true },
        { key: 'net_income', label: 'Net Income', isHeader: true },
        { key: 'ebitda', label: 'EBITDA', isHeader: true },
    ],
    balance: [
        { key: 'total_assets', label: 'Total Assets', isHeader: true },
        { key: 'total_liabilities', label: 'Total Liabilities', isHeader: true },
        { key: 'total_equity', label: 'Total Equity', isHeader: true },
        { key: 'cash_and_equivalents', label: 'Cash & Equivalents', indent: 1 },
    ],
    cashflow: [
        { key: 'operating_cash_flow', label: 'Operating Cash Flow', isHeader: true },
        { key: 'investing_cash_flow', label: 'Investing Cash Flow', isHeader: true },
        { key: 'financing_cash_flow', label: 'Financing Cash Flow', isHeader: true },
        { key: 'free_cash_flow', label: 'Free Cash Flow', isHeader: true },
    ],
};

function formatNumber(num: number | null | undefined) {
    if (num === null || num === undefined) return '-';
    if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toLocaleString();
}

function getYoYChange(current: number | null | undefined, previous: number | null | undefined) {
    if (!current || !previous || previous === 0) return 0;
    return ((current - previous) / Math.abs(previous)) * 100;
}

function periodSortKey(period?: string) {
    if (!period) return 0;
    const upper = String(period).toUpperCase();
    const yearMatch = upper.match(/(20\d{2})/);
    const year = yearMatch ? Number(yearMatch[1]) : 0;
    const quarterMatch = upper.match(/Q([1-4])/);
    const quarter = quarterMatch ? Number(quarterMatch[1]) : 0;
    return year * 10 + quarter;
}

function normalizePeriodLabel(row: any, index: number, total: number, mode: 'year' | 'quarter' | 'ttm') {
    const candidate = row?.period || row?.fiscal_year || row?.fiscalYear || row?.year || '-';
    const label = String(candidate).trim();
    if (!label || label.toLowerCase() === 'unknown' || label.toLowerCase() === 'nan') {
        return '-';
    }

    if (mode === 'year') {
        const yearMatch = label.match(/(20\d{2})/);
        return yearMatch ? yearMatch[1] : label;
    }

    if (mode === 'ttm') {
        const upper = label.toUpperCase();
        return upper.includes('TTM') ? 'TTM' : upper;
    }

    const upper = label.toUpperCase();
    const quarterMatch = upper.match(/Q([1-4])/);
    if (quarterMatch) {
        const yearMatch = upper.match(/(20\d{2})/);
        const year = yearMatch
            ? Number(yearMatch[1])
            : new Date().getFullYear() - Math.floor((Math.max(1, total) - index - 1) / 4);
        return `Q${quarterMatch[1]}-${year}`;
    }

    const numeric = Number(upper);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
        const quarter = ((Math.max(1, numeric) - 1) % 4) + 1;
        const year = new Date().getFullYear() - Math.floor((Math.max(1, total) - Math.max(1, numeric)) / 4);
        return `Q${quarter}-${year}`;
    }

    return upper;
}

export function FinancialStatementsWidget({ symbol = 'VNM' }: FinancialStatementsWidgetProps) {
    const [statementType, setStatementType] = useState<StatementType>('income');
    const [period, setPeriod] = useState<Period>('FY');

    const requestPeriod = period;
    const exportPeriod = period === 'FY' ? 'year' : 'quarter';
    const periodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useFinancials(symbol, { type: statementType, period: requestPeriod, limit: 4 });

    const rawData = data?.data || [];
    const hasData = rawData.length > 0;
    const isFallback = Boolean(error && hasData);

    const displayRows = useMemo(() => {
        const normalizedRows = rawData
            .map((row: any, index: number) => ({
                ...row,
                __period: normalizePeriodLabel(row, index, rawData.length, periodMode),
            }))
            .filter((row: any) => row.__period && row.__period !== '-');

        if (periodMode === 'year') {
            return [...normalizedRows].sort((a: any, b: any) => periodSortKey(b.__period) - periodSortKey(a.__period));
        }

        if (periodMode === 'ttm') {
            return normalizedRows.filter((row: any) => String(row.__period).toUpperCase().includes('TTM'));
        }

        const quarterRows = normalizedRows
            .filter((row: any) => String(row.__period).startsWith('Q'))
            .sort((a: any, b: any) => periodSortKey(b.__period) - periodSortKey(a.__period));

        return quarterRows.filter((row: any) => String(row.__period).startsWith(`${period}-`));
    }, [rawData, periodMode, period, statementType]);

    const recent = useMemo(() => displayRows.slice(0, 4), [displayRows]);
    const periodLabels = useMemo(() => recent.map((row: any) => row.__period), [recent]);

    const rows: FinancialRow[] = useMemo(() => {
        const metrics = LABELS[statementType] || [];
        return metrics.map((metric) => ({
            label: metric.label,
            isHeader: metric.isHeader,
            indent: metric.indent,
            values: recent.map((row: any) => row[metric.key]),
        }));
    }, [recent, statementType]);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view financials" />;
    }

    return (
        <div className="h-full flex flex-col bg-[#0b1221]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e293b]">
                <div className="flex items-center gap-1">
                    {(['income', 'balance', 'cashflow'] as StatementType[]).map((type) => (
                        <button
                            key={type}
                            onClick={() => setStatementType(type)}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${statementType === type
                                ? 'bg-blue-600/20 text-blue-400'
                                : 'text-gray-400 hover:text-white hover:bg-[#1e293b]'}`}
                            type="button"
                        >
                            {type === 'income' ? 'Income' : type === 'balance' ? 'Balance' : 'Cash Flow'}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex items-center gap-1 rounded-md border border-[#334155] bg-[#1e293b] p-0.5">
                        {(['FY', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'] as Period[]).map((opt) => (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => setPeriod(opt)}
                                className={`px-2 py-1 text-[10px] font-black uppercase rounded transition-colors ${
                                    period === opt ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
                                }`}
                            >
                                {opt}
                            </button>
                        ))}
                    </div>
                    <ExportButton
                        onExport={async (format) => {
                            await exportFinancials(symbol, {
                                type: statementType,
                                period: exportPeriod,
                                format,
                            });
                        }}
                    />
                </div>
            </div>

            <div className="px-3 py-2 border-b border-[#1e293b]">
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note={period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : `${period} Quarterly`}
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-auto">
                {isLoading && !hasData ? (
                    <WidgetSkeleton variant="table" lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message={`No ${statementType} data for ${symbol}`} />
                ) : (
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-[#0f172a]">
                            <tr className="text-gray-500">
                                <th className="text-left px-3 py-2 font-medium min-w-[140px]">Item</th>
                                {periodLabels.map((label) => (
                                    <th key={label} className="text-right px-3 py-2 font-medium min-w-[80px]">{label}</th>
                                ))}
                                <th className="text-right px-3 py-2 font-medium min-w-[60px]">YoY %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => {
                                const yoyChange = getYoYChange(row.values[0], row.values[1]);
                                return (
                                    <tr
                                        key={index}
                                        className={`border-b border-[#1e293b]/30 hover:bg-[#1e293b]/20 ${row.isHeader ? 'bg-[#1e293b]/10' : ''}`}
                                    >
                                        <td
                                            className={`px-3 py-2 ${row.isHeader ? 'font-semibold text-white' : 'text-gray-300'}`}
                                            style={{ paddingLeft: row.indent ? `${12 + row.indent * 16}px` : '12px' }}
                                        >
                                            {row.label}
                                        </td>
                                        {row.values.map((val, i) => (
                                            <td
                                                key={i}
                                                className={`text-right px-3 py-2 font-mono ${val && val < 0 ? 'text-red-400' : row.isHeader ? 'text-white' : 'text-gray-300'}`}
                                            >
                                                {formatNumber(val)}
                                            </td>
                                        ))}
                                        <td
                                            className={`text-right px-3 py-2 font-mono ${yoyChange > 0 ? 'text-green-400' : yoyChange < 0 ? 'text-red-400' : 'text-gray-400'}`}
                                        >
                                            {yoyChange > 0 ? '+' : ''}{yoyChange.toFixed(1)}%
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="px-3 py-2 border-t border-[#1e293b] text-[10px] text-gray-500">
                Values in Billions of VND except per-share values. Data for {symbol}.
            </div>
        </div>
    );
}
