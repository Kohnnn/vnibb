// Major Shareholders Widget - Ownership structure

'use client';

import { Users, Building2, User, Globe } from 'lucide-react';
import { useShareholders } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface MajorShareholdersWidgetProps {
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
}

function formatShares(shares: number | null | undefined): string {
    if (shares === null || shares === undefined || Number.isNaN(shares)) return '-';
    if (shares >= 1e9) return `${(shares / 1e9).toFixed(2)}B`;
    if (shares >= 1e6) return `${(shares / 1e6).toFixed(2)}M`;
    if (shares >= 1e3) return `${(shares / 1e3).toFixed(1)}K`;
    return shares.toLocaleString();
}

function formatPct(pct: number | null | undefined): string {
    if (pct === null || pct === undefined || Number.isNaN(pct)) return '-';
    const normalized = Math.abs(pct) <= 1 ? pct * 100 : pct;
    return `${normalized.toFixed(2)}%`;
}

function getTypeIcon(type: string | null | undefined) {
    if (!type) return User;
    const lower = type.toLowerCase();
    if (lower.includes('state') || lower.includes('foreign')) return Globe;
    if (lower.includes('institution') || lower.includes('fund')) return Building2;
    return User;
}

export function MajorShareholdersWidget({ symbol }: MajorShareholdersWidgetProps) {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useShareholders(symbol, !!symbol);

    const shareholders = data?.data || [];
    const hasData = shareholders.length > 0;
    const isFallback = Boolean(error && hasData);

    if (!symbol) {
        return <WidgetEmpty message="Select a symbol to view shareholders" icon={<Users size={18} />} />;
    }

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Users size={12} />
                    <span>{shareholders.length} shareholders</span>
                </div>
                <WidgetMeta
                    updatedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-y-auto pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={5} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No shareholders data" icon={<Users size={18} />} />
                ) : (
                    <table className="data-table w-full text-xs">
                        <thead className="text-[var(--text-muted)]">
                            <tr className="border-b border-[var(--border-color)]">
                                <th className="text-left py-1.5 px-1 font-medium">Shareholder</th>
                                <th className="text-right py-1.5 px-1 font-medium">Shares</th>
                                <th className="text-right py-1.5 px-1 font-medium">%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shareholders.map((sh, index) => {
                                const Icon = getTypeIcon(sh.shareholder_type);
                                return (
                                    <tr key={index} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]">
                                        <td className="py-1.5 px-1">
                                            <div className="flex items-center gap-1.5">
                                                <Icon size={12} className="text-blue-400 shrink-0" />
                                                <span className="max-w-[150px] truncate text-[var(--text-primary)]" title={sh.shareholder_name || ''}>
                                                    {sh.shareholder_name || 'Unknown'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="text-right py-1.5 px-1 text-[var(--text-secondary)]">
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
