'use client';

import { useState, useMemo, memo } from 'react';
import { useIncomeStatement, useBalanceSheet, useCashFlow, useFinancialRatios } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { DenseFinancialTable, type DenseTableColumn, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import {
    TrendingUp, TrendingDown, Info,
    ArrowUpRight, BarChart3, LayoutGrid
} from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { Sparkline } from '@/components/ui/Sparkline';
import { useUnit } from '@/contexts/UnitContext';
import {
    formatNumber,
    formatPercent,
    formatUnitValuePlain,
    getUnitLegend,
    resolveUnitScale,
} from '@/lib/units';

type FinancialTab = 'balance_sheet' | 'income_statement' | 'cash_flow' | 'ratios';

interface FinancialsWidgetProps {
    id: string;
    symbol: string;
    hideHeader?: boolean;
    onRemove?: () => void;
}

const STATEMENT_METRIC_KEYS: Record<'income_statement' | 'balance_sheet' | 'cash_flow', string[]> = {
    income_statement: ['revenue', 'gross_profit', 'operating_income', 'net_income', 'ebitda'],
    balance_sheet: ['total_assets', 'total_liabilities', 'total_equity', 'cash_and_equivalents'],
    cash_flow: ['operating_cash_flow', 'investing_cash_flow', 'financing_cash_flow', 'free_cash_flow'],
};

const STATEMENT_LABELS: Record<'income_statement' | 'balance_sheet' | 'cash_flow', string[]> = {
    income_statement: ['Revenue', 'Gross Profit', 'Operating Inc.', 'Net Income', 'EBITDA'],
    balance_sheet: ['Total Assets', 'Total Liab.', 'Total Equity', 'Cash & Eq.'],
    cash_flow: ['Operating CF', 'Investing CF', 'Financing CF', 'Free CF'],
};

const RATIO_METRIC_KEYS = ['pe', 'pb', 'roe', 'roa', 'eps', 'debt_equity', 'gross_margin', 'net_margin'];

function FinancialsWidgetComponent({ id, symbol, hideHeader, onRemove }: FinancialsWidgetProps) {
    const [activeTab, setActiveTab] = useState<FinancialTab>('income_statement');
    const [period, setPeriod] = useState('FY');
    const { config: unitConfig } = useUnit();

    const tabs = [
        { id: 'income_statement', label: 'Income Statement', icon: ArrowUpRight },
        { id: 'balance_sheet', label: 'Balance Sheet', icon: LayoutGrid },
        { id: 'cash_flow', label: 'Cash Flow Statement', icon: BarChart3 },
        { id: 'ratios', label: 'Ratios', icon: Info },
    ];

    const requestPeriod = period;
    const periodMode = period === 'TTM' && activeTab === 'ratios'
        ? 'quarter'
        : period === 'FY'
            ? 'year'
            : period === 'TTM'
                ? 'ttm'
                : 'quarter';
    const periodLabel = period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : `${period} Quarterly`;

    const incomeQuery = useIncomeStatement(symbol, { period: requestPeriod, enabled: activeTab === 'income_statement' });
    const balanceQuery = useBalanceSheet(symbol, { period: requestPeriod, enabled: activeTab === 'balance_sheet' });
    const cashFlowQuery = useCashFlow(symbol, { period: requestPeriod, enabled: activeTab === 'cash_flow' });
    const ratiosQuery = useFinancialRatios(symbol, { period: requestPeriod, enabled: activeTab === 'ratios' });

    const activeQuery = useMemo(() => {
        switch (activeTab) {
            case 'income_statement': return incomeQuery;
            case 'balance_sheet': return balanceQuery;
            case 'cash_flow': return cashFlowQuery;
            case 'ratios': return ratiosQuery;
        }
    }, [activeTab, incomeQuery, balanceQuery, cashFlowQuery, ratiosQuery]);

    const tableData = useMemo(() => {
        if (!activeQuery?.data) return null;
        const rawData = activeQuery.data.data || [];

        const selectedMetricKeys = activeTab === 'ratios'
            ? RATIO_METRIC_KEYS
            : STATEMENT_METRIC_KEYS[activeTab as 'income_statement' | 'balance_sheet' | 'cash_flow'];

        // Sort chronological for growth calculation
        const sortedData = [...rawData].sort((a: any, b: any) => {
            return periodSortKey(a?.period) - periodSortKey(b?.period);
        });

        const resolvePeriod = (row: any, index: number, total: number) => {
            const candidate =
                row?.period ??
                row?.fiscal_year ??
                row?.fiscalYear ??
                row?.year ??
                row?.yearReport;
            if (!candidate) return null;
            const label = String(candidate).trim();
            if (!label || label.toLowerCase() === 'unknown' || label.toLowerCase() === 'nan') {
                return null;
            }

            if (periodMode === 'year') {
                const yearMatch = label.match(/(20\d{2})/);
                return yearMatch ? yearMatch[1] : label;
            }

            if (periodMode === 'ttm') {
                const upper = label.toUpperCase();
                if (upper.includes('TTM')) return 'TTM';
                return upper;
            }

            const upper = label.toUpperCase();
            const quarterMatch = upper.match(/Q([1-4])/);
            if (quarterMatch) {
                const yearMatch = upper.match(/(20\d{2})/);
                const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear() - Math.floor((total - index - 1) / 4));
                return `Q${quarterMatch[1]}-${year}`;
            }

            const numeric = Number(upper);
            if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
                const quarter = ((Math.max(1, numeric) - 1) % 4) + 1;
                const year = new Date().getFullYear() - Math.floor((Math.max(1, total) - Math.max(1, numeric)) / 4);
                return `Q${quarter}-${year}`;
            }

            return upper;
        };

        const normalizedRows = rawData
            .map((row: any, index: number) => ({ ...row, __period: resolvePeriod(row, index, rawData.length) }))
            .filter((row: any) => Boolean(row.__period));

        let displayRows = normalizedRows;
        if (periodMode === 'quarter') {
            const quarterRows = normalizedRows
                .filter((row: any) => String(row.__period).startsWith('Q'))
                .sort((a: any, b: any) => periodSortKey(a.__period) - periodSortKey(b.__period));

            if (period === 'TTM') {
                if (activeTab === 'ratios') {
                    displayRows = quarterRows.slice(-4);
                } else {
                    const ttmRows: any[] = [];
                    for (let i = 3; i < quarterRows.length; i += 1) {
                        const windowRows = quarterRows.slice(i - 3, i + 1);
                        const aggregated: any = { __period: `TTM-${quarterRows[i].__period}` };
                        selectedMetricKeys.forEach((key) => {
                            const values = windowRows
                                .map((row: any) => Number(row[key]))
                                .filter((value: number) => !Number.isNaN(value) && Number.isFinite(value));
                            aggregated[key] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
                        });
                        ttmRows.push(aggregated);
                    }
                    displayRows = ttmRows;
                }
            } else if (period !== 'FY') {
                displayRows = quarterRows.filter((row: any) => String(row.__period).startsWith(`${period}-`));
            }
        } else if (periodMode === 'ttm') {
            displayRows = normalizedRows.filter((row: any) => String(row.__period).toUpperCase().includes('TTM'));
        }

        const columns = Array.from(
            new Set(displayRows.map((row: any) => row.__period).filter((p: any): p is string => Boolean(p)))
        ).sort((a: string, b: string) => periodSortKey(a) - periodSortKey(b));

        let metrics: any[] = [];
        if (activeTab === 'ratios') {
            metrics = [
                { key: 'pe', label: 'P/E' },
                { key: 'pb', label: 'P/B' },
                { key: 'roe', label: 'ROE', isPct: true },
                { key: 'roa', label: 'ROA', isPct: true },
                { key: 'gross_margin', label: 'Gross Margin', isPct: true },
                { key: 'net_margin', label: 'Net Margin', isPct: true },
                { key: 'debt_equity', label: 'D/E' },
                { key: 'current_ratio', label: 'Current Ratio' },
            ];
        } else {
            const keys = STATEMENT_METRIC_KEYS[activeTab as 'income_statement' | 'balance_sheet' | 'cash_flow'];
            const labels = STATEMENT_LABELS[activeTab as 'income_statement' | 'balance_sheet' | 'cash_flow'];

            metrics = keys.map((key, i) => ({ key, label: labels[i] }));
        }

        return {
            periods: columns,
            rows: metrics.map(m => {
                const values: Record<string, any> = {};
                    displayRows.forEach((d: any) => {
                        const periodLabel = d.__period;
                        if (!periodLabel) {
                            return;
                        }
                        const currentVal = d[m.key];
                        // Find previous period for growth
                        const prevIndex = sortedData.findIndex((sd: any, idx: number) => {
                            return resolvePeriod(sd, idx, sortedData.length) === periodLabel;
                        }) - 1;
                        const prevVal = prevIndex >= 0 ? (sortedData[prevIndex] as any)[m.key] : null;

                    let growth = null;
                    if (prevVal && prevVal !== 0 && currentVal !== null) {
                        growth = ((currentVal - prevVal) / Math.abs(prevVal)) * 100;
                    }

                    values[periodLabel] = { val: currentVal, growth };
                });
                return { label: m.label, isPct: m.isPct, values };
            })
        };
    }, [activeQuery?.data, activeTab, periodMode, period]);

    const hasData = Boolean(tableData && tableData.periods.length > 0);
    const isFallback = Boolean(activeQuery?.error && hasData);
    const populatedCells = useMemo(() => {
        if (!tableData) return 0
        return tableData.rows.reduce((acc, row) => {
            const rowCount = tableData.periods.filter((period) => {
                const value = row.values[period]?.val
                return value !== null && value !== undefined && Number.isFinite(Number(value))
            }).length
            return acc + rowCount
        }, 0)
    }, [tableData])
    const isSparseData = hasData && populatedCells > 0 && populatedCells < 8

    const sourceLabel =
        activeTab === 'ratios'
            ? 'Ratios dataset'
            : activeTab === 'income_statement'
                ? 'Income statement'
                : activeTab === 'balance_sheet'
                    ? 'Balance sheet'
                    : 'Cash flow statement'

    const tableScale = useMemo(() => {
        if (!tableData || activeTab === 'ratios') return resolveUnitScale([], unitConfig);
        const values = tableData.rows.flatMap((row) =>
            tableData.periods.map((period) => row.values[period]?.val)
        );
        return resolveUnitScale(values, unitConfig);
    }, [tableData, activeTab, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);
    const denseColumns = useMemo<DenseTableColumn[]>(() => {
        if (!tableData) return []
        return tableData.periods.map((periodLabel) => ({
            key: periodLabel,
            label: periodLabel,
            align: 'right',
        }))
    }, [tableData])

    const denseRows = useMemo<DenseTableRow[]>(() => {
        if (!tableData) return []
        return tableData.rows.map((row, index) => ({
            id: `${activeTab}-${index}`,
            label: row.label,
            values: tableData.periods.reduce<Record<string, number | null>>((acc, periodLabel) => {
                acc[periodLabel] = row.values[periodLabel]?.val ?? null
                return acc
            }, {}),
        }))
    }, [activeTab, tableData])

    const denseRowMeta = useMemo(() => {
        if (!tableData) return new Map<string, { isPct?: boolean }>()
        return new Map(
            tableData.rows.map((row, index) => [`${activeTab}-${index}`, { isPct: row.isPct }])
        )
    }, [activeTab, tableData])

    return (
        <WidgetContainer
            title="Financials"
            symbol={symbol}
            onRefresh={() => activeQuery.refetch()}
            onClose={onRemove}
            isLoading={activeQuery.isLoading && !hasData}
            noPadding
            widgetId={id}
            hideHeader={hideHeader}
            exportData={activeQuery.data?.data || []}
            exportFilename={`financials_${symbol}_${activeTab}_${period}`}
        >
            <div className="h-full flex flex-col bg-secondary text-primary font-sans select-none overflow-hidden">
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/70 px-2 py-1 shrink-0">
                    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as FinancialTab)}
                                    className={cn(
                                         "flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold uppercase tracking-tight rounded-md transition-all whitespace-nowrap",
                                        activeTab === tab.id
                                            ? "bg-blue-600/10 text-blue-400"
                                            : "text-muted-foreground hover:text-primary hover:bg-[var(--bg-tertiary)]"
                                    )}
                                >
                                    <Icon size={12} />
                                    <span className="hidden sm:inline">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                        <div className="flex bg-muted/30 rounded p-0.5 gap-0.5">
                            {['FY', 'Q1', 'Q2', 'Q3', 'Q4', 'TTM'].map((opt) => (
                                <button
                                    key={opt}
                                    onClick={() => setPeriod(opt)}
                                    className={cn(
                                        "px-1.5 py-0.5 text-[9px] font-black rounded transition-colors",
                                        period === opt ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-primary"
                                    )}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                        <WidgetMeta
                            updatedAt={activeQuery.dataUpdatedAt}
                            isFetching={activeQuery.isFetching && hasData}
                            isCached={isFallback}
                            note={periodLabel}
                            sourceLabel={sourceLabel}
                            align="right"
                            className="ml-2"
                        />
                    </div>
                </div>

                {/* Table Area with Horizontal Scroll */}
                <div className="flex-1 overflow-auto p-0.5 scrollbar-thin scrollbar-thumb-[var(--border-color)]">
                    {activeQuery.isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : activeQuery.error && !hasData ? (
                        <WidgetError error={activeQuery.error as Error} onRetry={() => activeQuery.refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty
                            message={`No ${tabs.find((tab) => tab.id === activeTab)?.label?.toLowerCase() || 'financial'} data for ${symbol} (${periodLabel}).`}
                            action={{ label: 'Refresh data', onClick: () => activeQuery.refetch() }}
                        />
                    ) : (
                        <div className="min-w-max">
                            {isSparseData && (
                                <div className="px-2 pb-1 text-[10px] text-amber-400">
                                    Partial dataset: some provider fields are still missing for this symbol.
                                </div>
                            )}
                            <DenseFinancialTable
                                columns={denseColumns}
                                rows={denseRows}
                                maxYears={denseColumns.length || 1}
                                storageKey={`financials:${symbol}:${activeTab}:${period}`}
                                footerNote={activeTab !== 'ratios' ? `Note: ${unitLegend} except Per Share Values • Reporting Standard: VAS` : undefined}
                                valueFormatter={(value, row) => {
                                    const meta = denseRowMeta.get(row.id)
                                    const numericValue = typeof value === 'number' ? value : Number(value)
                                    if (meta?.isPct) {
                                        return formatPct(Number.isFinite(numericValue) ? numericValue : null)
                                    }
                                    if (activeTab === 'ratios') {
                                        return formatRatio(Number.isFinite(numericValue) ? numericValue : null)
                                    }
                                    return formatUnitValuePlain(Number.isFinite(numericValue) ? numericValue : null, tableScale, unitConfig)
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

function formatRatio(value: number | null | undefined): string {
    return formatNumber(value, { decimals: 2 });
}

function formatPct(value: number | null | undefined): string {
    return formatPercent(value, { decimals: 2, input: 'percent' });
}

function periodSortKey(period?: string): number {
    if (!period) return 0;
    const upper = period.toUpperCase();
    const yearMatch = upper.match(/(20\d{2})/);
    const year = yearMatch ? Number(yearMatch[1]) : 0;
    const quarterMatch = upper.match(/Q([1-4])/);
    const quarter = quarterMatch ? Number(quarterMatch[1]) : 0;
    return year * 10 + quarter;
}

export const FinancialsWidget = memo(FinancialsWidgetComponent);
export default FinancialsWidget;
