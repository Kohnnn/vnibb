// Financial Ratios Widget - Historical P/E, P/B, ROE, etc.
'use client';

import { memo, useEffect, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFinancialRatios, useIncomeStatement } from '@/lib/queries';
import { buildWidgetRuntime, type WidgetDataPayload } from '@/lib/widgetRuntime';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { canonicalPeriodRows, formatFinancialPeriodLabel, FUNDAMENTAL_PERIOD_SYNC_GROUP, matchesFinancialPeriodMode, normalizeFinancialPeriod, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { EMPTY_VALUE, formatNumber, formatPercent } from '@/lib/units';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';
import { useUnit } from '@/contexts/UnitContext';
import { isPerShareMetric, PER_SHARE_METRICS, projectFinancialRatios } from './financialRatioValues';

interface FinancialRatiosWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

function formatRatio(value: number | null | undefined, decimals = 2): string {
    return formatNumber(value, { decimals });
}

const CANONICAL_PERCENT_KEYS: Record<string, true> = {
    roe: true, roa: true, roic: true, gross_margin: true, net_margin: true,
    operating_margin: true, revenue_growth: true, earnings_growth: true, debt_assets: true, dividend_yield: true, payout_ratio: true,
    fcf_yield: true, ocf_sales: true,
};

function formatPct(metricKey: string, value: number | null | undefined): string {
    if (metricKey === 'payout_ratio') return formatPercent(value, { decimals: 2, input: 'percent' });
    const clamp = metricKey === 'dividend_yield' || metricKey === 'fcf_yield'
        ? 'yield'
        : metricKey === 'revenue_growth' || metricKey === 'earnings_growth'
            ? 'yoy_change'
            : 'margin';

    // Let formatPercent apply the clamp: pre-clamping to null turned a
    // non-meaningful value into `n/a` instead of `n/m`.
    return CANONICAL_PERCENT_KEYS[metricKey]
        ? formatPercent(value, { decimals: 2, input: 'percent', clamp })
        : formatPercent(value, { decimals: 2, input: 'auto', clamp });
}

const ratioLabels: Record<string, string> = {
    pe: 'P/E',
    pb: 'P/B',
    ps: 'P/S',
    peg_ratio: 'PEG Ratio',
    ev_sales: 'EV/Sales',
    ev_ebitda: 'EV/EBITDA',
    current_ratio: 'Current Ratio',
    quick_ratio: 'Quick Ratio',
    cash_ratio: 'Cash Ratio',
    asset_turnover: 'Asset Turnover',
    inventory_turnover: 'Inventory Turnover',
    receivables_turnover: 'Receivables Turnover',
    loan_to_deposit: 'Loan/Deposit',
    casa_ratio: 'CASA Ratio',
    deposit_growth: 'Deposit Growth',
    nim: 'NIM',
    equity_to_assets: 'Equity/Assets',
    asset_yield: 'Asset Yield',
    credit_cost: 'Credit Cost',
    provision_coverage: 'Provision Coverage',
    gross_margin: 'Gross Margin',
    operating_margin: 'Operating Margin',
    net_margin: 'Net Margin',
    roe: 'ROE',
    roa: 'ROA',
    debt_equity: 'Debt/Equity',
    debt_assets: 'Debt/Assets',
    equity_multiplier: 'Equity Multiplier',
    interest_coverage: 'Interest Coverage',
    debt_service_coverage: 'Debt Service Coverage',
    ocf_debt: 'OCF/Debt',
    fcf_yield: 'FCF Yield',
    ocf_sales: 'OCF/Sales',
    revenue_growth: 'Revenue Growth',
    earnings_growth: 'Earnings Growth',
    dividend_yield: 'Dividend Yield',
    payout_ratio: 'Payout Ratio',
};

const TABLE_YEAR_LIMIT = 20;
const QUARTER_PERIOD_LIMIT = 40;
const STATEMENT_PERIOD_OPTIONS = ['FY', 'Q', 'TTM'] as const;

const categories = [
    { id: 'valuation', label: 'Valuation', metrics: ['pe', 'pb', 'ps', 'ev_sales', 'ev_ebitda', 'peg_ratio'] },
    { id: 'per-share', label: 'Per share', metrics: PER_SHARE_METRICS },
    { id: 'liquidity', label: 'Liquidity', metrics: ['current_ratio', 'quick_ratio', 'cash_ratio'] },
    { id: 'efficiency', label: 'Efficiency', metrics: ['asset_turnover', 'inventory_turnover', 'receivables_turnover'] },
    { id: 'banking', label: 'Banking', metrics: [
        'loan_to_deposit', 'casa_ratio', 'deposit_growth', 'nim',
        'equity_to_assets', 'asset_yield', 'credit_cost', 'provision_coverage',
    ] },
    { id: 'profitability', label: 'Profitability', metrics: ['gross_margin', 'operating_margin', 'net_margin', 'roe', 'roa'] },
    { id: 'leverage', label: 'Leverage', metrics: ['debt_equity', 'debt_assets', 'equity_multiplier'] },
    { id: 'coverage', label: 'Coverage', metrics: ['interest_coverage', 'debt_service_coverage'] },
    { id: 'ocf', label: 'Operating cash flow', metrics: ['ocf_debt', 'fcf_yield', 'ocf_sales'] },
    { id: 'growth', label: 'Growth', metrics: ['revenue_growth', 'earnings_growth'] },
    { id: 'dividend', label: 'Dividend', metrics: ['dividend_yield', 'payout_ratio'] },
] as const;

function FinancialRatiosWidgetComponent({ id, symbol, config, isEditing, onRemove, onDataChange }: FinancialRatiosWidgetProps) {
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
        widgetId: id || 'financial_ratios',
        defaultPeriod,
        validPeriods: [...STATEMENT_PERIOD_OPTIONS],
        sharedKey: periodSyncGroup ? `${periodSyncGroup}:${symbol.toUpperCase()}` : undefined,
    });
    const showPeriodToggle = config?.hidePeriodToggle !== true;
    
    const apiPeriod = period === 'Q' ? 'Q' : period;
    const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';
    const visiblePeriodLimit = period === 'Q' ? QUARTER_PERIOD_LIMIT : TABLE_YEAR_LIMIT;

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useFinancialRatios(symbol, { period: apiPeriod, enabled: period !== 'TTM' });
    const { config: unitConfig } = useUnit();
    // Request the same period and limit as the adjacent statement widget: on
    // some provider responses the available fiscal years vary with the limit.
    // This feed supplies headings only; ratio rows supply all metric values.
    const statementReferenceQuery = useIncomeStatement(symbol, {
        period: period === 'Q' ? 'quarter' : 'year',
        enabled: period !== 'TTM',
        limit: visiblePeriodLimit,
    });

    const rawRatios = useMemo(() => period === 'TTM' ? [] : data?.data || [], [period, data?.data]);
    const canonicalRatios = useMemo(() => canonicalPeriodRows(rawRatios), [rawRatios]);
    const ratios = useMemo(() => canonicalRatios.rows
        .flatMap((entry) => {
            const label = normalizeFinancialPeriod(entry.period);
            return label && matchesFinancialPeriodMode(label, periodMode) ? [{ ...entry, period: label }] : [];
        })
        .sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period)),
        [canonicalRatios.rows, periodMode]);
    const { exportData, perShareUnit, readValue, units } = useMemo(
        () => projectFinancialRatios(ratios, unitConfig),
        [ratios, unitConfig],
    );

    // Columns are exactly the statement panels' window, so the same period selector shows
    // the same headings in every panel — including "2026 YTD", which the ratio feed cannot
    // fill and therefore renders as empty cells. The ratio feed is a value lookup for those
    // headings and only becomes the period source when the reference series is unavailable.
    const displayPeriods = useMemo(() => {
        if (period === 'TTM') return [];
        const referencePeriods = new Set<string>();
        for (const entry of statementReferenceQuery.data?.data ?? []) {
            const label = normalizeFinancialPeriod(entry.period);
            if (label && matchesFinancialPeriodMode(label, periodMode)) referencePeriods.add(label);
        }
        return referencePeriods.size > 0
            ? [...referencePeriods].sort((left, right) => periodSortKey(left) - periodSortKey(right)).slice(-visiblePeriodLimit)
            : ratios.map((entry) => entry.period);
    }, [period, periodMode, ratios, statementReferenceQuery.data?.data, visiblePeriodLimit]);

    const hasData = ratios.length > 0;
    const responseWarning = period === 'TTM' ? null : data?.error || null;
    const refreshWarning = error?.message || responseWarning;
    const isFallback = Boolean((error || responseWarning) && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);

    useEffect(() => {
        onDataChange?.(
            buildWidgetRuntime({
                empty: !hasData,
                apiGroup: '/equity',
                endpoint: `/equity/${symbol}/ratios?period=${apiPeriod}`,
                sourceLabel: 'Financial ratios',
                lastDataDate: null,
                fetchedAt: dataUpdatedAt,
                stale: isFallback,
                warnings: refreshWarning ? [refreshWarning] : undefined,
                period,
                periodScope: periodSyncGroup ? 'shared' : 'local',
                observationStatus: period === 'TTM' ? 'unsupported' : hasData ? 'available' : isLoading ? 'loading' : refreshWarning ? 'unavailable' : 'empty',
                units,
                exportData,
                extra: hasData ? { periods: ratios.length, data: exportData } : undefined,
            }),
        );
    }, [onDataChange, hasData, isFallback, isLoading, refreshWarning, dataUpdatedAt, symbol, apiPeriod, period, periodSyncGroup, ratios.length, exportData, units]);

    const percentKeys = new Set([
        'gross_margin',
        'operating_margin',
        'net_margin',
        'roe',
        'roa',
        'debt_assets',
        'fcf_yield',
        'ocf_sales',
        'revenue_growth',
        'earnings_growth',
        'dividend_yield',
        'payout_ratio',
        'deposit_growth',
        'casa_ratio',
        'nim',
        'equity_to_assets',
        'asset_yield',
        'credit_cost',
        'provision_coverage',
    ]);

    const headerActions = showPeriodToggle ? (
        <div className="mr-1">
            <PeriodToggle value={period} onChange={setPeriod} compact options={[...STATEMENT_PERIOD_OPTIONS]} />
        </div>
    ) : undefined;

    // `displayPeriods` is already ordered and windowed, so the tail slice only guards a
    // limit smaller than the window the reference query was asked for.
    const visiblePeriods = useMemo(
        () => displayPeriods.slice(-visiblePeriodLimit),
        [displayPeriods, visiblePeriodLimit]
    );

    const ratioLookup = useMemo(
        () => new Map(ratios.map((entry) => [entry.period, entry])),
        [ratios]
    );

    const tableColumns = useMemo(
        () =>
            visiblePeriods.map((periodValue, index) => ({
                key: periodValue ?? `period_${index}`,
                label: formatFinancialPeriodLabel(periodValue, { mode: periodMode }),
                align: 'right' as const,
            })),
        [periodMode, visiblePeriods]
    );

    const tableRows = useMemo<DenseTableRow[]>(() => {
        const rows: DenseTableRow[] = [];

        // A "2026 YTD" column has no ratio row of its own, so its cells stay empty rather
        // than borrowing the closed year's values and inventing a fiscal year.
        for (const category of categories) {
            const groupId = `group:${category.id}`;
            const metricRows: DenseTableRow[] = [];
            for (const metricKey of category.metrics) {
                const cells = tableColumns.map(({ key }) => [key, readValue(ratioLookup.get(key), metricKey)] as const);
                if (!cells.some(([, value]) => value !== null)) continue;
                metricRows.push({
                    id: metricKey,
                    label: isPerShareMetric(metricKey) ? `${metricKey.toUpperCase()} (${perShareUnit})` : ratioLabels[metricKey] || metricKey,
                    parentId: groupId,
                    indent: 12,
                    values: Object.fromEntries(cells),
                });
            }
            if (metricRows.length) rows.push({ id: groupId, label: category.label, values: {}, isGroup: true }, ...metricRows);
        }
        return rows;
    }, [perShareUnit, ratioLookup, readValue, tableColumns]);

    const dataQualityWarnings = useMemo(() => {
        const warnings: string[] = [];
        const missingGrossMarginPeriods = visiblePeriods.filter((periodValue) => {
            const entry = ratioLookup.get(periodValue);
            return entry && entry.gross_margin == null && entry.operating_margin != null;
        });
        if (missingGrossMarginPeriods.length > 0) {
            warnings.push(`Gross Margin is missing for ${missingGrossMarginPeriods.slice(0, 3).join(', ')}${missingGrossMarginPeriods.length > 3 ? '...' : ''} while Operating Margin is present.`);
        }

        const addSwingWarnings = (metricKey: 'ps' | 'ev_sales', label: string) => {
            const values = visiblePeriods
                .filter((periodValue) => ratioLookup.has(periodValue))
                .map((periodValue) => ({ period: periodValue, value: readValue(ratioLookup.get(periodValue), metricKey) }))
                .filter((item): item is { period: string; value: number } => typeof item.value === 'number' && Number.isFinite(item.value) && item.value > 0);
            for (let index = 1; index < values.length; index += 1) {
                const previous = values[index - 1];
                const current = values[index];
                const multiple = Math.max(previous.value, current.value) / Math.max(Math.min(previous.value, current.value), 0.000001);
                if (multiple >= 50) {
                    warnings.push(`${label} changes ${multiple.toFixed(0)}x from ${previous.period} to ${current.period}; validate provider units/denominators.`);
                    break;
                }
            }
        };

        addSwingWarnings('ps', 'P/S');
        addSwingWarnings('ev_sales', 'EV/Sales');
        return warnings.slice(0, 3);
    }, [ratioLookup, readValue, visiblePeriods]);

    return (
        <WidgetContainer
            title="Financial Ratios"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            headerActions={headerActions}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={exportData}
            exportFilename={`ratios_${symbol}_${period}`}
        >
            <div className="h-full flex flex-col">
                <div className="px-2 py-1.5 border-b border-[var(--border-subtle)]">
                    <WidgetMeta
                        updatedAt={null}
                        fetchedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={period === 'FY' ? 'Annual · newest on right' : period === 'TTM' ? 'TTM · unsupported' : 'Quarterly · newest on right'}
                        align="right"
                    />
                </div>
                {refreshWarning && hasData && (
                    <div role="alert" className="border-b border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                        {refreshWarning}
                    </div>
                )}
                {(canonicalRatios.issues.length > 0 || canonicalRatios.invalidPeriodCount > 0) && (
                    <div className="px-3 py-1.5 text-[10px] text-[var(--color-warning)]">
                        Fiscal period resolution: {canonicalRatios.issues.filter((issue) => issue.reason === 'ambiguous-basis').length} conflicting periods excluded; {canonicalRatios.issues.filter((issue) => issue.reason === 'duplicate-identical').length} identical repeats collapsed; {canonicalRatios.invalidPeriodCount} undated rows excluded.
                    </div>
                )}
                {(() => {
                    // QA-v2 F1: surface a coverage hint when the backend
                    // tells us full ratio coverage starts after the
                    // earliest visible period. Pre-2020 KBS rows usually
                    // only carry valuation ratios (P/E, P/B, P/S,
                    // EV/EBITDA); profitability/liquidity/efficiency
                    // require raw financial statements that don't exist
                    // for those years yet, so we tell users instead of
                    // pretending the data is missing at random.
                    const coverageStarts = (data?.meta as { full_ratio_coverage_starts?: string | null } | undefined)?.full_ratio_coverage_starts;
                    if (!coverageStarts || !visiblePeriods.length) return null;
                    const earliestVisible = visiblePeriods[0];
                    if (!earliestVisible) return null;
                    if (periodSortKey(earliestVisible) >= periodSortKey(coverageStarts)) return null;
                    return (
                        <div className="border-b border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)]/85">
                            Full ratio coverage starts {coverageStarts}. Earlier periods only have valuation metrics (P/E, P/B, P/S, EV/EBITDA) until raw financial statements are backfilled.
                        </div>
                    );
                })()}
                <div className="flex-1 overflow-auto px-2 pt-1 scrollbar-hide">
                    {period === 'TTM' ? (
                        <WidgetEmpty
                            message="TTM ratios are not supported"
                            detail="The provider does not supply ratios recomputed from a verified twelve-month window. Latest-period ratios and EPS/DPS sums are not shown as TTM. Select FY or Q."
                            icon={<BarChart3 size={18} />}
                        />
                    ) : timedOut && isLoading && !hasData ? (
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
                    ) : (error || responseWarning) && !hasData ? (
                        <WidgetError error={(error as Error) || new Error(responseWarning!)} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty message={`No ratio data for ${symbol}`} icon={<BarChart3 size={18} />} />
                    ) : tableRows.length === 0 ? (
                        <WidgetEmpty
                            message={`No renderable ratio metrics for ${symbol}`}
                            detail={`${period} ratio rows loaded, but all tracked metrics are empty in the current response.`}
                            icon={<BarChart3 size={18} />}
                        />
                    ) : (
                        <>
                            {dataQualityWarnings.length > 0 && (
                                <div className="mb-2 rounded-lg border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                                    <div className="font-black uppercase tracking-[0.16em] text-[var(--text-secondary)]">Data quality notes</div>
                                    {dataQualityWarnings.map((warning) => (
                                        <div key={warning}>{warning}</div>
                                    ))}
                                </div>
                            )}
                            <DenseFinancialTable
                                columns={tableColumns}
                                rows={tableRows}
                                sortable
                                showTrend={false}
                                maxYears={tableColumns.length || 1}
                                initialScrollPosition="end"
                                storageKey={`ratios:${id}:${symbol}:${period}`}
                                footerNote={`Note: Ratio history by ${period}. Dimensionless ratios are not currency-converted. First available period is the base period; missing ratios render as ${EMPTY_VALUE}.`}
                                valueFormatter={(value, row) => {
                                    const numeric = typeof value === 'number' ? value : null;
                                    return percentKeys.has(row.id) ? formatPct(row.id, numeric) : formatRatio(numeric);
                                }}
                            />
                        </>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const FinancialRatiosWidget = memo(FinancialRatiosWidgetComponent);
export default FinancialRatiosWidget;
