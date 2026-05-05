// Major Shareholders Widget - Ownership structure

'use client';

import { useEffect } from 'react';
import { Users, Building2, User, Globe } from 'lucide-react';
import { useShareholders } from '@/lib/queries';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';

interface MajorShareholdersWidgetProps {
    id?: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: unknown) => void;
}

function formatShares(shares: number | null | undefined): string {
    if (shares === null || shares === undefined || Number.isNaN(shares)) return 'Data unavailable';
    if (shares >= 1e9) return `${(shares / 1e9).toFixed(2)}B`;
    if (shares >= 1e6) return `${(shares / 1e6).toFixed(2)}M`;
    if (shares >= 1e3) return `${(shares / 1e3).toFixed(1)}K`;
    return shares.toLocaleString();
}

function formatPct(pct: number | null | undefined): string {
    if (pct === null || pct === undefined || Number.isNaN(pct)) return 'Data unavailable';
    return `${pct.toFixed(2)}%`;
}

function getTypeIcon(type: string | null | undefined) {
    if (!type) return User;
    const lower = type.toLowerCase();
    if (lower.includes('state') || lower.includes('foreign')) return Globe;
    if (lower.includes('institution') || lower.includes('fund')) return Building2;
    return User;
}

export function MajorShareholdersWidget({ symbol, onDataChange }: MajorShareholdersWidgetProps) {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useShareholders(symbol, !!symbol);

    const shareholders = data?.data || [];
    const ownershipValues = shareholders
        .map((holder) => {
            const value =
                holder.ownership_pct ??
                (holder as unknown as Record<string, number | null | undefined>).ownership ??
                (holder as unknown as Record<string, number | null | undefined>).share_own_percent;
            return typeof value === 'number' && Number.isFinite(value) ? value : null;
        })
        .filter((value): value is number => value !== null);
    const treatOwnershipAsRatio =
        ownershipValues.length > 0 && ownershipValues.every((value) => Math.abs(value) <= 1);
    const hasData = shareholders.length > 0;
    const hasMeaningfulData = shareholders.length >= 2;
    const isFallback = Boolean(error && hasData);
    const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

    useEffect(() => {
        onDataChange?.({
            __widgetRuntime: {
                layoutHint: {
                    empty: !hasMeaningfulData,
                    compactHeight: 3,
                },
            },
        });
    }, [hasMeaningfulData, onDataChange]);

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

            <div className="flex-1 overflow-auto pt-2">
                {timedOut && isLoading && !hasData ? (
                    <WidgetError
                        title="Loading timed out"
                        error={new Error('Ownership data took too long to load.')}
                        onRetry={() => {
                            resetTimeout();
                            refetch();
                        }}
                    />
                ) : isLoading && !hasData ? (
                    <WidgetSkeleton lines={5} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty
                        message={`Data pending for ${symbol}`}
                        detail="Ownership disclosures are still limited for this issuer."
                        icon={<Users size={18} />}
                        size="compact"
                    />
                ) : !hasMeaningfulData ? (
                    <WidgetEmpty
                        message={`Data pending for ${symbol}`}
                        detail="Ownership data is typically strongest for larger HOSE-listed issuers."
                        icon={<Users size={18} />}
                        size="compact"
                    />
                ) : (
                    <table className="data-table w-full table-fixed text-xs">
                        <thead className="text-[var(--text-muted)]">
                            <tr className="border-b border-[var(--border-color)]">
                                <th className="w-[55%] py-1.5 px-1 text-left font-medium">Shareholder</th>
                                <th className="w-[25%] py-1.5 px-1 text-right font-medium">Shares</th>
                                <th className="w-[20%] py-1.5 px-1 text-right font-medium">%</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shareholders.map((sh, index) => {
                                const row = sh as unknown as Record<string, string | number | null | undefined>;
                                const Icon = getTypeIcon(sh.shareholder_type);
                                const sharesOwned =
                                    sh.shares_owned ??
                                    (typeof row.shares === 'number' ? row.shares : null) ??
                                    (typeof row.quantity === 'number' ? row.quantity : null);
                                const ownershipPctRaw =
                                    sh.ownership_pct ??
                                    (typeof row.ownership === 'number' ? row.ownership : null) ??
                                    (typeof row.share_own_percent === 'number'
                                        ? row.share_own_percent
                                        : null);
                                const ownershipPct =
                                    ownershipPctRaw !== null &&
                                    ownershipPctRaw !== undefined &&
                                    treatOwnershipAsRatio
                                        ? ownershipPctRaw * 100
                                        : ownershipPctRaw;
                                const missingShares =
                                    sharesOwned === null ||
                                    sharesOwned === undefined ||
                                    Number.isNaN(Number(sharesOwned));
                                const missingOwnership =
                                    ownershipPct === null ||
                                    ownershipPct === undefined ||
                                    Number.isNaN(Number(ownershipPct));
                                return (
                                    <tr key={index} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]">
                                        <td className="py-1.5 px-1 align-top">
                                            <div className="flex items-start gap-1.5">
                                                <Icon size={12} className="text-blue-400 shrink-0" />
                                                <span className="break-words whitespace-normal text-[var(--text-primary)]" title={(sh.shareholder_name || row.name || row.share_holder || '') as string}>
                                                    {(sh.shareholder_name || row.name || row.share_holder || 'Unknown') as string}
                                                </span>
                                            </div>
                                        </td>
                                        <td className={`text-right py-1.5 px-1 ${missingShares ? 'text-[var(--text-muted)] text-[10px]' : 'text-[var(--text-secondary)]'}`}>
                                            {formatShares(sharesOwned as number | null | undefined)}
                                        </td>
                                        <td className={`text-right py-1.5 px-1 font-medium ${missingOwnership ? 'text-[var(--text-muted)] text-[10px]' : 'text-green-400'}`}>
                                            {formatPct(ownershipPct as number | null | undefined)}
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
