// Financial Ratios Widget - Historical P/E, P/B, ROE, etc.
'use client';

import { useState, useMemo, memo } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { useFinancialRatios } from '@/lib/queries';
import { PeriodToggle, type Period } from '@/components/ui/PeriodToggle';
import { usePeriodState } from '@/hooks/usePeriodState';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
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

    const { data, isLoading, refetch, isRefetching } = useFinancialRatios(symbol, { period: apiPeriod });

    const ratios = data?.data || [];

    const headerActions = (
        <div className="mr-2">
            <PeriodToggle value={period} onChange={setPeriod} compact />
        </div>
    );

    return (
        <WidgetContainer
            title="Financial Ratios"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading || isRefetching}
            headerActions={headerActions}
            noPadding
            widgetId={id}
            showLinkToggle
            exportData={ratios}
            exportFilename={`ratios_${symbol}_${period}`}
        >
            <div className="h-full flex flex-col">
                {/* Ratios Table */}
                <div className="flex-1 overflow-auto px-2 pt-1 scrollbar-hide">
                    {isLoading ? (
                        <div className="space-y-2 p-1">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="animate-pulse h-8 bg-gray-800/30 rounded" />
                            ))}
                        </div>
                    ) : ratios.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2 opacity-50 uppercase font-black text-[10px] tracking-widest">
                            <BarChart3 size={32} strokeWidth={1} />
                            No Ratio Data
                        </div>
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
                                {['pe', 'pb', 'roe', 'roa', 'eps', 'debt_equity', 'gross_margin', 'net_margin'].map((key) => (
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
