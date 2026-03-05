// Officers/Management Widget - Company leadership

'use client';

import { UserCircle, Briefcase } from 'lucide-react';
import { useOfficers } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

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

export function OfficersManagementWidget({ symbol }: OfficersManagementWidgetProps) {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useOfficers(symbol, !!symbol);

    const officers = data?.data || [];
    const hasData = officers.length > 0;
    const isFallback = Boolean(error && hasData);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view officers" icon={<Briefcase size={18} />} />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Briefcase size={12} />
                    <span>{officers.length} executives</span>
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
                    <WidgetSkeleton lines={5} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No officers data" icon={<Briefcase size={18} />} />
                ) : (
                    officers.map((officer, index) => (
                        <div
                            key={index}
                            className="flex items-start gap-2 rounded bg-[var(--bg-secondary)] p-2 hover:bg-[var(--bg-tertiary)]"
                        >
                            <div className="p-1.5 bg-blue-500/10 rounded-full">
                                <UserCircle size={16} className="text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                                    {officer.name || 'Unknown'}
                                </p>
                                <p className="truncate text-xs text-[var(--text-muted)]">
                                    {officer.position || 'Executive'}
                                </p>
                                {officer.shares_owned && (
                                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
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
