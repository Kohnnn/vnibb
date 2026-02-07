'use client';

import { memo, useMemo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { usePriceDepth } from '@/lib/queries';

interface OrderbookWidgetProps {
  symbol?: string;
  widgetId?: string;
}

function OrderbookWidgetComponent({ symbol = 'VNM', widgetId }: OrderbookWidgetProps) {
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
        <div className="px-3 py-2 border-b border-gray-800/60 bg-[#0a0a0a]">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Depth snapshot"
            align="right"
          />
        </div>

        <div className="flex text-[10px] font-bold text-gray-500 px-3 py-2 border-b border-gray-800 uppercase tracking-wider">
          <div className="w-1/3">Bid Vol</div>
          <div className="w-1/3 text-center">Price</div>
          <div className="w-1/3 text-right">Ask Vol</div>
        </div>

        <div className="flex-1 overflow-auto scrollbar-hide">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={6} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Order book data not available yet" />
          ) : (
            entries.map((entry: any, i: number) => (
              <div key={i} className="flex items-center px-3 py-1.5 relative border-b border-gray-800/20">
                <div
                  className="absolute left-0 top-0 h-full bg-green-500/10"
                  style={{ width: `${((entry.bid_vol || 0) / maxVolume) * 50}%` }}
                />
                <div
                  className="absolute right-0 top-0 h-full bg-red-500/10"
                  style={{ width: `${((entry.ask_vol || 0) / maxVolume) * 50}%` }}
                />

                <div className="w-1/3 text-xs text-green-400 font-mono relative z-10">
                  {entry.bid_vol?.toLocaleString() || '--'}
                </div>
                <div className="w-1/3 text-center text-xs text-white font-bold relative z-10">
                  {entry.price?.toLocaleString() || '--'}
                </div>
                <div className="w-1/3 text-right text-xs text-red-400 font-mono relative z-10">
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
