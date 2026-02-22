// Cash Flow Widget - Operating, Investing, Financing with Chart View
'use client';

import { useState, useMemo, memo } from 'react';
import { Banknote, Table, BarChart3 } from 'lucide-react';
import { useCashFlow } from '@/lib/queries';
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
    Area,
    ResponsiveContainer,
    Legend,
    CartesianGrid,
    ReferenceLine,
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

interface CashFlowWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

type ViewMode = 'table' | 'chart';

const labels: Record<string, string> = {
    operating_cash_flow: 'Operating CF',
    investing_cash_flow: 'Investing CF',
    financing_cash_flow: 'Financing CF',
    net_cash_flow: 'Net Cash Flow',
    net_change_in_cash: 'Net Change in Cash',
    free_cash_flow: 'Free Cash Flow',
    capex: 'CapEx',
    capital_expenditure: 'CapEx',
    dividends_paid: 'Dividends Paid',
    debt_repayment: 'Debt Repayment',
    stock_repurchased: 'Stock Repurchased',
};

const TABLE_YEAR_LIMIT = 10;

function CashFlowWidgetComponent({ id, symbol, isEditing, onRemove }: CashFlowWidgetProps) {
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'cash_flow',
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
    } = useCashFlow(symbol, { period: apiPeriod });

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
            operatingCF: d.operating_cash_flow || 0,
            investingCF: d.investing_cash_flow || 0,
            financingCF: d.financing_cash_flow || 0,
            freeCashFlow: d.free_cash_flow || 0,
            netCashFlow: d.net_change_in_cash ?? d.net_cash_flow ?? 0,
        }));
    }, [items, periodMode]);

    const tableScale = useMemo(() => {
        const values = items.flatMap((item) => [
            item.operating_cash_flow,
            item.investing_cash_flow,
            item.financing_cash_flow,
            item.free_cash_flow,
            item.net_change_in_cash,
            item.net_cash_flow,
            item.capex,
            item.capital_expenditure,
            item.dividends_paid,
            item.debt_repayment,
            item.stock_repurchased,
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
            if (metricKey === 'net_change_in_cash') return entry.net_change_in_cash ?? entry.net_cash_flow
            if (metricKey === 'capex') return entry.capex ?? entry.capital_expenditure
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
            { id: 'group:cash-flows', label: 'Cash flows', values: {}, isGroup: true },
            {
                id: 'operating_cash_flow',
                label: labels.operating_cash_flow,
                parentId: 'group:cash-flows',
                indent: 12,
                values: mapValues('operating_cash_flow'),
            },
            {
                id: 'investing_cash_flow',
                label: labels.investing_cash_flow,
                parentId: 'group:cash-flows',
                indent: 12,
                values: mapValues('investing_cash_flow'),
            },
            {
                id: 'financing_cash_flow',
                label: labels.financing_cash_flow,
                parentId: 'group:cash-flows',
                indent: 12,
                values: mapValues('financing_cash_flow'),
            },
            { id: 'group:summary', label: 'Summary', values: {}, isGroup: true },
            {
                id: 'free_cash_flow',
                label: labels.free_cash_flow,
                parentId: 'group:summary',
                indent: 12,
                values: mapValues('free_cash_flow'),
            },
            {
                id: 'net_change_in_cash',
                label: labels.net_change_in_cash,
                parentId: 'group:summary',
                indent: 12,
                values: mapValues('net_change_in_cash'),
            },
            {
                id: 'capex',
                label: labels.capital_expenditure,
                parentId: 'group:summary',
                indent: 12,
                values: mapValues('capex'),
            },
            {
                id: 'dividends_paid',
                label: labels.dividends_paid,
                parentId: 'group:summary',
                indent: 12,
                values: mapValues('dividends_paid'),
            },
            {
                id: 'debt_repayment',
                label: labels.debt_repayment,
                parentId: 'group:summary',
                indent: 12,
                values: mapValues('debt_repayment'),
            },
        ];
    }, [items, tableColumns]);

    const renderTable = () => (
        <div className="space-y-1">
            <DenseFinancialTable
                columns={tableColumns}
                rows={tableRows}
                sortable
                storageKey={`cash-flow:${id}:${symbol}:${period}`}
                valueFormatter={(value) =>
                    formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig)
                }
            />
            <div className="px-1 pt-1 text-[10px] text-[var(--text-muted)] italic">{unitNote}</div>
        </div>
    );

    const [chartType, setChartType] = useState<'overview' | 'fcf'>('overview');

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
                        aria-label="Cash flow chart mode"
                        value={chartType}
                        onChange={(e) => setChartType(e.target.value as any)}
                        className="bg-[var(--bg-secondary)] text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-color)] rounded px-2 py-1 focus:outline-none focus:border-blue-500 uppercase tracking-tighter cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    >
                        <option value="overview">Cash Flows</option>
                        <option value="fcf">Free Cash Flow</option>
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
                                    <ReferenceLine y={0} stroke="#333" />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--bg-tooltip)',
                                            border: '1px solid var(--border-default)',
                                            borderRadius: '8px',
                                            fontSize: '11px',
                                        }}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    <Bar dataKey="operatingCF" name="Operating" fill="#3b82f6" radius={[2, 2, 2, 2]} />
                                    <Bar dataKey="investingCF" name="Investing" fill="#f59e0b" radius={[2, 2, 2, 2]} />
                                    <Bar dataKey="financingCF" name="Financing" fill="#ef4444" radius={[2, 2, 2, 2]} />
                                </ComposedChart>
                            ) : (
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
                                    <ReferenceLine y={0} stroke="#333" />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--bg-tooltip)',
                                            border: '1px solid var(--border-default)',
                                            borderRadius: '8px',
                                            fontSize: '11px',
                                        }}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    <Area type="monotone" dataKey="freeCashFlow" name="Free Cash Flow" fill="#10b981" stroke="#10b981" fillOpacity={0.1} />
                                    <Line type="monotone" dataKey="netCashFlow" name="Net Cash Change" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
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
            title="Cash Flow Statement"
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
                        note={period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : period}
                        sourceLabel="Cash flow"
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
                            message={`No cash flow data for ${symbol}. Try switching period or refresh.`}
                            icon={<Banknote size={18} />}
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

export const CashFlowWidget = memo(CashFlowWidgetComponent);
export default CashFlowWidget;
