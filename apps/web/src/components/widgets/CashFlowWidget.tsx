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
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { cn } from '@/lib/utils';
import { formatFinancialPeriodLabel, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import { buildCashFlowWaterfallModel } from '@/lib/financialVisualizations';
import { CashFlowWaterfallChart } from '@/components/widgets/charts/CashFlowWaterfallChart';
import type { CashFlowData } from '@/types/equity';

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
    depreciation: 'Depreciation',
    taxes_paid: 'Taxes Paid',
    interest_paid: 'Interest Paid',
    change_in_receivables: 'Receivables Change',
    change_in_inventory: 'Inventory Change',
    change_in_payables: 'Payables Change',
    fx_effect: 'FX Effect',
    proceeds_from_borrowings: 'Borrowings Received',
    proceeds_from_share_issuance: 'Share Issuance',
    proceeds_from_asset_sales: 'Asset Sale Proceeds',
    acquisition_spend: 'Acquisition Spend',
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
const QUARTER_PERIOD_LIMIT = 28;
const QUARTER_CHART_POINTS = 16;
const STATEMENT_PERIOD_OPTIONS = ['FY', 'Q', 'TTM'] as const;

const RAW_CASHFLOW_ALIASES: Record<string, string[]> = {
    depreciation: ['depreciation', 'depreciation_and_amortisation', 'khau_hao_tscd'],
    taxes_paid: ['taxes_paid', 'income_tax_paid', 'cash_paid_for_taxes', 'chi_nop_thue_thu_nhap_doanh_nghiep'],
    interest_paid: ['interest_paid', 'interest_expense_paid', 'cash_paid_for_interest', 'lai_vay_da_tra'],
    change_in_receivables: ['change_in_receivables', 'increase_decrease_in_receivables', 'tang_giam_cac_khoan_phai_thu'],
    change_in_inventory: ['change_in_inventory', 'increase_decrease_in_inventories', 'tang_giam_hang_ton_kho'],
    change_in_payables: ['change_in_payables', 'increase_decrease_in_payables', 'tang_giam_cac_khoan_phai_tra'],
    fx_effect: ['effect_of_exchange_rate_changes', 'fx_effect', 'chenh_lech_ty_gia'],
    proceeds_from_borrowings: ['proceeds_from_borrowings', 'cash_received_from_borrowings', 'tien_thu_tu_di_vay'],
    proceeds_from_share_issuance: ['proceeds_from_issue_of_shares', 'cash_received_from_shares_issue', 'phat_hanh_co_phieu'],
    proceeds_from_asset_sales: ['proceeds_from_disposal_of_fixed_assets', 'cash_received_from_disposal_of_fixed_assets', 'thu_tu_thanh_ly_tai_san'],
    acquisition_spend: ['payments_for_acquisitions', 'acquisition_spend', 'chi_mua_cong_ty_con'],
    stock_repurchased: ['stock_repurchased', 'repurchase_of_shares', 'purchase_of_treasury_shares', 'co_phieu_quy'],
};

function toNumeric(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.toString().replace(/,/g, '').trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function getRawMetric(entry: CashFlowData, metricKey: string): number | null {
    const rawData = entry.raw_data;
    if (!rawData || typeof rawData !== 'object') return null;

    for (const alias of RAW_CASHFLOW_ALIASES[metricKey] || []) {
        const direct = toNumeric((rawData as Record<string, unknown>)[alias]);
        if (direct !== null) return direct;

        const loweredAlias = alias.toLowerCase();
        for (const [rawKey, rawValue] of Object.entries(rawData)) {
            if (rawKey.toLowerCase() === loweredAlias) {
                const numeric = toNumeric(rawValue);
                if (numeric !== null) return numeric;
            }
        }
    }

    return null;
}

function CashFlowWidgetComponent({ id, symbol, isEditing, onRemove }: CashFlowWidgetProps) {
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'cash_flow',
        defaultPeriod: 'FY',
        validPeriods: [...STATEMENT_PERIOD_OPTIONS],
    });
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const { config: unitConfig } = useUnit();
    
    const apiPeriod = period === 'FY' ? 'year' : period === 'Q' ? 'quarter' : period;
    const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';
    const visiblePeriodLimit = period === 'Q' ? QUARTER_PERIOD_LIMIT : TABLE_YEAR_LIMIT;
    const chartPointLimit = period === 'Q' ? QUARTER_CHART_POINTS : 5;

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useCashFlow(symbol, { period: apiPeriod, limit: visiblePeriodLimit });

    const items = data?.data || [];
    const orderedItems = useMemo(
        () => [...items].sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [items]
    );
    const hasData = items.length > 0;
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);

    const chartData = useMemo(() => {
        if (!orderedItems.length) return [];
        const recentItems = orderedItems.slice(-chartPointLimit);
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
    }, [chartPointLimit, orderedItems, periodMode]);

    const tableScale = useMemo(() => {
        const values = orderedItems.flatMap((item) => [
            item.operating_cash_flow,
            item.investing_cash_flow,
            item.financing_cash_flow,
            getRawMetric(item, 'depreciation'),
            getRawMetric(item, 'taxes_paid'),
            getRawMetric(item, 'interest_paid'),
            getRawMetric(item, 'change_in_receivables'),
            getRawMetric(item, 'change_in_inventory'),
            getRawMetric(item, 'change_in_payables'),
            getRawMetric(item, 'fx_effect'),
            getRawMetric(item, 'proceeds_from_borrowings'),
            getRawMetric(item, 'proceeds_from_share_issuance'),
            getRawMetric(item, 'proceeds_from_asset_sales'),
            getRawMetric(item, 'acquisition_spend'),
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
    }, [orderedItems, unitConfig]);

    const unitLegend = useMemo(() => getUnitLegend(tableScale, unitConfig), [tableScale, unitConfig]);
    const unitNote = useMemo(
        () => `Note: ${unitLegend} except Per Share Values • Reporting Standard: VAS • First available period is the base period`,
        [unitLegend]
    );

    const tableColumns = useMemo(
        () =>
            orderedItems.slice(-visiblePeriodLimit).map((entry, index) => ({
                key: entry.period ?? `period_${index}`,
                label: formatFinancialPeriodLabel(entry.period, {
                    mode: periodMode,
                    index,
                    total: Math.min(orderedItems.length, visiblePeriodLimit),
                }),
                align: 'right' as const,
            })),
        [orderedItems, periodMode, visiblePeriodLimit]
    );

    const tableRows = useMemo<DenseTableRow[]>(() => {
        const valueFor = (entry: (typeof items)[number], metricKey: string): number | null | undefined => {
            if (metricKey === 'net_change_in_cash') return entry.net_change_in_cash ?? entry.net_cash_flow
            if (metricKey === 'capex') return entry.capex ?? entry.capital_expenditure

            const normalizedValue = (entry as unknown as Record<string, number | null | undefined>)[metricKey]
            if (typeof normalizedValue === 'number' && Number.isFinite(normalizedValue)) {
                return normalizedValue
            }

            if (metricKey in RAW_CASHFLOW_ALIASES) return getRawMetric(entry as CashFlowData, metricKey)
            return normalizedValue
        }
        const recentItems = orderedItems.slice(-visiblePeriodLimit)
        const hasMetricData = (metricKey: string) =>
            recentItems.some((entry) => {
                const value = valueFor(entry, metricKey)
                return typeof value === 'number' && Number.isFinite(value)
            })

        const mapValues = (metricKey: string) =>
            Object.fromEntries(
                recentItems.map((entry, index) => [
                    tableColumns[index]?.key ?? `period_${index}`,
                    valueFor(entry, metricKey),
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
            { id: 'group:operations', label: 'Operating details', values: {}, isGroup: true },
            createRow('group:operations', 'operating_cash_flow'),
            createRow('group:operations', 'depreciation'),
            createRow('group:operations', 'taxes_paid'),
            createRow('group:operations', 'interest_paid'),
            createRow('group:operations', 'change_in_receivables'),
            createRow('group:operations', 'change_in_inventory'),
            createRow('group:operations', 'change_in_payables'),
            createRow('group:operations', 'fx_effect'),
            { id: 'group:investing', label: 'Investing details', values: {}, isGroup: true },
            createRow('group:investing', 'investing_cash_flow'),
            createRow('group:investing', 'capex'),
            createRow('group:investing', 'proceeds_from_asset_sales'),
            createRow('group:investing', 'acquisition_spend'),
            { id: 'group:financing', label: 'Financing details', values: {}, isGroup: true },
            createRow('group:financing', 'financing_cash_flow'),
            createRow('group:financing', 'proceeds_from_borrowings'),
            createRow('group:financing', 'proceeds_from_share_issuance'),
            createRow('group:financing', 'dividends_paid'),
            createRow('group:financing', 'debt_repayment'),
            createRow('group:financing', 'stock_repurchased'),
            { id: 'group:summary', label: 'Summary', values: {}, isGroup: true },
            createRow('group:summary', 'free_cash_flow'),
            createRow('group:summary', 'net_change_in_cash'),
        ].filter(Boolean) as DenseTableRow[];
    }, [orderedItems, tableColumns, visiblePeriodLimit]);

    const renderTable = () => (
        <DenseFinancialTable
            columns={tableColumns}
            rows={tableRows}
            sortable
            showTrend={false}
            storageKey={`cash-flow:${id}:${symbol}:${period}`}
            footerNote={unitNote}
            valueFormatter={(value) =>
                formatUnitValuePlain(value as number | null | undefined, tableScale, unitConfig)
            }
        />
    );

    const waterfallModel = useMemo(() => buildCashFlowWaterfallModel(orderedItems), [orderedItems]);
    const [chartType, setChartType] = useState<'overview' | 'fcf' | 'waterfall'>('overview');

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
                        <option value="waterfall">Waterfall</option>
                    </select>
                </div>

                <div className="flex-1 min-h-[132px]">
                    {chartType === 'waterfall' ? (
                        waterfallModel ? (
                            <CashFlowWaterfallChart
                                model={waterfallModel}
                                formatValue={(value) => formatUnitValuePlain(value, tableScale, unitConfig)}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-[var(--text-muted)]">Waterfall data unavailable</div>
                        )
                    ) : (
                    <ChartMountGuard className="h-full" minHeight={120}>
                        <ResponsiveContainer width="99%" height="100%" minWidth={240} minHeight={120}>
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
                    )}
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
            <PeriodToggle value={period} onChange={setPeriod} compact options={[...STATEMENT_PERIOD_OPTIONS]} />
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
            exportData={orderedItems}
        >
            <div className="h-full flex flex-col px-2 py-1.5">
                <div className="pb-1 border-b border-[var(--border-subtle)]">
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : 'Quarterly'}
                        sourceLabel="Cash flow"
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
