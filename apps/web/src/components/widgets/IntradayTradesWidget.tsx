'use client';

import { Activity, Clock } from 'lucide-react';
import { useIntraday } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { VirtualizedTable, type VirtualizedColumn } from '@/components/ui/VirtualizedTable';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { IntradayEmpty, IntradayStatus } from '@/components/ui/IntradayStatus';
import { useIntradayAvailability } from '@/hooks/useIntradayAvailability';
import { tradeTapeAsOf } from '@/lib/intradayAvailability';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import { priceColorClass } from '@/lib/priceColor';
import { memo, useEffect, useMemo } from 'react';
import type { IntradayTradeData } from '@/types/equity';

interface IntradayTradesWidgetProps {
    id: string;
    symbol: string;
    isEditing?: boolean;
    onRemove?: () => void;
    onDataChange?: (data: WidgetDataPayload) => void;
}

function formatTime(timeStr: string | null | undefined): string {
    if (!timeStr) return 'n/a';
    const clock = /(?:^|[T ])(\d{2}:\d{2}:\d{2})/.exec(timeStr)?.[1];
    return clock ?? timeStr;
}

function formatPrice(price: number | null | undefined): string {
    // A printed price of 0 is a real reading, not a missing one.
    if (price === null || price === undefined || !Number.isFinite(price)) return 'n/a';
    return price.toLocaleString('vi-VN');
}

function formatVolume(vol: number | null | undefined): string {
    // Zero volume is a measured zero (a no-fill print), not missing data.
    if (vol === null || vol === undefined || !Number.isFinite(vol)) return 'n/a';
    return vol.toLocaleString('vi-VN');
}

function IntradayTradesWidgetComponent({ id, symbol, onRemove, onDataChange }: IntradayTradesWidgetProps) {
    const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useIntraday(symbol, { limit: 1000 });

    const trades = useMemo(() => {
        const raw = data?.data || [];
        return [...raw].sort((a, b) => {
            const timeA = String(a.time || '');
            const timeB = String(b.time || '');
            return timeB.localeCompare(timeA);
        });
    }, [data]);
    const columns = useMemo((): VirtualizedColumn<IntradayTradeData>[] => [
        {
            id: 'time',
            header: 'Time',
            accessor: (row) => (
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                    <Clock size={10} className="opacity-50" />
                    {formatTime(row.time)}
                </div>
            ),
            width: 80,
        },
        {
            id: 'price',
            header: 'Price',
            accessor: (row) => (
                <span className="font-mono font-bold text-[var(--text-primary)]">{formatPrice(row.price)}</span>
            ),
            align: 'right',
            width: 80,
        },
        {
            id: 'volume',
            header: 'Volume',
            accessor: (row) => (
                <span className="font-mono text-[var(--text-secondary)]">{formatVolume(row.volume)}</span>
            ),
            align: 'right',
        },
        {
            id: 'type',
            header: 'Side',
            accessor: (row) => {
                const isBuy = row.match_type?.toUpperCase().includes('BU') ||
                    row.match_type?.toUpperCase().includes('B');
                const isSell = row.match_type?.toUpperCase().includes('SD') ||
                    row.match_type?.toUpperCase().includes('S');

                // Side is trading direction, so it uses the shared direction
                // tokens (which follow colour-vision mode). The B/S letter is
                // the primary signal; colour only reinforces it.
                const sideClass = isBuy ? priceColorClass(1) : isSell ? priceColorClass(-1) : priceColorClass(null);
                return (
                    <div className="flex justify-center">
                        {isBuy || isSell ? (
                            <span className={`text-[10px] font-black px-1 rounded ${sideClass} ${isBuy ? 'bg-price-up' : 'bg-price-down'}`}>
                                {isBuy ? 'B' : 'S'}
                            </span>
                        ) : (
                            <span className="text-[var(--text-muted)]">n/a</span>
                        )}
                    </div>
                );
            },
            align: 'center',
            width: 50,
        },
    ], []);

    const hasData = trades.length > 0;
    const legacyAsOf = useMemo(() => data?.meta?.feed ? null : tradeTapeAsOf(data), [data]);
    const availability = useIntradayAvailability({ response: data, error, hasData, isLoading, isFetching, dataUpdatedAt, legacyAsOf });

    useEffect(() => {
        onDataChange?.(buildWidgetRuntime({
            ...availability.runtime,
            empty: !hasData,
            compactHeight: 5,
            apiGroup: '/equity',
            endpoint: `/equity/${symbol}/intraday?limit=1000`,
            sourceLabel: availability.source ?? 'Intraday trade prints',
            exportData: hasData ? trades : undefined,
        }));
    }, [availability, hasData, onDataChange, symbol, trades]);

    return (
        <WidgetContainer
            title="Intraday Trades"
            symbol={symbol}
            onRefresh={() => refetch()}
            onClose={onRemove}
            isLoading={isLoading && !hasData}
            noPadding
            widgetId={id}
            showLinkToggle
        >
            <div className="h-full flex flex-col bg-[var(--bg-primary)]">
                <div className="border-b border-[var(--border-subtle)] px-3 py-2">
                    <IntradayStatus availability={availability} hasData={hasData} isFetching={isFetching} />
                </div>
                <div className="flex-1 overflow-hidden">
                    {isLoading && !hasData ? (
                        <WidgetSkeleton variant="table" lines={6} />
                    ) : !hasData ? (
                        <IntradayEmpty
                            availability={availability}
                            unavailable="Intraday trade data unavailable"
                            empty="No trade ticks returned"
                            detail="The response does not establish trade coverage for this symbol."
                            icon={<Activity size={18} />}
                            onRetry={() => refetch()}
                        />
                    ) : (
                        <VirtualizedTable data={trades} columns={columns} rowHeight={30} />
                    )}
                </div>

                {hasData ? (
                    <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-1.5">
                        <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-tighter text-[var(--text-muted)]">
                            <Activity size={10} />
                            {trades.length.toLocaleString()} ticks shown
                        </div>
                    </div>
                ) : null}
            </div>
        </WidgetContainer>
    );
}

export const IntradayTradesWidget = memo(IntradayTradesWidgetComponent);
export default IntradayTradesWidget;
