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
    formatConvertedValue,
    formatNumber,
    formatRawValuePlain,
    formatUnitValuePlain,
    getUnitCaption,
    getUnitLegend,
    resolveUnitScale,
    toFiniteNumber,
} from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { canonicalPeriodRows, describeUnavailableStatementRows, formatFinancialPeriodLabel, FUNDAMENTAL_PERIOD_SYNC_GROUP, isCanonicalQuarterPeriod, isUnavailableStatementRow, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
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

/** Only rows with a corresponding chart series offer metric selection. */
const CHARTED_SERIES_BY_METRIC: Record<string, string> = {
    revenue: 'revenue',
    gross_profit: 'grossProfit',
    operating_income: 'operatingIncome',
    net_income: 'netIncome',
};
const STATEMENT_PERIOD_OPTIONS = ['FY', 'Q', 'TTM'] as const;

function IncomeStatementWidgetComponent({ id, symbol, config, isEditing, onRemove, onDataChange }: IncomeStatementWidgetProps) {
    // Default to the shared group the "Financial Period View" banner writes; a
    // widget-level `periodSyncGroup` overrides it and an explicit `null` opts out
    // so the period stays widget-local (issue #101).
    const configuredSyncGroup = config?.periodSyncGroup;
    const periodSyncGroup = configuredSyncGroup === null
        ? undefined
        : typeof configuredSyncGroup === 'string' && configuredSyncGroup.trim()
            ? configuredSyncGroup
            : FUNDAMENTAL_PERIOD_SYNC_GROUP;
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
    // Provider payloads can repeat a fiscal period or emit rows with no fiscal
    // identity at all. `canonicalPeriodRows` never picks between conflicting rows
    // (nothing in the payload proves which basis is authoritative) - it excludes
    // them and reports the reason, so a duplicate is disclosed rather than shown as
    // two columns labelled "2020" (issue #103).
    const { rows: canonicalItems, issues: periodIssues, invalidPeriodCount } = useMemo(
        () => canonicalPeriodRows(items),
        [items]
    );
    const orderedItems = useMemo(
        () => [...canonicalItems].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [canonicalItems]
    );
    // The TTM branch returns a single TTM row today (financial_service
    // .build_ttm_statement_rows), and this filter guarantees the TTM view can
    // never render a quarter row under a TTM header if a payload carries one
    // (issue #101).
    const periodItems = useMemo(
        () => periodMode === 'quarter'
            ? orderedItems.filter((item) => isCanonicalQuarterPeriod(item.period))
            : periodMode === 'ttm'
                ? orderedItems.filter((item) => String(item.period ?? '').toUpperCase().includes('TTM'))
                : orderedItems,
        [orderedItems, periodMode]
    );
    // A row the API returned without certification carries every numeric field as
    // null plus `unavailable_reason`. Rendering it as a column of dashes reads as a
    // reported zero, so reason-bearing rows are held out of the table/chart and
    // disclosed in the note instead; a row that merely has some null fields is a
    // valid partial row and stays (issue #103).
    const unavailableNote = useMemo(() => describeUnavailableStatementRows(periodItems), [periodItems]);
    const displayItems = useMemo(
        () => periodItems.filter((item) => !isUnavailableStatementRow(item)),
        [periodItems]
    );
    const duplicatePeriodNote = useMemo(() => {
        const notes: string[] = [];
        const ambiguous = periodIssues.filter((issue) => issue.reason === 'ambiguous-basis');
        if (ambiguous.length > 0) {
            notes.push(
                `Unavailable: ${ambiguous.map((issue) => issue.period).join(', ')} returned conflicting rows with no basis field, so no value is shown.`
            );
        }
        if (invalidPeriodCount > 0) {
            notes.push(`${invalidPeriodCount} provider row${invalidPeriodCount === 1 ? '' : 's'} without a fiscal period excluded.`);
        }
        return notes.length > 0 ? notes.join(' ') : null;
    }, [periodIssues, invalidPeriodCount]);
    const statementNote = useMemo(
        () => [duplicatePeriodNote, unavailableNote].filter(Boolean).join(' ') || null,
        [duplicatePeriodNote, unavailableNote]
    );
    const hasData = displayItems.length > 0;
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);

    // One FX boundary: convert once here; axis/tooltip format without converting
    // again (issue #100). A missing raw value stays `null` so the chart draws a gap
    // instead of a fabricated zero (issue #103).
    const chartData = useMemo(() => {
        if (!displayItems.length) return [];
        return displayItems.map((d) => {
            const revenue = convertFinancialValueForUnit(d.revenue ?? null, unitConfig, d.period);
            const grossProfit = convertFinancialValueForUnit(d.gross_profit ?? null, unitConfig, d.period);
            const operatingIncome = convertFinancialValueForUnit(d.operating_income ?? null, unitConfig, d.period);
            const netIncome = convertFinancialValueForUnit(d.net_income ?? null, unitConfig, d.period);
            return {
                period: formatFinancialPeriodLabel(d.period, { mode: periodMode }),
                revenue,
                grossProfit,
                operatingIncome,
                netIncome,
                grossMargin: revenue && grossProfit !== null ? (grossProfit / revenue) * 100 : null,
                operatingMargin: revenue && operatingIncome !== null ? (operatingIncome / revenue) * 100 : null,
                netMargin: revenue && netIncome !== null ? (netIncome / revenue) * 100 : null,
            };
        });
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
        () => `Note: ${unitLegend}; per-share values (EPS) are ${unitConfig.display === 'USD' ? 'USD' : 'VND'} per share • Reporting Standard: VAS • First available period is the base period`,
        [unitLegend, unitConfig.display]
    );

    const tableColumns = useMemo(
        () =>
            displayItems.slice(-visiblePeriodLimit).map((entry, index) => ({
                key: entry.period ?? `period_${index}`,
                label: formatFinancialPeriodLabel(entry.period, { mode: periodMode }),
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
    const chartInsight = useMemo(
        () => buildTableInsightContext({ selection, columns: insightSeries }),
        [selection, insightSeries]
    );
    const chartLabel = describeSelection(selection, insightSeries);
    const clearSelection = useCallback(() => setSelection(null), []);

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                apiGroup: '/equity',
                empty: !hasData,
                endpoint: `/equity/${symbol}/income-statement?period=${apiPeriod}`,
                sourceLabel: 'Income statement',
                lastDataDate: null,
                fetchedAt: dataUpdatedAt,
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
    }, [onDataChange, hasData, isFallback, dataUpdatedAt, symbol, apiPeriod, displayItems.length, chartInsight]);
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
            initialScrollPosition="end"
            selectedColumnKey={selection?.kind === 'column' ? selection.key : null}
            onSelectionClear={clearSelection}
            storageKey={`income:${id}:${symbol}:${period}`}
            footerNote={unitNote}
            valueFormatter={(value, row) => {
                if (row.id === 'eps' || row.id === 'eps_diluted') {
                    return formatNumber(value as number | null | undefined, { decimals: 2 });
                }
                return formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig);
            }}
        />
    );

    const sankeyModel = useMemo(() => buildIncomeSankeyModel(displayItems), [displayItems]);
    const [chartType, setChartType] = useState<'overview' | 'margins' | 'sankey'>('overview');
    const isPercentSeries = selection && activeSeries.length > 0 && activeSeries.every((entry) => entry.kind === 'percent');
    const effectiveChartType = selection ? (isPercentSeries ? 'margins' : 'overview') : chartType;
    const chartedSeries = selection
        ? activeSeries
        : activeSeries.filter((entry) => effectiveChartType === 'margins' ? entry.kind === 'percent' : entry.kind === 'currency');
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
                                formatValue={(value) => formatRawValuePlain(value, tableScale, unitConfig, sankeyModel.period)}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-[var(--text-muted)]">Flow data unavailable</div>
                        )
                    ) : (
                    <ChartMountGuard className="h-full" minHeight={120}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={120}>
                            {effectiveChartType === 'overview' ? (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} interval={xAxisInterval} minTickGap={12} />
                                    <YAxis
                                        tickFormatter={(value) => formatAxisValue(value, unitConfig, { converted:true })}
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
                                        formatter={(value: unknown) => formatConvertedValue(toFiniteNumber(value), unitConfig)}
                                    />
                                    {chartedSeries.some((entry) => entry.key === 'revenue') ? (
                                        <Bar dataKey="revenue" name="Revenue" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                                    ) : null}
                                    {selection && chartedSeries.some((entry) => entry.key === 'grossProfit') ? (
                                        <Line type="monotone" dataKey="grossProfit" name="Gross Profit" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                                    ) : null}
                                    {selection && chartedSeries.some((entry) => entry.key === 'operatingIncome') ? (
                                        <Line type="monotone" dataKey="operatingIncome" name="Operating Income" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} />
                                    ) : null}
                                    {chartedSeries.some((entry) => entry.key === 'netIncome') ? (
                                        <Line type="monotone" dataKey="netIncome" name="Net Income" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                                    ) : null}
                                </ComposedChart>
                            ) : effectiveChartType === 'margins' ? (
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
                                    {chartedSeries.some((entry) => entry.key === 'operatingMargin') ? (
                                        <Line type="monotone" dataKey="operatingMargin" name="Operating %" stroke="#a855f7" strokeWidth={2} dot={{ r: 2 }} />
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
                        updatedAt={null}
                        fetchedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={statementNote ?? (period === 'FY' ? 'Annual · newest on right' : period === 'TTM' ? 'TTM · newest on right' : 'Quarterly · newest on right')}
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
                            message={unavailableNote
                                ? `Income statement unavailable for ${symbol} (${period === 'FY' ? 'Annual' : period}).`
                                : `No income statement data for ${symbol} (${period === 'FY' ? 'Annual' : period}).`}
                            detail={unavailableNote ?? undefined}
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
