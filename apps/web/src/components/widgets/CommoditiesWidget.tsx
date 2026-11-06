'use client';

import { useEffect } from 'react';
import { Gem } from 'lucide-react';
import { useCommodities } from '@/lib/queries';
import { getLatestTimestampValue } from '@/lib/dataFreshness';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';

// Quotes are shown beside a 2dp spread, so rounding them to whole units made a
// 12.4 / 12.6 pair read as Buy 12, Sell 13, Spread +0.2. Keep the meaningful
// fractional digits and drop only trailing zeros.
function formatPrice(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// A spread is a price difference, so it keeps the sub-unit precision the
// quotes carry. The sign follows the rendered magnitude: 0.4 rounds to `0`
// and must not read as a negative.
function formatSpread(value: number): string {
    const magnitude = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (Number(magnitude.replace(/,/g, '')) === 0) return magnitude;
    return `${value > 0 ? '+' : '-'}${magnitude}`;
}

export function CommoditiesWidget({ onDataChange }: { onDataChange?: (data: WidgetDataPayload) => void }) {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useCommodities();

    const rows = data?.data || [];
    const sourceUpdatedAt = getLatestTimestampValue(rows.map((row) => row.time)) ?? null;
    const hasData = rows.length > 0;
    const isFallback = Boolean(data?.error);

    useEffect(() => {
        onDataChange?.({
            __widgetRuntime: {
                layoutHint: {
                    empty: !hasData,
                    compactHeight: 4,
                },
                provenance: {
                    updatedAt: sourceUpdatedAt,
                    fetchedAt: dataUpdatedAt || null,
                },
            },
        });
    }, [hasData, sourceUpdatedAt, dataUpdatedAt, onDataChange]);

    return (
        <div className="h-full flex flex-col">
            <div className="pb-2 border-b border-[var(--border-subtle)]">
                <WidgetMeta
                    updatedAt={sourceUpdatedAt}
                    fetchedAt={dataUpdatedAt}
                    isFetching={isFetching && hasData}
                    isCached={isFallback}
                    note={data?.source || 'vnstock'}
                    align="right"
                />
            </div>

            <div className="flex-1 overflow-auto space-y-1 pt-2">
                {isLoading && !hasData ? (
                    <WidgetSkeleton lines={6} />
                ) : error && !hasData ? (
                    <WidgetError error={error as Error} onRetry={() => refetch()} />
                ) : !hasData ? (
                    <WidgetEmpty message="No commodities data available" icon={<Gem size={18} />} />
                ) : (
                    rows.map((row, index) => {
                        // A missing quote is unavailable, not a zero spread.
                        const spread = row.sell_price != null && row.buy_price != null
                            ? row.sell_price - row.buy_price
                            : null;
                        return (
                            <div
                                key={`${row.source}-${row.symbol}-${index}`}
                                className="flex items-center justify-between p-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40"
                            >
                                <div className="min-w-0">
                                    <div className="break-words whitespace-normal text-xs font-semibold text-[var(--text-primary)]">
                                        {row.name || row.symbol || 'Commodity'}
                                    </div>
                                    <div className="text-[10px] text-[var(--text-muted)]">{row.source}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                                        Buy {formatPrice(row.buy_price)}
                                    </div>
                                    <div className="text-[11px] text-[var(--text-secondary)] font-mono">
                                        Sell {formatPrice(row.sell_price)}
                                    </div>
                                    <div className={`text-[10px] font-mono ${spread !== null && spread >= 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-negative)]'}`}>
                                        Spread {spread === null ? 'n/a' : formatSpread(spread)}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
