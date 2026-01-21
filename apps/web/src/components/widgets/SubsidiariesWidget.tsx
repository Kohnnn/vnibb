// Subsidiaries Widget - Company subsidiaries and affiliates

'use client';

import { Building, RefreshCw } from 'lucide-react';
import { useSubsidiaries } from '@/lib/queries';

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
    return value.toLocaleString() + ' VND';
}

function formatPct(pct: number | null | undefined): string {
    if (pct === null || pct === undefined) return '-';
    return `${pct.toFixed(1)}%`;
}

export function SubsidiariesWidget({ symbol, isEditing, onRemove }: SubsidiariesWidgetProps) {
    const { data, isLoading, refetch, isRefetching } = useSubsidiaries(symbol);

    const subsidiaries = data?.data || [];

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Building size={12} />
                    <span>{subsidiaries.length} subsidiaries</span>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isRefetching}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
                >
                    <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Subsidiaries List */}
            <div className="flex-1 overflow-y-auto space-y-1">
                {isLoading ? (
                    <div className="space-y-2">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="animate-pulse p-2 bg-gray-800/30 rounded">
                                <div className="h-4 bg-gray-800 rounded w-3/4 mb-1" />
                                <div className="h-3 bg-gray-800 rounded w-1/2" />
                            </div>
                        ))}
                    </div>
                ) : subsidiaries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                        <Building size={24} className="mb-2 opacity-30" />
                        <p className="text-xs">No subsidiaries data</p>
                    </div>
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
                                <div className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${(sub.ownership_pct || 0) >= 50
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-gray-500/20 text-gray-400'
                                    }`}>
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
