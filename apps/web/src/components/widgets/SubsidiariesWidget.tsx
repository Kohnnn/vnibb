// Subsidiaries Widget - Company subsidiaries and affiliates

'use client';

import { Building } from 'lucide-react';
import { useSubsidiaries } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface SubsidiariesWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatCapital(value: number | null | undefined): string {
    if (!value) return '-';
    if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T VND`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B VND`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(0)}M VND`;
    return `${value.toLocaleString()} VND`;
}

function formatPct(pct: number | null | undefined): string {
    if (pct === null || pct === undefined) return '-';
    return `${pct.toFixed(1)}%`;
}

export function SubsidiariesWidget({ symbol }: SubsidiariesWidgetProps) {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSubsidiaries(symbol, !!symbol);

    const subsidiaries = data?.data || [];
    const hasData = subsidiaries.length > 0;
    const isFallback = Boolean(error && hasData);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view subsidiaries" icon={<Building size={18} />} />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-gray-800/50">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Building size={12} />
                    <span>{subsidiaries.length} subsidiaries</span>
                </div>
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={4} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No subsidiaries data" icon={<Building size={18} />} />
                ) : (
                    subsidiaries.map((sub, index) => (
                        <div
                            key={index}
                            className="p-2 rounded bg-gray-800/20 hover:bg-gray-800/40"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-gray-200 font-medium truncate" title={sub.company_name || ''}>
                                        {sub.company_name || 'Unnamed'}
                                    </p>
                                    {sub.charter_capital && (
                                        <p className="text-[10px] text-gray-500 mt-0.5">
                                            Capital: {formatCapital(sub.charter_capital)}
                                        </p>
                                    )}
                                </div>
                                <div
                                    className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                                        (sub.ownership_pct || 0) >= 50
                                            ? 'bg-blue-500/20 text-blue-400'
                                            : 'bg-gray-500/20 text-gray-400'
                                    }`}
                                >
                                    {formatPct(sub.ownership_pct)}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
