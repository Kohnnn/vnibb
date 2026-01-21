// Major Shareholders Widget - Ownership structure

'use client';

import { Users, RefreshCw, Building2, User, Globe } from 'lucide-react';
import { useShareholders } from '@/lib/queries';

interface MajorShareholdersWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatShares(shares: number | null | undefined): string {
    if (!shares) return '-';
    if (shares >= 1e9) return `${(shares / 1e9).toFixed(2)}B`;
    if (shares >= 1e6) return `${(shares / 1e6).toFixed(2)}M`;
    if (shares >= 1e3) return `${(shares / 1e3).toFixed(1)}K`;
    return shares.toLocaleString();
}

function formatPct(pct: number | null | undefined): string {
    if (pct === null || pct === undefined) return '-';
    return `${pct.toFixed(2)}%`;
}

function getTypeIcon(type: string | null | undefined) {
    if (!type) return User;
    const lower = type.toLowerCase();
    if (lower.includes('state') || lower.includes('foreign')) return Globe;
    if (lower.includes('institution') || lower.includes('fund')) return Building2;
    return User;
}

export function MajorShareholdersWidget({ symbol, isEditing, onRemove }: MajorShareholdersWidgetProps) {
    const { data, isLoading, refetch, isRefetching } = useShareholders(symbol);

    const shareholders = data?.data || [];

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Users size={12} />
                    <span>{shareholders.length} shareholders</span>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isRefetching}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
                >
                    <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Shareholders List */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="space-y-2">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="animate-pulse p-2 bg-gray-800/30 rounded">
                                <div className="h-4 bg-gray-800 rounded w-3/4 mb-1" />
                                <div className="h-3 bg-gray-800 rounded w-1/2" />
                            </div>
                        ))}
                    </div>
                ) : shareholders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                        <Users size={24} className="mb-2 opacity-30" />
                        <p className="text-xs">No shareholders data</p>
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="text-gray-500">
                            <tr className="border-b border-gray-800">
                                <th className="text-left py-1.5 px-1 font-medium">Shareholder</th>
                                <th className="text-right py-1.5 px-1 font-medium">Shares</th>
                                <th className="text-right py-1.5 px-1 font-medium">%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shareholders.map((sh, index) => {
                                const Icon = getTypeIcon(sh.shareholder_type);
                                return (
                                    <tr key={index} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                                        <td className="py-1.5 px-1">
                                            <div className="flex items-center gap-1.5">
                                                <Icon size={12} className="text-blue-400 shrink-0" />
                                                <span className="text-gray-200 truncate max-w-[150px]" title={sh.shareholder_name || ''}>
                                                    {sh.shareholder_name || 'Unknown'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="text-right py-1.5 px-1 text-gray-400">
                                            {formatShares(sh.shares_owned)}
                                        </td>
                                        <td className="text-right py-1.5 px-1 text-green-400 font-medium">
                                            {formatPct(sh.ownership_pct)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
