// Financial Ratios Widget - Historical P/E, P/B, ROE, etc.
'use client';

import { memo, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFinancialRatios } from '@/lib/queries';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { formatFinancialPeriodLabel, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { formatNumber, formatPercent } from '@/lib/units';
import { DenseFinancialTable, type DenseTableRow } from '@/components/ui/DenseFinancialTable';

interface FinancialRatiosWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatRatio(value: number | null | undefined, decimals = 2): string {
    return formatNumber(value, { decimals });
}

function formatPct(value: number | null | undefined): string {
    return formatPercent(value, { decimals: 2, input: 'percent' });
}

const ratioLabels: Record<string, string> = {
    pe: 'P/E',
    pb: 'P/B',
    ps: 'P/S',
    ev_sales: 'EV/Sales',
    ev_ebitda: 'EV/EBITDA',
    current_ratio: 'Current Ratio',
    quick_ratio: 'Quick Ratio',
    cash_ratio: 'Cash Ratio',
    asset_turnover: 'Asset Turnover',
    inventory_turnover: 'Inventory Turnover',
    receivables_turnover: 'Receivables Turnover',
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
};

const TABLE_YEAR_LIMIT = 10;

function FinancialRatiosWidgetComponent({ id, symbol, isEditing, onRemove }: FinancialRatiosWidgetProps) {
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'financial_ratios',
        defaultPeriod: 'FY',
    });
    
    const apiPeriod = period;
    const periodMode: FinancialPeriodMode = period === 'FY' ? 'year' : period === 'TTM' ? 'ttm' : 'quarter';

    const {
        data,
        isLoading,
        error,
        refetch,
        isFetching,
        dataUpdatedAt,
    } = useFinancialRatios(symbol, { period: apiPeriod });

    const ratios = data?.data || [];
    const hasData = ratios.length > 0;
    const isFallback = Boolean(error && hasData);
    const categoryMetrics = {
        valuation: ['pe', 'pb', 'ps', 'ev_sales', 'ev_ebitda'],
        liquidity: ['current_ratio', 'quick_ratio', 'cash_ratio'],
        efficiency: ['asset_turnover', 'inventory_turnover', 'receivables_turnover'],
        profitability: ['gross_margin', 'operating_margin', 'net_margin', 'roe', 'roa'],
        leverage: ['debt_equity', 'debt_assets', 'equity_multiplier'],
        coverage: ['interest_coverage', 'debt_service_coverage'],
        ocf: ['ocf_debt', 'fcf_yield', 'ocf_sales'],
    } as const;

    const categoryLabels: Record<keyof typeof categoryMetrics, string> = {
        valuation: 'Valuation',
        liquidity: 'Liquidity',
        efficiency: 'Efficiency',
        profitability: 'Profitability',
        leverage: 'Leverage',
        coverage: 'Coverage',
        ocf: 'Operating cash flow',
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
    ]);

    const headerActions = (
        <div className="mr-1">
            <PeriodToggle value={period} onChange={setPeriod} compact />
        </div>
    );

    const tableColumns = useMemo(
        () =>
            ratios.slice(0, TABLE_YEAR_LIMIT).map((entry, index) => ({
                key: entry.period ?? `period_${index}`,
                label: formatFinancialPeriodLabel(entry.period, {
                    mode: periodMode,
                    index,
                    total: Math.min(ratios.length, TABLE_YEAR_LIMIT),
                }),
                align: 'right' as const,
            })),
        [ratios, periodMode]
    );

    const tableRows = useMemo<DenseTableRow[]>(() => {
        const rows: DenseTableRow[] = [];

        Object.entries(categoryMetrics).forEach(([categoryKey, metricKeys]) => {
            const groupId = `group:${categoryKey}`;
            rows.push({
                id: groupId,
                label: categoryLabels[categoryKey as keyof typeof categoryLabels],
                values: {},
                isGroup: true,
            });

            metricKeys.forEach((metricKey) => {
                rows.push({
                    id: metricKey,
                    label: ratioLabels[metricKey] || metricKey,
                    parentId: groupId,
                    indent: 12,
                    values: Object.fromEntries(
                        ratios.slice(0, TABLE_YEAR_LIMIT).map((entry, index) => [
                            tableColumns[index]?.key ?? `period_${index}`,
                            entry[metricKey as keyof typeof entry],
                        ])
                    ),
                });
            });
        });

        return rows;
    }, [categoryLabels, categoryMetrics, ratios, tableColumns]);

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
                        note={period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : period}
                        align="right"
                    />
                </div>
                <div className="flex-1 overflow-auto px-2 pt-1 scrollbar-hide">
                    {isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty message={`No ratio data for ${symbol}`} icon={<BarChart3 size={18} />} />
                    ) : (
                        <DenseFinancialTable
                            columns={tableColumns}
                            rows={tableRows}
                            sortable
                            storageKey={`ratios:${id}:${symbol}:${period}`}
                            valueFormatter={(value, row) => {
                                const isPercentMetric = percentKeys.has(row.id);
                                return isPercentMetric
                                    ? formatPct(value as number | null | undefined)
                                    : formatRatio(value as number | null | undefined);
                            }}
                        />
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const FinancialRatiosWidget = memo(FinancialRatiosWidgetComponent);
export default FinancialRatiosWidget;
