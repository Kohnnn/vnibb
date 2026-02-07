// Financial Ratios Widget - Historical P/E, P/B, ROE, etc.
'use client';

import { useState, useMemo, memo } from 'react';
import { BarChart3 } from 'lucide-react';
import { useFinancialRatios } from '@/lib/queries';
import { PeriodToggle, type Period } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { cn } from '@/lib/utils';

interface FinancialRatiosWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatRatio(value: number | null | undefined, decimals = 2): string {
    if (value === null || value === undefined) return '-';
    return value.toFixed(decimals);
}

function formatPct(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(2)}%`;
}

const ratioLabels: Record<string, string> = {
    pe: 'P/E',
    pb: 'P/B',
    ps: 'P/S',
    roe: 'ROE',
    roa: 'ROA',
    eps: 'EPS',
    bvps: 'BVPS',
    debt_equity: 'D/E',
    current_ratio: 'Current',
    gross_margin: 'Gross Margin',
    net_margin: 'Net Margin',
};

function FinancialRatiosWidgetComponent({ id, symbol, isEditing, onRemove }: FinancialRatiosWidgetProps) {
    const { period, setPeriod } = usePeriodState({
        widgetId: id || 'financial_ratios',
        defaultPeriod: 'FY',
    });
    
    // Map period to API period
    const apiPeriod = useMemo(() => {
        if (period === 'FY') return 'year';
        return period;
    }, [period]);

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
    const [activeCategory, setActiveCategory] = useState<'valuation' | 'profitability' | 'health'>('valuation');

    const categoryMetrics: Record<'valuation' | 'profitability' | 'health', string[]> = {
        valuation: ['pe', 'pb', 'ps', 'eps', 'bvps'],
        profitability: ['roe', 'roa', 'gross_margin', 'net_margin'],
        health: ['debt_equity', 'current_ratio'],
    };

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
                        note={period === 'FY' ? 'Annual' : 'Quarterly'}
                        align="right"
                    />
                    <div className="mt-1 flex gap-1">
                        {[
                            { id: 'valuation', label: 'Valuation' },
                            { id: 'profitability', label: 'Profitability' },
                            { id: 'health', label: 'Health' },
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
                        <table className="w-full text-[11px] text-left">
                            <thead className="text-gray-500 sticky top-0 bg-[#0a0a0a] z-10">
                                <tr className="border-b border-gray-800">
                                    <th className="py-2 px-1 font-bold uppercase tracking-tighter">Metric</th>
                                    {ratios.slice(0, 4).map((r, i) => (
                                        <th key={i} className="text-right py-2 px-1 font-bold">
                                            {r.period || '-'}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {categoryMetrics[activeCategory].map((key) => (
                                    <tr key={key} className="border-b border-gray-800/30 hover:bg-white/5 transition-colors group">
                                        <td className="py-2 px-1 text-gray-400 font-medium group-hover:text-gray-200">
                                            {ratioLabels[key] || key}
                                        </td>
                                        {ratios.slice(0, 4).map((r, i) => {
                                            const value = r[key as keyof typeof r] as number | null;
                                            const isPct = key.includes('margin') || key === 'roe' || key === 'roa';

                                            return (
                                                <td key={i} className="text-right py-2 px-1 text-white font-mono">
                                                    {isPct ? formatPct(value) : formatRatio(value)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
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
