// Financial Ratios Widget - Historical P/E, P/B, ROE, etc.
'use client';

import { memo, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFinancialRatios, useIncomeStatement } from '@/lib/queries';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { formatFinancialPeriodLabel, periodSortKey, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { EMPTY_VALUE, formatNumber, formatPercent } from '@/lib/units';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';

interface FinancialRatiosWidgetProps {
    id: string;
    symbol: string;
    config?: Record<string, unknown>;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatRatio(value: number | null | undefined, decimals = 2): string {
    return formatNumber(value, { decimals });
}

function formatPct(metricKey: string, value: number | null | undefined): string {
    const clamp = metricKey === 'dividend_yield' || metricKey === 'fcf_yield'
        ? 'yield'
        : metricKey === 'revenue_growth' || metricKey === 'earnings_growth'
            ? 'yoy_change'
            : 'margin';

    return formatPercent(value, { decimals: 2, input: 'auto', clamp });
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

const TABLE_YEAR_LIMIT = 10;
const QUARTER_PERIOD_LIMIT = 28;
const NULL_LIKE_RATIO_KEYS = new Set(['pe', 'pb', 'ps', 'peg_ratio', 'ev_sales', 'ev_ebitda']);
const STATEMENT_PERIOD_OPTIONS = ['FY', 'Q', 'TTM'] as const;

const VALID_RATIO_PERIOD_RE = /^(?:20\d{2}(?:-Q[1-4])?|TTM)$/

function normalizeRatioPeriod(period: string | null | undefined): string | null {
    const cleaned = String(period ?? '').trim().toUpperCase()
    if (!cleaned) return null

    if (VALID_RATIO_PERIOD_RE.test(cleaned)) return cleaned

    const compactQuarter = cleaned.match(/^(20\d{2})Q([1-4])$/)
    if (compactQuarter) return `${compactQuarter[1]}-Q${compactQuarter[2]}`

    const slashQuarter = cleaned.match(/^Q([1-4])[-/](20\d{2})$/)
    if (slashQuarter) return `${slashQuarter[2]}-Q${slashQuarter[1]}`

    return null
}

function FinancialRatiosWidgetComponent({ id, symbol, config, isEditing, onRemove }: FinancialRatiosWidgetProps) {
    const periodSyncGroup = typeof config?.periodSyncGroup === 'string' ? config.periodSyncGroup : undefined;
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
    } = useFinancialRatios(symbol, { period: apiPeriod });
    const referencePeriodsQuery = useIncomeStatement(symbol, {
        period: period === 'FY' ? 'year' : period === 'Q' ? 'quarter' : 'TTM',
        enabled: period !== 'TTM',
        limit: visiblePeriodLimit,
    });

    const rawRatios = data?.data || [];
    const ratios = useMemo(() => {
        const seen = new Set<string>()

        return rawRatios
            .map((entry) => {
                const normalizedPeriod = normalizeRatioPeriod(entry?.period)
                if (!normalizedPeriod) return null
                return {
                    ...entry,
                    period: normalizedPeriod,
                }
            })
            .filter((entry): entry is NonNullable<typeof entry> => {
                if (!entry) return false
                if (seen.has(entry.period)) return false
                seen.add(entry.period)
                return true
            })
            .sort((left, right) => periodSortKey(left.period) - periodSortKey(right.period))
    }, [rawRatios]);
    const hasData = ratios.length > 0;
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData);
    const categoryMetrics = {
        valuation: ['pe', 'pb', 'ps', 'ev_sales', 'ev_ebitda', 'peg_ratio'],
        liquidity: ['current_ratio', 'quick_ratio', 'cash_ratio'],
        efficiency: ['asset_turnover', 'inventory_turnover', 'receivables_turnover'],
        banking: [
            'loan_to_deposit',
            'casa_ratio',
            'deposit_growth',
            'nim',
            'equity_to_assets',
            'asset_yield',
            'credit_cost',
            'provision_coverage',
        ],
        profitability: ['gross_margin', 'operating_margin', 'net_margin', 'roe', 'roa'],
        leverage: ['debt_equity', 'debt_assets', 'equity_multiplier'],
        coverage: ['interest_coverage', 'debt_service_coverage'],
        ocf: ['ocf_debt', 'fcf_yield', 'ocf_sales'],
        growth: ['revenue_growth', 'earnings_growth'],
        dividend: ['dividend_yield', 'payout_ratio'],
    } as const;

    const categoryLabels: Record<keyof typeof categoryMetrics, string> = {
        valuation: 'Valuation',
        liquidity: 'Liquidity',
        efficiency: 'Efficiency',
        banking: 'Banking',
        profitability: 'Profitability',
        leverage: 'Leverage',
        coverage: 'Coverage',
        ocf: 'Operating cash flow',
        growth: 'Growth',
        dividend: 'Dividend',
    };

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

    const displayPeriods = useMemo(() => {
        const periodSet = new Set<string>();
        ratios.forEach((entry) => {
            if (entry.period) periodSet.add(entry.period);
        });
        (referencePeriodsQuery.data?.data || []).forEach((entry) => {
            if (entry.period) {
                const normalizedPeriod = normalizeRatioPeriod(String(entry.period)) ?? String(entry.period);
                periodSet.add(normalizedPeriod);
            }
        });
        return Array.from(periodSet).sort((left, right) => periodSortKey(left) - periodSortKey(right));
    }, [ratios, referencePeriodsQuery.data?.data]);

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
                label: formatFinancialPeriodLabel(periodValue, {
                    mode: periodMode,
                    index,
                    total: visiblePeriods.length,
                }),
                align: 'right' as const,
            })),
        [periodMode, visiblePeriods]
    );

    const tableRows = useMemo<DenseTableRow[]>(() => {
        const rows: DenseTableRow[] = [];

        const hasMetricData = (metricKey: string) =>
            visiblePeriods.some((periodValue) => {
                const entry = ratioLookup.get(periodValue);
                const value = entry?.[metricKey as keyof typeof entry];
                return typeof value === 'number' && Number.isFinite(value);
            });

        Object.entries(categoryMetrics).forEach(([categoryKey, metricKeys]) => {
            const visibleMetricKeys = metricKeys.filter((metricKey) => hasMetricData(metricKey));
            if (visibleMetricKeys.length === 0) {
                return;
            }

            const groupId = `group:${categoryKey}`;
            rows.push({
                id: groupId,
                label: categoryLabels[categoryKey as keyof typeof categoryLabels],
                values: {},
                isGroup: true,
            });

            visibleMetricKeys.forEach((metricKey) => {
                rows.push({
                    id: metricKey,
                    label: ratioLabels[metricKey] || metricKey,
                    parentId: groupId,
                    indent: 12,
                    values: Object.fromEntries(
                        visiblePeriods.map((periodValue, index) => {
                            const entry = ratioLookup.get(periodValue);
                            return [
                                tableColumns[index]?.key ?? `period_${index}`,
                                entry?.[metricKey as keyof typeof entry] ?? null,
                            ];
                        })
                    ),
                });
            });
        });

        return rows;
    }, [categoryLabels, categoryMetrics, ratioLookup, tableColumns, visiblePeriods]);
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
            exportData={ratios}
            exportFilename={`ratios_${symbol}_${period}`}
        >
            <div className="h-full flex flex-col">
                <div className="px-2 py-1.5 border-b border-[var(--border-subtle)]">
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : 'Quarterly'}
                        align="right"
                    />
                </div>
                <div className="flex-1 overflow-auto px-2 pt-1 scrollbar-hide">
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
                        <WidgetEmpty message={`No ratio data for ${symbol}`} icon={<BarChart3 size={18} />} />
                    ) : (
                        <>
                            <DenseFinancialTable
                                columns={tableColumns}
                                rows={tableRows}
                                sortable
                                showTrend={false}
                                storageKey={`ratios:${id}:${symbol}:${period}`}
                                footerNote={`Note: Ratio history by ${period}. First available period is the base period; missing ratios render as ${EMPTY_VALUE}.`}
                                valueFormatter={(value, row) => {
                                    if (NULL_LIKE_RATIO_KEYS.has(row.id) && typeof value === 'number' && value === 0) {
                                        return EMPTY_VALUE;
                                    }
                                    const isPercentMetric = percentKeys.has(row.id);
                                    return isPercentMetric
                                        ? formatPct(row.id, value as number | null | undefined)
                                        : formatRatio(value as number | null | undefined);
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
