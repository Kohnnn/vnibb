'use client';

import { memo, useEffect, useMemo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { DEFAULT_TICKER } from '@/lib/defaultTicker';
import { usePriceDepth } from '@/lib/queries';

interface OrderbookWidgetProps {
  symbol?: string;
  widgetId?: string;
  onDataChange?: (data: unknown) => void;
}

function OrderbookWidgetComponent({ symbol = DEFAULT_TICKER, widgetId, onDataChange }: OrderbookWidgetProps) {
  const {
    data: orderbook,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = usePriceDepth(symbol, Boolean(symbol));

  const entries = (orderbook?.data?.entries || []) as any[];
  const hasData = entries.length > 0;
  const isFallback = Boolean(error && hasData);

  const maxVolume = useMemo(() => {
    if (entries.length === 0) return 1;
    return Math.max(
      ...entries.map((e: any) => Math.max(e.bid_vol || 0, e.ask_vol || 0))
    );
  }, [entries]);

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: {
          empty: !hasData,
          compactHeight: 4,
        },
      },
    });
  }, [hasData, onDataChange]);

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view order book" />;
  }

  return (
    <WidgetContainer
      title="Order Book"
      symbol={symbol}
      widgetId={widgetId}
      onRefresh={() => refetch()}
      noPadding
    >
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Depth snapshot"
            align="right"
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_74px_minmax(0,1fr)] gap-2 border-b border-[var(--border-color)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          <div>Bid Vol</div>
          <div className="text-center">Price</div>
          <div className="text-right">Ask Vol</div>
        </div>

        <div className="flex-1 overflow-auto scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={6} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty
              message="Order book data not available yet"
              detail="Market closed - showing this panel when the exchange publishes the next depth snapshot."
            />
          ) : (
            entries.map((entry: any, i: number) => (
              <div key={i} className="relative grid grid-cols-[minmax(0,1fr)_74px_minmax(0,1fr)] items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
                <div
                  className="absolute left-0 top-0 h-full bg-green-500/10"
                  style={{ width: `${((entry.bid_vol || 0) / maxVolume) * 50}%` }}
                />
                <div
                  className="absolute right-0 top-0 h-full bg-red-500/10"
                  style={{ width: `${((entry.ask_vol || 0) / maxVolume) * 50}%` }}
                />

                <div className="min-w-0 truncate text-xs text-green-400 font-mono relative z-10">
                  {entry.bid_vol?.toLocaleString() || '--'}
                </div>
                <div className="text-center text-xs text-[var(--text-primary)] font-bold relative z-10">
                  {entry.price?.toLocaleString() || '--'}
                </div>
                <div className="min-w-0 truncate text-right text-xs text-red-400 font-mono relative z-10">
                  {entry.ask_vol?.toLocaleString() || '--'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const OrderbookWidget = memo(OrderbookWidgetComponent);
export default OrderbookWidget;
