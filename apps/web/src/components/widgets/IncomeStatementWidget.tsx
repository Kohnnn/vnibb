// Income Statement Widget - Revenue, Profit, Margins with Chart View
'use client';

import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { TrendingUp, Table, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIncomeStatement } from '@/lib/queries';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
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
    convertFinancialValueForUnit,
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
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { formatFinancialPeriodLabel, isCanonicalQuarterPeriod, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import { buildIncomeSankeyModel } from '@/lib/financialVisualizations';
import { IncomeSankeyChart } from '@/components/widgets/charts/IncomeSankeyChart';
import { buildTableInsightContext, describeSelection, seriesFromSelection, toggleSelection, type ChartableColumn, type TableSelection } from '@/lib/tableInsight';

interface IncomeStatementWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: unknown) => void;
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

const TABLE_YEAR_LIMIT = 20;
const QUARTER_PERIOD_LIMIT = 40;

/**
 * Table metric ids are snake_case while the chart series are camelCase, so a
 * row selection must be translated before it reaches the shared contract.
 * Metrics absent here are not chartable and a selection of one charts nothing.
 */
const CHARTED_SERIES_BY_METRIC: Record<string, string> = {
    revenue: 'revenue',
    gross_profit: 'grossProfit',
    operating_income: 'operatingIncome',
    net_income: 'netIncome',
};
const STATEMENT_PERIOD_OPTIONS = ['FY', 'Q', 'TTM'] as const;

function IncomeStatementWidgetComponent({ id, symbol, config, isEditing, onRemove, onDataChange }: IncomeStatementWidgetProps) {
    const periodSyncGroup = typeof config?.periodSyncGroup === 'string' ? config.periodSyncGroup : undefined;
    const defaultPeriod =
        config?.defaultPeriod === 'Q' || config?.defaultPeriod === 'TTM'
            ? (config.defaultPeriod as 'Q' | 'TTM')
            : 'FY';

    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'income_statement',
        defaultPeriod,
        validPeriods: [...STATEMENT_PERIOD_OPTIONS],
        sharedKey: periodSyncGroup ? `${periodSyncGroup}:${symbol.toUpperCase()}` : undefined,
    });
    const showPeriodToggle = config?.hidePeriodToggle !== true;
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    // Table selection is deliberately local component state: it is a transient
    // reading aid, not persisted widget config. Persisted config keys
    // (periodSyncGroup / defaultPeriod / hidePeriodToggle) and the period
    // behaviour are untouched by selection.
    const [selection, setSelection] = useState<TableSelection | null>(null);
    const { config: unitConfig } = useUnit();
    
    const apiPeriod = period === 'FY' ? 'year' : period === 'Q' ? 'quarter' : period;
    const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';
    const visiblePeriodLimit = period === 'Q' ? QUARTER_PERIOD_LIMIT : TABLE_YEAR_LIMIT;

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useIncomeStatement(symbol, { period: apiPeriod, limit: visiblePeriodLimit });

    const items = data?.data || [];
    const orderedItems = useMemo(
        () => [...items].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [items]
    );
    const displayItems = useMemo(
        () => periodMode === 'quarter'
            ? orderedItems.filter((item) => isCanonicalQuarterPeriod(item.period))
            : orderedItems,
        [orderedItems, periodMode]
    );
    const hasData = displayItems.length > 0;
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);

    const chartData = useMemo(() => {
        if (!displayItems.length) return [];
        return displayItems.map((d, index) => ({
            period: formatFinancialPeriodLabel(d.period, {
                mode: periodMode,
                index,
                total: displayItems.length,
            }),
            revenue: convertFinancialValueForUnit(d.revenue || 0, unitConfig, d.period) || 0,
            grossProfit: convertFinancialValueForUnit(d.gross_profit || 0, unitConfig, d.period) || 0,
            operatingIncome: convertFinancialValueForUnit(d.operating_income || 0, unitConfig, d.period) || 0,
            netIncome: convertFinancialValueForUnit(d.net_income || 0, unitConfig, d.period) || 0,
            grossMargin: d.revenue && d.gross_profit ? (d.gross_profit / d.revenue) * 100 : 0,
            operatingMargin: d.revenue && d.operating_income ? (d.operating_income / d.revenue) * 100 : 0,
            netMargin: d.revenue && d.net_income ? (d.net_income / d.revenue) * 100 : 0,
        }));
    }, [displayItems, periodMode, unitConfig]);

    const tableScale = useMemo(() => {
        const values = displayItems.flatMap((item) => [
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
        ].map((value) => convertFinancialValueForUnit(value, unitConfig, item.period)));
        return resolveUnitScale(values, unitConfig);
    }, [displayItems, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);
    const unitNote = useMemo(
        () => `Note: ${unitLegend} except Per Share Values • Reporting Standard: VAS • First available period is the base period`,
        [unitLegend, symbol]
    );

    const tableColumns = useMemo(
        () =>
            displayItems.slice(-visiblePeriodLimit).map((entry, index) => ({
                key: entry.period ?? `period_${index}`,
                label: formatFinancialPeriodLabel(entry.period, {
                    mode: periodMode,
                    index,
                    total: Math.min(displayItems.length, visiblePeriodLimit),
                }),
                align: 'right' as const,
            })),
        [displayItems, periodMode, visiblePeriodLimit]
    );
    // The metric series the chart can plot, in the order the chart draws them.
    // `isPeriod` on the period columns keeps selectableSeries from ever
    // treating a year column as a series.
    const insightSeries = useMemo<ChartableColumn[]>(
        () => [
            { key: 'revenue', label: 'Revenue', kind: 'currency' },
            { key: 'grossProfit', label: 'Gross Profit', kind: 'currency' },
            { key: 'operatingIncome', label: 'Operating Income', kind: 'currency' },
            { key: 'netIncome', label: 'Net Income', kind: 'currency' },
            { key: 'grossMargin', label: 'Gross Margin %', kind: 'percent' },
            { key: 'operatingMargin', label: 'Operating Margin %', kind: 'percent' },
            { key: 'netMargin', label: 'Net Margin %', kind: 'percent' },
            ...tableColumns.map((column) => ({
                key: column.key,
                label: column.label,
                kind: 'number' as const,
                isPeriod: true,
            })),
        ],
        [tableColumns]
    );

    const activeSeries = useMemo(
        () => seriesFromSelection(insightSeries, selection),
        [insightSeries, selection]
    );
    const selectMetric = useCallback(
        (key: string) => setSelection((current) => toggleSelection(current, { kind: 'column', key })),
        []
    );
    const clearSelection = useCallback(() => setSelection(null), []);

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                apiGroup: '/equity',
                empty: !hasData,
                endpoint: `/equity/${symbol}/income-statement?period=${apiPeriod}`,
                sourceLabel: 'Income statement',
                lastDataDate: dataUpdatedAt,
                stale: isFallback,
                extra: hasData
                    ? {
                        periods: displayItems.length,
                        // Same channel the widget already publishes on; the
                        // selection rides along so the copilot can target it.
                        tableInsight: chartInsight,
                    }
                    : undefined,
            }),
        );
    }, [onDataChange, hasData, isFallback, dataUpdatedAt, symbol, apiPeriod, displayItems.length, insightSeries, selection]);
    // A metric selection is a series selection: the shared contract charts a
    // single series only for a `column` selection whose key is a series key, so
    // the table's snake_case metric id is translated to its camelCase series key
    // here and stored in that form. Period selection is not offered in this
    // widget, so `row` never appears in the selection.
    const chartColumns = seriesFromSelection(insightSeries, selection);
    const chartInsight = buildTableInsightContext({ selection, columns: insightSeries });
    const chartLabel = describeSelection(selection, insightSeries);

    const attachSelection = useCallback(
        (row: DenseTableRow): DenseTableRow => {
            // Only metrics this widget actually charts are selectable; the rest
            // would select something the chart cannot draw.
            const seriesKey = CHARTED_SERIES_BY_METRIC[row.id];
            if (!seriesKey) return row;
            return {
                ...row,
                selectable: true,
                selected: selection?.kind === 'column' && selection.key === seriesKey,
                onSelect: () => setSelection((current) => toggleSelection(current, { kind: 'column', key: seriesKey })),
            };
        },
        [selection]
    );
    const tableRows = useMemo<DenseTableRow[]>(() => {
        const rowValue = (entry: (typeof items)[number], metricKey: string): number | null | undefined => {
            if (metricKey === 'pre_tax_profit') return entry.pre_tax_profit ?? entry.profit_before_tax;
            return (entry as unknown as Record<string, number | null | undefined>)[metricKey];
        };
        const recentItems = displayItems.slice(-visiblePeriodLimit)
        const hasAnyMetricData = (metricKey: string) =>
            recentItems.some((entry) => {
                const value = rowValue(entry, metricKey)
                return typeof value === 'number' && Number.isFinite(value)
            })

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
            ...coreMetrics.map((metricKey) => attachSelection({
                id: metricKey,
                label: labels[metricKey] || metricKey,
                parentId: 'group:profitability',
                indent: 12,
                values: Object.fromEntries(
                    recentItems.map((entry, index) => [
                        tableColumns[index]?.key ?? `period_${index}`,
                        convertFinancialValueForUnit(rowValue(entry, metricKey), unitConfig, entry.period),
                    ])
                ),
            })),
            {
                id: 'group:expenses',
                label: 'Expenses & Other',
                values: {},
                isGroup: true,
            },
            ...expenseMetrics.map((metricKey) => attachSelection({
                id: metricKey,
                label: labels[metricKey] || metricKey,
                parentId: 'group:expenses',
                indent: 12,
                values: Object.fromEntries(
                    recentItems.map((entry, index) => [
                        tableColumns[index]?.key ?? `period_${index}`,
                        convertFinancialValueForUnit(rowValue(entry, metricKey), unitConfig, entry.period),
                    ])
                ),
            })),
            {
                id: 'group:per-share',
                label: 'Per-share',
                values: {},
                isGroup: true,
            },
            attachSelection({
                id: 'eps',
                label: labels.eps,
                parentId: 'group:per-share',
                indent: 12,
                values: Object.fromEntries(
                    recentItems.map((entry, index) => [
                        tableColumns[index]?.key ?? `period_${index}`,
                        convertFinancialValueForUnit(entry.eps, unitConfig, entry.period),
                    ])
                ),
            }),
            ...(hasAnyMetricData('eps_diluted')
                ? [attachSelection({
                    id: 'eps_diluted',
                    label: labels.eps_diluted,
                    parentId: 'group:per-share',
                    indent: 12,
                    values: Object.fromEntries(
                        recentItems.map((entry, index) => [
                            tableColumns[index]?.key ?? `period_${index}`,
                            convertFinancialValueForUnit(entry.eps_diluted, unitConfig, entry.period),
                        ])
                    ),
                })]
                : []),
        ];

        return rows;
    }, [displayItems, tableColumns, unitConfig, visiblePeriodLimit, attachSelection]);

    const renderTable = () => (
        <DenseFinancialTable
            columns={tableColumns}
            rows={tableRows}
            sortable
            showTrend={false}
            maxYears={tableColumns.length || 1}
            selectedColumnKey={selection?.kind === 'column' ? selection.key : null}
            onColumnSelect={selectMetric}
            onSelectionClear={clearSelection}
            storageKey={`income:${id}:${symbol}:${period}`}
            footerNote={unitNote}
            valueFormatter={(value, row) => {
                if (row.id === 'eps') {
                    return formatNumber(value as number | null | undefined, { decimals: 2 });
                }
                return formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig);
            }}
        />
    );

    const sankeyModel = useMemo(() => buildIncomeSankeyModel(displayItems), [displayItems]);
    const [chartType, setChartType] = useState<'overview' | 'margins' | 'sankey'>('overview');
    const chartedSeries = chartColumns.filter((entry) => entry.kind !== 'text');
    const isPercentSeries = chartedSeries.length > 0 && chartedSeries.every((entry) => entry.kind === 'percent');
    // Which chart panes may draw. A selection that maps to no chartable series
    // draws nothing rather than borrowing another metric's series; only the
    // no-selection case falls back to the widget's default panes.
    const panes = {
        over: chartedSeries.length === 0 ? !selection : chartedSeries.some((entry) => entry.kind === 'currency'),
        fcf: chartedSeries.some((entry) => entry.kind === 'percent'),
    };
    const effectiveChartType = selection && selection.kind === 'column' ? (isPercentSeries ? 'margins' : 'overview') : chartType;
    const xAxisInterval = useMemo(
        () => (chartData.length > 12 ? Math.max(1, Math.ceil(chartData.length / 8)) - 1 : 0),
        [chartData.length]
    );

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
                <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span
                            data-testid="income-chart-focus"
                            className="truncate text-[10px] font-bold uppercase tracking-tighter text-[var(--text-secondary)]"
                            title={chartLabel}
                        >
                            {chartLabel}
                        </span>
                        {selection ? (
                            <button
                                type="button"
                                onClick={clearSelection}
                                aria-label="Clear table selection"
                                className="shrink-0 rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tighter text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                            >
                                Clear
                            </button>
                        ) : null}
                    </div>
                    <select
                        value={effectiveChartType}
                        onChange={(e) => setChartType(e.target.value as 'overview' | 'margins' | 'sankey')}
                        aria-label="Income statement chart mode"
                        className="shrink-0 bg-[var(--bg-secondary)] text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-color)] rounded px-2 py-1 focus:outline-none focus:border-blue-500 uppercase tracking-tighter cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    >
                        <option value="overview">Revenue & Profit</option>
                        <option value="margins">Margins %</option>
                        <option value="sankey">Sankey Flow</option>
                    </select>
                </div>

                <div className="flex-1 min-h-[132px]">
                    {effectiveChartType === 'sankey' ? (
                        sankeyModel ? (
                            <IncomeSankeyChart
                                model={sankeyModel}
                                formatValue={(value) => formatUnitValuePlain(value, tableScale, unitConfig)}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-[var(--text-muted)]">Flow data unavailable</div>
                        )
                    ) : (
                    <ChartMountGuard className="h-full" minHeight={120}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={120}>
                            {panes.over ? (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} interval={xAxisInterval} minTickGap={12} />
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
                                    {(panes.over && chartedSeries.some((entry) => entry.key === 'revenue')) ? (
                                        <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                                    ) : null}
                                    {chartedSeries.some((entry) => entry.key === 'netIncome') ? (
                                        <Line type="monotone" dataKey="netIncome" name="Net Income" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                                    ) : null}
                                </ComposedChart>
                            ) : panes.fcf ? (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} interval={xAxisInterval} minTickGap={12} />
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
                                        }}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    {chartedSeries.some((entry) => entry.key === 'grossMargin') ? (
                                        <Line type="monotone" dataKey="grossMargin" name="Gross %" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                                    ) : null}
                                    {chartedSeries.some((entry) => entry.key === 'netMargin') ? (
                                        <Line type="monotone" dataKey="netMargin" name="Net %" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
                                    ) : null}
                                </ComposedChart>
                            ) : (
                                <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-[var(--text-muted)]">
                                    No charted series for this selection
                                </div>
                            )}
                        </ResponsiveContainer>
                    </ChartMountGuard>
                    )}
                </div>
            </div>
        );
    };


    return (
        <WidgetContainer
            title="Income Statement"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={displayItems}
        >
            <div className="h-full flex flex-col px-2 py-1.5">
                {/* The dashboard wraps widget children in a header-suppressing
                    provider, so the container header never renders on a
                    dashboard. View controls therefore live in the body: they
                    own the widget's own viewMode/period state and must stay
                    reachable wherever the widget is rendered. */}
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-1.5">
                        <div className="flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-color)]">
                            <button
                                type="button"
                                onClick={() => setViewMode('table')}
                                aria-pressed={viewMode === 'table'}
                                className={cn(
                                    "p-1 rounded transition-all",
                                    viewMode === 'table'
                                        ? "bg-[var(--bg-tertiary)] text-blue-400 shadow-sm"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                )}
                                title="Table View"
                                aria-label="Table View"
                            >
                                <Table size={12} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('chart')}
                                aria-pressed={viewMode === 'chart'}
                                className={cn(
                                    "p-1 rounded transition-all",
                                    viewMode === 'chart'
                                        ? "bg-[var(--bg-tertiary)] text-blue-400 shadow-sm"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                )}
                                title="Chart View"
                                aria-label="Chart View"
                            >
                                <BarChart3 size={12} />
                            </button>
                        </div>
                        {showPeriodToggle ? <PeriodToggle value={period} onChange={setPeriod} compact options={[...STATEMENT_PERIOD_OPTIONS]} /> : null}
                    </div>
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={period === 'FY' ? 'Annual · newest on right' : period === 'TTM' ? 'TTM · newest on right' : 'Quarterly · newest on right'}
                        sourceLabel="Income statement"
                        align="right"
                    />
                </div>
                <div className="flex-1 overflow-auto scrollbar-hide pt-1">
                    {timedOut && isLoading && !hasData ? (
                        <WidgetError
                            title="Loading timed out"
                            error={new Error('Request timed out after 15 seconds.')}
                            onRetry={() => {
                                resetTimeout()
                                refetch()
                            }}
                        />
                    ) : isLoading && !hasData ? (
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
