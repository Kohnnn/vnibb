// Balance Sheet Widget - Assets, Liabilities, Equity with Chart View
'use client';

import { useState, useMemo, memo } from 'react';
import { Scale, Table, BarChart3 } from 'lucide-react';
import { useBalanceSheet } from '@/lib/queries';
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
import { formatAxisValue, formatUnitValuePlain, getUnitCaption, getUnitLegend, resolveUnitScale } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { cn } from '@/lib/utils';
import { formatFinancialPeriodLabel, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';

interface BalanceSheetWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

type ViewMode = 'table' | 'chart';

const labels: Record<string, string> = {
    total_assets: 'Total Assets',
    current_assets: 'Current Assets',
    fixed_assets: 'Fixed Assets',
    accounts_receivable: 'Accounts Receivable',
    total_liabilities: 'Total Liabilities',
    current_liabilities: 'Current Liab.',
    long_term_liabilities: 'Long-term Liab.',
    short_term_debt: 'Short-term Debt',
    long_term_debt: 'Long-term Debt',
    accounts_payable: 'Accounts Payable',
    equity: 'Equity',
    total_equity: 'Total Equity',
    retained_earnings: 'Retained Earnings',
    cash: 'Cash',
    inventory: 'Inventory',
};

const TABLE_YEAR_LIMIT = 10;

function BalanceSheetWidgetComponent({ id, symbol, isEditing, onRemove }: BalanceSheetWidgetProps) {
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'balance_sheet',
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
    } = useBalanceSheet(symbol, { period: apiPeriod });

    const items = data?.data || [];
    const hasData = items.length > 0;
    const isFallback = Boolean(error && hasData);

    const chartData = useMemo(() => {
        if (!items.length) return [];
        const recentItems = [...items].slice(0, 5).reverse();
        return recentItems.map((d, index) => {
            const equityValue = d.total_equity ?? d.equity ?? 0
            const liabilities = d.total_liabilities ?? 0
            return {
                equityValue,
                period: formatFinancialPeriodLabel(d.period, {
                    mode: periodMode,
                    index,
                    total: recentItems.length,
                }),
                totalAssets: d.total_assets || 0,
                totalLiabilities: liabilities,
                equity: equityValue,
                cash: d.cash || 0,
                debtToEquity: liabilities > 0 && equityValue !== 0 ? liabilities / equityValue : 0,
            }
        });
    }, [items, periodMode]);

    const tableScale = useMemo(() => {
        const values = items.flatMap((item) => [
            item.total_assets,
            item.current_assets,
            item.fixed_assets,
            item.accounts_receivable,
            item.total_liabilities,
            item.current_liabilities,
            item.long_term_liabilities,
            item.short_term_debt,
            item.long_term_debt,
            item.accounts_payable,
            item.total_equity,
            item.equity,
            item.retained_earnings,
            item.cash,
            item.inventory,
        ]);
        return resolveUnitScale(values, unitConfig);
    }, [items, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);
    const unitNote = useMemo(() => `Note: ${unitLegend}`, [unitLegend]);

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
        const valueFor = (entry: (typeof items)[number], metricKey: string) => {
            if (metricKey === 'total_equity') return entry.total_equity ?? entry.equity
            if (metricKey === 'accounts_receivable') return entry.accounts_receivable ?? entry.receivables
            return entry[metricKey as keyof typeof entry]
        }

        const mapValues = (metricKey: string) =>
            Object.fromEntries(
                items.slice(0, TABLE_YEAR_LIMIT).map((entry, index) => [
                    tableColumns[index]?.key ?? `period_${index}`,
                    valueFor(entry, metricKey),
                ])
            );

        return [
            { id: 'group:assets', label: 'Assets', values: {}, isGroup: true },
            {
                id: 'total_assets',
                label: labels.total_assets,
                parentId: 'group:assets',
                indent: 12,
                values: mapValues('total_assets'),
            },
            {
                id: 'current_assets',
                label: labels.current_assets,
                parentId: 'group:assets',
                indent: 12,
                values: mapValues('current_assets'),
            },
            {
                id: 'fixed_assets',
                label: labels.fixed_assets,
                parentId: 'group:assets',
                indent: 12,
                values: mapValues('fixed_assets'),
            },
            {
                id: 'cash',
                label: labels.cash,
                parentId: 'group:assets',
                indent: 12,
                values: mapValues('cash'),
            },
            {
                id: 'inventory',
                label: labels.inventory,
                parentId: 'group:assets',
                indent: 12,
                values: mapValues('inventory'),
            },
            {
                id: 'accounts_receivable',
                label: labels.accounts_receivable,
                parentId: 'group:assets',
                indent: 12,
                values: mapValues('accounts_receivable'),
            },
            { id: 'group:liabilities', label: 'Liabilities', values: {}, isGroup: true },
            {
                id: 'total_liabilities',
                label: labels.total_liabilities,
                parentId: 'group:liabilities',
                indent: 12,
                values: mapValues('total_liabilities'),
            },
            {
                id: 'current_liabilities',
                label: labels.current_liabilities,
                parentId: 'group:liabilities',
                indent: 12,
                values: mapValues('current_liabilities'),
            },
            {
                id: 'long_term_liabilities',
                label: labels.long_term_liabilities,
                parentId: 'group:liabilities',
                indent: 12,
                values: mapValues('long_term_liabilities'),
            },
            {
                id: 'short_term_debt',
                label: labels.short_term_debt,
                parentId: 'group:liabilities',
                indent: 12,
                values: mapValues('short_term_debt'),
            },
            {
                id: 'long_term_debt',
                label: labels.long_term_debt,
                parentId: 'group:liabilities',
                indent: 12,
                values: mapValues('long_term_debt'),
            },
            {
                id: 'accounts_payable',
                label: labels.accounts_payable,
                parentId: 'group:liabilities',
                indent: 12,
                values: mapValues('accounts_payable'),
            },
            { id: 'group:equity', label: 'Equity', values: {}, isGroup: true },
            {
                id: 'total_equity',
                label: labels.total_equity,
                parentId: 'group:equity',
                indent: 12,
                values: mapValues('total_equity'),
            },
            {
                id: 'retained_earnings',
                label: labels.retained_earnings,
                parentId: 'group:equity',
                indent: 12,
                values: mapValues('retained_earnings'),
            },
        ];
    }, [items, tableColumns]);

    const renderTable = () => (
        <div className="space-y-1">
            <DenseFinancialTable
                columns={tableColumns}
                rows={tableRows}
                sortable
                storageKey={`balance:${id}:${symbol}:${period}`}
                valueFormatter={(value) =>
                    formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig)
                }
            />
            <div className="px-1 pt-1 text-[10px] text-[var(--text-muted)] italic">{unitNote}</div>
        </div>
    );

    const [chartType, setChartType] = useState<'overview' | 'debt'>('overview');

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
                        <option value="overview">Assets & Liab.</option>
                        <option value="debt">Debt Structure</option>
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
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    <Bar dataKey="totalAssets" name="Assets" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                                    <Bar dataKey="totalLiabilities" name="Liabilities" fill="#ef4444" radius={[2, 2, 0, 0]} />
                                    <Line type="monotone" dataKey="equity" name="Equity" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                                </ComposedChart>
                            ) : (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis
                                        yAxisId="left"
                                        tickFormatter={(value) => formatAxisValue(value, unitConfig)}
                                        tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                                        axisLine={false}
                                        tickLine={false}
                                        label={{ value: getUnitCaption(unitConfig), angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 9 }}
                                    />
                                    <YAxis
                                        yAxisId="right"
                                        orientation="right"
                                        tickFormatter={(v) => v.toFixed(1) + 'x'}
                                        tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
                                        axisLine={false}
                                        tickLine={false}
                                        label={{ value: 'x', angle: 90, position: 'insideRight', fill: 'var(--text-muted)', fontSize: 9 }}
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
                                    <Bar yAxisId="left" dataKey="totalLiabilities" name="Total Debt" fill="#ef4444" radius={[2, 2, 0, 0]} />
                                    <Line yAxisId="right" type="monotone" dataKey="debtToEquity" name="D/E Ratio" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
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
            title="Balance Sheet"
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
                        sourceLabel="Balance sheet"
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
                            message={`No balance sheet data for ${symbol}. Try switching period or refresh.`}
                            icon={<Scale size={18} />}
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

export const BalanceSheetWidget = memo(BalanceSheetWidgetComponent);
export default BalanceSheetWidget;
