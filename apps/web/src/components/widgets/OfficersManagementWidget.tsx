// Officers/Management Widget - Company leadership

'use client';

import { UserCircle, RefreshCw, Briefcase } from 'lucide-react';
import { useOfficers } from '@/lib/queries';

interface OfficersManagementWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatShares(shares: number | null | undefined): string {
    if (!shares) return '-';
    if (shares >= 1e6) return `${(shares / 1e6).toFixed(2)}M`;
    if (shares >= 1e3) return `${(shares / 1e3).toFixed(1)}K`;
    return shares.toLocaleString();
}

export function OfficersManagementWidget({ symbol, isEditing, onRemove }: OfficersManagementWidgetProps) {
    const { data, isLoading, refetch, isRefetching } = useOfficers(symbol);

    const officers = data?.data || [];

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-1 py-1 mb-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Briefcase size={12} />
                    <span>{officers.length} executives</span>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isRefetching}
                    className="p-1 text-gray-500 hover:text-white hover:bg-gray-800 rounded transition-colors"
                >
                    <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Officers List */}
            <div className="flex-1 overflow-y-auto space-y-1">
                {isLoading ? (
                    <div className="space-y-2">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="animate-pulse p-2 bg-gray-800/30 rounded">
                                <div className="h-4 bg-gray-800 rounded w-3/4 mb-1" />
                                <div className="h-3 bg-gray-800 rounded w-1/2" />
                            </div>
                        ))}
                    </div>
                ) : officers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                        <Briefcase size={24} className="mb-2 opacity-30" />
                        <p className="text-xs">No officers data</p>
                    </div>
                ) : (
                    officers.map((officer, index) => (
                        <div
                            key={index}
                            className="flex items-start gap-2 p-2 rounded bg-gray-800/20 hover:bg-gray-800/40"
                        >
                            <div className="p-1.5 bg-blue-500/10 rounded-full">
                                <UserCircle size={16} className="text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-200 font-medium truncate">
                                    {officer.name || 'Unknown'}
                                </p>
                                <p className="text-xs text-gray-500 truncate">
                                    {officer.position || 'Executive'}
                                </p>
                                {officer.shares_owned && (
                                    <p className="text-[10px] text-gray-600 mt-0.5">
                                        Owns: {formatShares(officer.shares_owned)} shares
                                    </p>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
