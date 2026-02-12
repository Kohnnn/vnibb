// Financial Ratios Widget - Historical P/E, P/B, ROE, etc.
'use client';

import { useState, memo } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFinancialRatios } from '@/lib/queries';
import { PeriodToggle } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { cn } from '@/lib/utils';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatFinancialPeriodLabel, type FinancialPeriodMode } from '@/lib/financialPeriods';
import { formatNumber, formatPercent } from '@/lib/units';

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
    const [activeCategory, setActiveCategory] = useState<
        'valuation' | 'liquidity' | 'efficiency' | 'profitability' | 'leverage' | 'coverage' | 'ocf'
    >('valuation');

    const categoryMetrics: Record<typeof activeCategory, string[]> = {
        valuation: ['pe', 'pb', 'ps', 'ev_sales', 'ev_ebitda'],
        liquidity: ['current_ratio', 'quick_ratio', 'cash_ratio'],
        efficiency: ['asset_turnover', 'inventory_turnover', 'receivables_turnover'],
        profitability: ['gross_margin', 'operating_margin', 'net_margin', 'roe', 'roa'],
        leverage: ['debt_equity', 'debt_assets', 'equity_multiplier'],
        coverage: ['interest_coverage', 'debt_service_coverage'],
        ocf: ['ocf_debt', 'fcf_yield', 'ocf_sales'],
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
                <div className="px-2 py-1.5 border-b border-gray-800/50">
                    <WidgetMeta
                        updatedAt={dataUpdatedAt}
                        isFetching={isFetching && hasData}
                        isCached={isFallback}
                        note={period === 'FY' ? 'Annual' : period === 'TTM' ? 'TTM' : period}
                        align="right"
                    />
                    <div className="mt-1 flex gap-1">
                        {[
                            { id: 'valuation', label: 'Valuation' },
                            { id: 'liquidity', label: 'Liquidity' },
                            { id: 'efficiency', label: 'Efficiency' },
                            { id: 'profitability', label: 'Profitability' },
                            { id: 'leverage', label: 'Leverage' },
                            { id: 'coverage', label: 'Coverage' },
                            { id: 'ocf', label: 'Operating CF' },
                        ].map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id as typeof activeCategory)}
                                className={cn(
                                    'px-2 py-0.5 text-[10px] font-bold rounded transition-colors',
                                    activeCategory === cat.id
                                        ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                                        : 'text-gray-500 hover:text-gray-300 border border-transparent'
                                )}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex-1 overflow-auto px-2 pt-1 scrollbar-hide">
                    {isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : error && !hasData ? (
                        <WidgetError error={error as Error} onRetry={() => refetch()} />
                    ) : !hasData ? (
                        <WidgetEmpty message={`No ratio data for ${symbol}`} icon={<BarChart3 size={18} />} />
                    ) : (
                        <table className="data-table financial-dense freeze-first-col w-full text-[11px] text-left">
                            <thead className="text-gray-500 sticky top-0 bg-[#0a0a0a] z-10">
                                <tr className="border-b border-gray-800">
                                    <th className="py-2 px-1 font-bold uppercase tracking-tighter">Metric</th>
                                    {ratios.slice(0, 4).map((r, i) => (
                                        <th key={`${r.period ?? i}-${i}`} className="text-right py-2 px-1 font-bold">
                                            {formatFinancialPeriodLabel(r.period, {
                                                mode: periodMode,
                                                index: i,
                                                total: Math.min(ratios.length, 4),
                                            })}
                                        </th>
                                    ))}
                                    <th className="py-2 px-1 font-bold uppercase tracking-tighter text-center">Trend</th>
                                </tr>
                            </thead>
                            <tbody>
                                {categoryMetrics[activeCategory].map((key) => {
                                    const points = ratios
                                        .slice(0, 4)
                                        .slice()
                                        .reverse()
                                        .map((r) => Number(r[key as keyof typeof r]))
                                        .filter((value) => Number.isFinite(value));

                                    return (
                                        <tr key={key} className="border-b border-gray-800/30 hover:bg-white/5 transition-colors group">
                                            <td className="py-2 px-1 text-gray-400 font-medium group-hover:text-gray-200">
                                                {ratioLabels[key] || key}
                                            </td>
                                            {ratios.slice(0, 4).map((r, i) => {
                                                const value = r[key as keyof typeof r] as number | null;
                                                const isPct = percentKeys.has(key);

                                                return (
                                                    <td key={i} data-type="number" className="text-right py-2 px-1 text-white font-mono">
                                                        {isPct ? formatPct(value) : formatRatio(value)}
                                                    </td>
                                                );
                                            })}
                                            <td className="py-2 px-1 text-center">
                                                {points.length < 2 ? (
                                                    <span className="text-[10px] text-muted-foreground">—</span>
                                                ) : (
                                                    <Sparkline data={points} width={70} height={18} />
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </WidgetContainer>
    );
}

export const FinancialRatiosWidget = memo(FinancialRatiosWidgetComponent);
export default FinancialRatiosWidget;
