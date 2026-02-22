// Income Statement Widget - Revenue, Profit, Margins with Chart View
'use client';

import { useState, useMemo, memo } from 'react';
import { TrendingUp, Table, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIncomeStatement } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Legend,
    CartesianGrid,
} from 'recharts';
import {
    formatAxisValue,
    formatNumber,
    formatUnitValuePlain,
    getUnitCaption,
    getUnitLegend,
    resolveUnitScale,
} from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { formatFinancialPeriodLabel, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';

interface IncomeStatementWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

type ViewMode = 'table' | 'chart';

const labels: Record<string, string> = {
    revenue: 'Revenue',
    cost_of_revenue: 'Cost of Revenue',
    gross_profit: 'Gross Profit',
    selling_general_admin: 'SG&A',
    research_development: 'R&D',
    depreciation: 'Depreciation',
    operating_income: 'Operating Income',
    interest_expense: 'Interest Expense',
    pre_tax_profit: 'Pre-tax Profit',
    profit_before_tax: 'Pre-tax Profit',
    tax_expense: 'Tax Expense',
    other_income: 'Other Income',
    net_income: 'Net Income',
    eps: 'EPS',
    eps_diluted: 'Diluted EPS',
};

const TABLE_YEAR_LIMIT = 10;

function IncomeStatementWidgetComponent({ id, symbol, isEditing, onRemove }: IncomeStatementWidgetProps) {
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'income_statement',
        defaultPeriod: 'FY',
    });
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const { config: unitConfig } = useUnit();
    
    const apiPeriod = period === 'FY' ? 'year' : period;
    const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useIncomeStatement(symbol, { period: apiPeriod });

    const items = data?.data || [];
    const hasData = items.length > 0;
    const isFallback = Boolean(error && hasData);

    const chartData = useMemo(() => {
        if (!items.length) return [];
        const recentItems = [...items].slice(0, 5).reverse();
        return recentItems.map((d, index) => ({
            period: formatFinancialPeriodLabel(d.period, {
                mode: periodMode,
                index,
                total: recentItems.length,
            }),
            revenue: d.revenue || 0,
            grossProfit: d.gross_profit || 0,
            operatingIncome: d.operating_income || 0,
            netIncome: d.net_income || 0,
            grossMargin: d.revenue && d.gross_profit ? (d.gross_profit / d.revenue) * 100 : 0,
            operatingMargin: d.revenue && d.operating_income ? (d.operating_income / d.revenue) * 100 : 0,
            netMargin: d.revenue && d.net_income ? (d.net_income / d.revenue) * 100 : 0,
        }));
    }, [items, periodMode]);

    const tableScale = useMemo(() => {
        const values = items.flatMap((item) => [
            item.revenue,
            item.cost_of_revenue,
            item.gross_profit,
            item.selling_general_admin,
            item.research_development,
            item.depreciation,
            item.operating_income,
            item.interest_expense,
            item.pre_tax_profit,
            item.profit_before_tax,
            item.tax_expense,
            item.other_income,
            item.net_income,
        ]);
        return resolveUnitScale(values, unitConfig);
    }, [items, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);
    const unitNote = useMemo(
        () => `Note: ${unitLegend} except per-share values`,
        [unitLegend]
    );

    const tableColumns = useMemo(
        () =>
            items.slice(0, TABLE_YEAR_LIMIT).map((entry, index) => ({
                key: entry.period ?? `period_${index}`,
                label: formatFinancialPeriodLabel(entry.period, {
                    mode: periodMode,
                    index,
                    total: Math.min(items.length, TABLE_YEAR_LIMIT),
                }),
                align: 'right' as const,
            })),
        [items, periodMode]
    );

    const tableRows = useMemo<DenseTableRow[]>(() => {
        const rowValue = (entry: (typeof items)[number], metricKey: string) => {
            if (metricKey === 'pre_tax_profit') return entry.pre_tax_profit ?? entry.profit_before_tax;
            return entry[metricKey as keyof typeof entry];
        }

        const coreMetrics = [
            'revenue',
            'cost_of_revenue',
            'gross_profit',
            'operating_income',
            'pre_tax_profit',
            'tax_expense',
            'net_income',
        ] as const

        const expenseMetrics = [
            'selling_general_admin',
            'research_development',
            'depreciation',
            'interest_expense',
            'other_income',
        ] as const

        const rows: DenseTableRow[] = [
            {
                id: 'group:profitability',
                label: 'Profitability',
                values: {},
                isGroup: true,
            },
            ...coreMetrics.map((metricKey) => ({
                id: metricKey,
                label: labels[metricKey] || metricKey,
                parentId: 'group:profitability',
                indent: 12,
                values: Object.fromEntries(
                    items.slice(0, TABLE_YEAR_LIMIT).map((entry, index) => [
                        tableColumns[index]?.key ?? `period_${index}`,
                        rowValue(entry, metricKey),
                    ])
                ),
            })),
            {
                id: 'group:expenses',
                label: 'Expenses & Other',
                values: {},
                isGroup: true,
            },
            ...expenseMetrics.map((metricKey) => ({
                id: metricKey,
                label: labels[metricKey] || metricKey,
                parentId: 'group:expenses',
                indent: 12,
                values: Object.fromEntries(
                    items.slice(0, TABLE_YEAR_LIMIT).map((entry, index) => [
                        tableColumns[index]?.key ?? `period_${index}`,
                        rowValue(entry, metricKey),
                    ])
                ),
            })),
            {
                id: 'group:per-share',
                label: 'Per-share',
                values: {},
                isGroup: true,
            },
            {
                id: 'eps',
                label: labels.eps,
                parentId: 'group:per-share',
                indent: 12,
                values: Object.fromEntries(
                    items.slice(0, TABLE_YEAR_LIMIT).map((entry, index) => [
                        tableColumns[index]?.key ?? `period_${index}`,
                        entry.eps,
                    ])
                ),
            },
            {
                id: 'eps_diluted',
                label: labels.eps_diluted,
                parentId: 'group:per-share',
                indent: 12,
                values: Object.fromEntries(
                    items.slice(0, TABLE_YEAR_LIMIT).map((entry, index) => [
                        tableColumns[index]?.key ?? `period_${index}`,
                        entry.eps_diluted,
                    ])
                ),
            },
        ];

        return rows;
    }, [items, tableColumns]);

    const renderTable = () => (
        <div className="space-y-1">
            <DenseFinancialTable
                columns={tableColumns}
                rows={tableRows}
                sortable
                storageKey={`income:${id}:${symbol}:${period}`}
                valueFormatter={(value, row) => {
                    if (row.id === 'eps') {
                        return formatNumber(value as number | null | undefined, { decimals: 2 });
                    }
                    return formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig);
                }}
            />
            <div className="px-1 pt-1 text-[10px] text-[var(--text-muted)] italic">{unitNote}</div>
        </div>
    );

    const [chartType, setChartType] = useState<'overview' | 'margins'>('overview');

    const renderChart = () => {
        if (!chartData.length) {
            return (
                <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)] gap-2">
                    <BarChart3 size={32} className="opacity-20" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">No visualization available</p>
                </div>
            );
        }

        return (
                <div className="h-full flex flex-col gap-1">
                <div className="flex justify-end px-1 pt-0.5">
                    <select
                        value={chartType}
                        onChange={(e) => setChartType(e.target.value as any)}
                        className="bg-[var(--bg-secondary)] text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-color)] rounded px-2 py-1 focus:outline-none focus:border-blue-500 uppercase tracking-tighter cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    >
                        <option value="overview">Revenue & Profit</option>
                        <option value="margins">Margins %</option>
                    </select>
                </div>

                <div className="flex-1 min-h-[132px]">
                    <ChartMountGuard className="h-full" minHeight={120}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={120}>
                            {chartType === 'overview' ? (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis
                                        tickFormatter={(value) => formatAxisValue(value, unitConfig)}
                                        tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                                        axisLine={false}
                                        tickLine={false}
                                        label={{ value: getUnitCaption(unitConfig), angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 9 }}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--bg-tooltip)',
                                            border: '1px solid var(--border-default)',
                                            borderRadius: '8px',
                                            fontSize: '11px',
                                        }}
                                        itemStyle={{ padding: '0px' }}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                                    <Line type="monotone" dataKey="netIncome" name="Net Income" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                                </ComposedChart>
                            ) : (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis
                                        tickFormatter={(val) => `${val}%`}
                                        tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                                        axisLine={false}
                                        tickLine={false}
                                        label={{ value: '%', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 9 }}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--bg-tooltip)',
                                            border: '1px solid var(--border-default)',
                                            borderRadius: '8px',
                                            fontSize: '11px',
                                        }}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    <Line type="monotone" dataKey="grossMargin" name="Gross %" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                                    <Line type="monotone" dataKey="netMargin" name="Net %" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                                </ComposedChart>
                            )}
                        </ResponsiveContainer>
                    </ChartMountGuard>
                </div>
            </div>
        );
    };

    const headerActions = (
        <div className="flex items-center gap-1.5 mr-1">
            <div className="flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-color)]">
                <button
                    onClick={() => setViewMode('table')}
                    className={cn(
                        "p-1 rounded transition-all",
                        viewMode === 'table'
                            ? "bg-[var(--bg-tertiary)] text-blue-400 shadow-sm"
                            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    )}
                    title="Table View"
                >
                    <Table size={12} />
                </button>
                <button
                    onClick={() => setViewMode('chart')}
                    className={cn(
                        "p-1 rounded transition-all",
                        viewMode === 'chart'
                            ? "bg-[var(--bg-tertiary)] text-blue-400 shadow-sm"
                            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    )}
                    title="Chart View"
                >
                    <BarChart3 size={12} />
                </button>
            </div>
            <PeriodToggle value={period} onChange={setPeriod} compact />
        </div>
    );

    return (
        <WidgetContainer
            title="Income Statement"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            headerActions={headerActions}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={items}
        >
            <div className="h-full flex flex-col px-2 py-1.5">
                <div className="pb-1 border-b border-[var(--border-subtle)]">
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={`${period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : period}`}
                        sourceLabel="Income statement"
                        align="right"
                    />
                </div>
                <div className="flex-1 overflow-auto scrollbar-hide pt-1">
                    {isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty
                            message={`No income statement data for ${symbol} (${period === 'FY' ? 'Annual' : period}).`}
                            icon={<TrendingUp size={18} />}
                            action={{ label: 'Retry', onClick: () => refetch() }}
                        />
                    ) : viewMode === 'table' ? (
                        renderTable()
                    ) : (
                        renderChart()
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const IncomeStatementWidget = memo(IncomeStatementWidgetComponent);
export default IncomeStatementWidget;
