// Balance Sheet Widget - Assets, Liabilities, Equity with Chart View
'use client';

import { useState, useMemo, useEffect, memo } from 'react';
import { Scale, Table, BarChart3 } from 'lucide-react';
import { useBalanceSheet } from '@/lib/queries';
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
import { convertFinancialValueForUnit, formatAxisValue, formatConvertedValue, formatUnitValuePlain, getUnitCaption, getUnitLegend, resolveUnitScale, toFiniteNumber } from '@/lib/units';
import { useUnit } from '@/contexts/UnitContext';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { cn } from '@/lib/utils';
import { canonicalPeriodRows, describeUnavailableStatementRows, formatFinancialPeriodLabel, FUNDAMENTAL_PERIOD_OPTIONS, FUNDAMENTAL_PERIOD_SYNC_GROUP, isCanonicalQuarterPeriod, isUnavailableStatementRow, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';

interface BalanceSheetWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: unknown) => void;
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
    customer_deposits: 'Customer Deposits',
    equity: 'Equity',
    total_equity: 'Total Equity',
    retained_earnings: 'Retained Earnings',
    cash: 'Cash',
    inventory: 'Inventory',
};

const TABLE_YEAR_LIMIT = 20;
const QUARTER_PERIOD_LIMIT = 40;
const STATEMENT_PERIOD_OPTIONS = FUNDAMENTAL_PERIOD_OPTIONS;

function BalanceSheetWidgetComponent({ id, symbol, config, isEditing, onRemove, onDataChange }: BalanceSheetWidgetProps) {
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
        widgetId: id || 'balance_sheet',
        defaultPeriod,
        validPeriods: [...STATEMENT_PERIOD_OPTIONS],
        sharedKey: periodSyncGroup ? `${periodSyncGroup}:${symbol.toUpperCase()}` : undefined,
    });
    const showPeriodToggle = config?.hidePeriodToggle !== true;
    const [viewMode, setViewMode] = useState<ViewMode>('table');
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
    } = useBalanceSheet(symbol, { period: apiPeriod, limit: visiblePeriodLimit });

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

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasData,
                apiGroup: '/equity',
                endpoint: `/equity/${symbol}/balance-sheet?period=${apiPeriod}`,
                sourceLabel: 'Balance sheet',
                lastDataDate: null,
                fetchedAt: dataUpdatedAt,
                stale: isFallback,
                extra: hasData ? { periods: displayItems.length } : undefined,
            }),
        );
    }, [onDataChange, hasData, isFallback, dataUpdatedAt, symbol, apiPeriod, displayItems.length]);

    // One FX conversion boundary: values below are ALREADY in display units. The
    // axis and tooltip format these without converting again (issue #100), and a
    // missing raw value stays `null` so the chart draws a gap instead of a fake
    // zero (issue #103).
    const chartData = useMemo(() => {
        if (!displayItems.length) return [];
        return displayItems.map((d) => {
            const equityValue = convertFinancialValueForUnit(d.total_equity ?? d.equity ?? null, unitConfig, d.period)
            const liabilities = convertFinancialValueForUnit(d.total_liabilities ?? null, unitConfig, d.period)
            return {
                equityValue,
                period: formatFinancialPeriodLabel(d.period, { mode: periodMode }),
                totalAssets: convertFinancialValueForUnit(d.total_assets ?? null, unitConfig, d.period),
                totalLiabilities: liabilities,
                equity: equityValue,
                cash: convertFinancialValueForUnit(d.cash ?? null, unitConfig, d.period),
                debtToEquity: liabilities !== null && equityValue !== null && equityValue !== 0
                    ? liabilities / equityValue
                    : null,
            }
        });
    }, [displayItems, periodMode, unitConfig]);

    const chartScale = useMemo(
        () => resolveUnitScale(
            chartData.flatMap((point) => [point.totalAssets, point.totalLiabilities, point.equity]),
            unitConfig,
        ),
        [chartData, unitConfig],
    );

    const tableScale = useMemo(() => {
        const values = displayItems.flatMap((item) => [
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
            item.customer_deposits,
            item.total_equity,
            item.equity,
            item.retained_earnings,
            item.cash,
            item.inventory,
        ].map((value) => convertFinancialValueForUnit(value, unitConfig, item.period)));
        return resolveUnitScale(values, unitConfig);
    }, [displayItems, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);
    const unitNote = useMemo(
        () => `Note: ${unitLegend}; per-share values (BVPS) are VND per share and are not converted • Reporting Standard: VAS • First available period is the base period`,
        [unitLegend]
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

    const tableRows = useMemo<DenseTableRow[]>(() => {
        const valueFor = (entry: (typeof items)[number], metricKey: string): number | null | undefined => {
            if (metricKey === 'total_equity') return entry.total_equity ?? entry.equity
            if (metricKey === 'accounts_receivable') return entry.accounts_receivable ?? entry.receivables
            return (entry as unknown as Record<string, number | null | undefined>)[metricKey]
        }
        const recentItems = displayItems.slice(-visiblePeriodLimit)
        const hasMetricData = (metricKey: string) =>
            recentItems.some((entry) => {
                const value = valueFor(entry, metricKey)
                return typeof value === 'number' && Number.isFinite(value)
            })

        const mapValues = (metricKey: string) =>
            Object.fromEntries(
                recentItems.map((entry, index) => [
                    tableColumns[index]?.key ?? `period_${index}`,
                    convertFinancialValueForUnit(valueFor(entry, metricKey), unitConfig, entry.period),
                ])
            );

        const createRow = (groupId: string, metricKey: string): DenseTableRow | null =>
            hasMetricData(metricKey)
                ? {
                    id: metricKey,
                    label: labels[metricKey] || metricKey,
                    parentId: groupId,
                    indent: 12,
                    values: mapValues(metricKey),
                }
                : null;

        return [
            { id: 'group:assets', label: 'Assets', values: {}, isGroup: true },
            createRow('group:assets', 'total_assets'),
            createRow('group:assets', 'current_assets'),
            createRow('group:assets', 'fixed_assets'),
            createRow('group:assets', 'cash'),
            createRow('group:assets', 'inventory'),
            createRow('group:assets', 'accounts_receivable'),
            { id: 'group:liabilities', label: 'Liabilities', values: {}, isGroup: true },
            createRow('group:liabilities', 'total_liabilities'),
            createRow('group:liabilities', 'current_liabilities'),
            createRow('group:liabilities', 'long_term_liabilities'),
            createRow('group:liabilities', 'short_term_debt'),
            createRow('group:liabilities', 'long_term_debt'),
            createRow('group:liabilities', 'accounts_payable'),
            createRow('group:liabilities', 'customer_deposits'),
            { id: 'group:equity', label: 'Equity', values: {}, isGroup: true },
            createRow('group:equity', 'total_equity'),
            createRow('group:equity', 'retained_earnings'),
        ].filter(Boolean) as DenseTableRow[];
    }, [displayItems, tableColumns, unitConfig, visiblePeriodLimit]);

    const renderTable = () => (
        <DenseFinancialTable
            columns={tableColumns}
            rows={tableRows}
            sortable
            showTrend={false}
            maxYears={tableColumns.length || 1}
            initialScrollPosition="end"
            storageKey={`balance:${id}:${symbol}:${period}`}
            footerNote={unitNote}
            valueFormatter={(value) =>
                formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig)
            }
        />
    );

    const [chartType, setChartType] = useState<'overview' | 'debt'>('overview');
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
                <div className="flex justify-end px-1 pt-0.5">
                    <select
                        value={chartType}
                        onChange={(e) => setChartType(e.target.value as any)}
                        aria-label="Balance sheet chart mode"
                        className="bg-[var(--bg-secondary)] text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-color)] rounded px-2 py-1 focus:outline-none focus:border-blue-500 uppercase tracking-tighter cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                    >
                        <option value="overview">Assets & Liab.</option>
                        <option value="debt">Debt Structure</option>
                    </select>
                </div>

                <div className="flex-1 min-h-[132px]">
                    <ChartMountGuard className="h-full" minHeight={120}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={120}>
                            {chartType === 'overview' ? (
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
                                        formatter={(value: unknown) => formatConvertedValue(toFiniteNumber(value), unitConfig)}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                                    <Bar dataKey="totalAssets" name="Assets" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                                    <Bar dataKey="totalLiabilities" name="Liabilities" fill="#ef4444" radius={[2, 2, 0, 0]} />
                                    <Line type="monotone" dataKey="equity" name="Equity" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                                </ComposedChart>
                            ) : (
                                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                                    <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} interval={xAxisInterval} minTickGap={12} />
                                    <YAxis
                                        yAxisId="left"
                                        tickFormatter={(value) => formatAxisValue(value, unitConfig, { converted:true })}
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
                                        formatter={(value: unknown, name: unknown) => {
                                            const numeric = toFiniteNumber(value)
                                            return name === 'D/E Ratio'
                                                ? `${numeric === null ? '—' : numeric.toFixed(2)}x`
                                                : formatConvertedValue(numeric, unitConfig)
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
            {showPeriodToggle ? <PeriodToggle value={period} onChange={setPeriod} compact options={[...STATEMENT_PERIOD_OPTIONS]} /> : null}
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
            exportData={orderedItems}
        >
            <div className="h-full flex flex-col px-2 py-1.5">
                <div className="pb-1 border-b border-[var(--border-subtle)]">
                    <WidgetMeta
                        updatedAt={null}
                        fetchedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={statementNote ?? (period === 'FY' ? 'Annual · newest on right' : period === 'TTM' ? 'TTM · newest on right' : 'Quarterly · newest on right')}
                        sourceLabel="Balance sheet"
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
                                ? `Balance sheet unavailable for ${symbol}.`
                                : `No balance sheet data for ${symbol}. Try switching period or refresh.`}
                            detail={unavailableNote ?? undefined}
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
