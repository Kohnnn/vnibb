'use client';

import { memo, useEffect, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty } from '@/components/ui/widget-states';
import { IntradayEmpty, IntradayStatus } from '@/components/ui/IntradayStatus';
import { displayedDepth, positiveDepthPrice } from '@/lib/intradayAvailability';
import { DEFAULT_TICKER } from '@/lib/defaultTicker';
import { usePriceDepth } from '@/lib/queries';
import { EMPTY_VALUE, formatNumber } from '@/lib/units';
import type { WidgetHealthState } from '@/lib/widgetHealth';
import { useIntradayAvailability } from '@/hooks/useIntradayAvailability';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';

interface OrderbookWidgetProps {
  symbol?: string;
  widgetId?: string;
  onDataChange?: (data: WidgetDataPayload) => void;
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

  const { entries, referenceOnly } = useMemo(() => displayedDepth(orderbook), [orderbook]);
  const lastPrice = positiveDepthPrice(orderbook?.data?.last_price);
  const legacyRetained = Boolean(!orderbook?.meta?.feed && orderbook?.data?.is_stale);
  const hasData = entries.length > 0;
  const hasGenuineData = hasData && !referenceOnly;
  const maxVolume = useMemo(() => entries.reduce(
    (max, entry) => Math.max(max, Number(entry.bid_vol) || 0, Number(entry.ask_vol) || 0), 1,
  ), [entries]);

  const availability = useIntradayAvailability({
    response: orderbook, error, hasData: hasGenuineData, isLoading, isFetching, dataUpdatedAt, legacyRetained,
  });
  const health: WidgetHealthState | undefined = referenceOnly ? {
    status: 'limited',
    label: 'Reference close',
    detail: 'The displayed prices use the latest close, not level-by-level bid/ask quotes.',
  } : undefined;

  const depthSeries = useMemo(() => {
    if (!hasGenuineData) return [];

    const normalized = entries
      .map((entry) => ({
        price: entry.price,
        bidVol: Number(entry.bid_vol) || 0,
        askVol: Number(entry.ask_vol) || 0,
      }))
      .sort((a, b) => a.price - b.price);

    let askRunning = 0;
    const askCumulative = normalized.map((entry) => {
      askRunning += entry.askVol;
      return askRunning;
    });

    let bidRunning = 0;
    const bidCumulative = new Array<number>(normalized.length).fill(0);
    for (let index = normalized.length - 1; index >= 0; index -= 1) {
      bidRunning += normalized[index].bidVol;
      bidCumulative[index] = bidRunning;
    }

    return normalized.map((entry, index) => ({
      price: entry.price,
      bidCumulative: bidCumulative[index],
      askCumulative: askCumulative[index],
    }));
  }, [entries, hasGenuineData]);

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      ...availability.runtime,
      empty: !hasData,
      compactHeight: 6,
      sourceLabel: availability.source ?? 'Order book depth',
      apiGroup: '/equity',
      endpoint: `/equity/${symbol}/orderbook`,
      basis: referenceOnly ? 'Retained close used as a reference, not a priced order book' : undefined,
      units: 'Price: thousand VND; volume: shares',
      exportData: hasData ? entries : undefined,
    }));
  }, [availability, entries, hasData, onDataChange, referenceOnly, symbol]);

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
          <IntradayStatus
            availability={availability}
            hasData={hasGenuineData}
            isFetching={isFetching}
            health={health}
            label={referenceOnly ? 'Reference pricing only' : undefined}
          />
        </div>

        {isLoading && !hasData ? (
          <WidgetSkeleton lines={6} />
        ) : !hasData ? (
          <IntradayEmpty
            availability={availability}
            unavailable="Order book data unavailable"
            empty="No priced depth returned"
            detail="This response does not establish order book coverage."
            allowZero={false}
            onRetry={() => refetch()}
          />
        ) : (
          <>
            <div className="border-b border-[var(--border-subtle)] px-3 py-3 bg-[var(--bg-primary)]">
              {referenceOnly ? (
                <div className="rounded-lg border border-[var(--color-state-border)] bg-[var(--color-state-bg)] px-2.5 py-2 text-[10px] leading-4 text-[var(--color-warning)]">
                  Provider depth did not include priced levels. The price column uses latest close as a reference, not live bid/ask depth.
                </div>
              ) : (
                <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <span>Cumulative Depth</span>
                  <span>{lastPrice !== null ? `Last ${formatNumber(lastPrice, { decimals: 0 })}` : `${entries.length} levels`}</span>
                </div>
              )}
              {!referenceOnly && (depthSeries.length < 2 ? (
                <div className="text-[10px] text-[var(--text-secondary)]">Need at least two levels to draw depth.</div>
              ) : (
                <ChartMountGuard className="h-[180px] min-h-[180px]" minHeight={180}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <AreaChart data={depthSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="orderbookBidFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-positive)" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="var(--color-positive)" stopOpacity={0.04} />
                        </linearGradient>
                        <linearGradient id="orderbookAskFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-negative)" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="var(--color-negative)" stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" vertical={false} />
                      <XAxis
                        type="number"
                        dataKey="price"
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => formatNumber(Number(value), { decimals: 0 })}
                        domain={['dataMin', 'dataMax']}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        width={52}
                        tickFormatter={(value) => formatNumber(Number(value), { decimals: 0 })}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          fontSize: '11px',
                        }}
                        formatter={(value: number | string | undefined, name) => [
                          formatNumber(Number(value), { decimals: 0 }),
                          name === 'bidCumulative' ? 'Bid depth' : 'Ask depth',
                        ]}
                        labelFormatter={(label) => `Price ${formatNumber(Number(label), { decimals: 0 })}`}
                      />
                      {lastPrice !== null ? (
                        <ReferenceLine x={lastPrice} stroke="var(--chart-blue)" strokeDasharray="4 4" />
                      ) : null}
                      <Area type="monotone" dataKey="bidCumulative" stroke="var(--color-positive)" strokeWidth={2} fill="url(#orderbookBidFill)" />
                      <Area type="monotone" dataKey="askCumulative" stroke="var(--color-negative)" strokeWidth={2} fill="url(#orderbookAskFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartMountGuard>
              ))}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_74px_minmax(0,1fr)] gap-2 border-b border-[var(--border-color)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <div>Bid Vol</div>
              <div className="text-center">{referenceOnly ? 'Ref Price' : 'Price'}</div>
              <div className="text-right">Ask Vol</div>
            </div>

            <div className="flex-1 overflow-auto scrollbar-hide">
              {entries.map((entry, i) => (
                <div key={i} className="relative grid grid-cols-[minmax(0,1fr)_74px_minmax(0,1fr)] items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
                  <div
                    className="absolute left-0 top-0 h-full bg-[var(--color-positive-bg)]"
                    style={{ width: `${((Number(entry.bid_vol) || 0) / maxVolume) * 50}%` }}
                  />
                  <div
                    className="absolute right-0 top-0 h-full bg-[var(--color-negative-bg)]"
                    style={{ width: `${((Number(entry.ask_vol) || 0) / maxVolume) * 50}%` }}
                  />

                  <div className="min-w-0 break-all text-xs text-[var(--color-positive)] font-mono relative z-10">
                    {entry.bid_vol?.toLocaleString() || EMPTY_VALUE}
                  </div>
                  <div className="text-center text-xs text-[var(--text-primary)] font-bold relative z-10">
                    <span className={referenceOnly ? 'text-[var(--text-secondary)]' : undefined}>
                      {entry.price.toLocaleString()}
                    </span>
                  </div>
                  <div className="min-w-0 break-all text-right text-xs text-[var(--color-negative)] font-mono relative z-10">
                    {entry.ask_vol?.toLocaleString() || EMPTY_VALUE}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </WidgetContainer>
  );
}

export const OrderbookWidget = memo(OrderbookWidgetComponent);
export default OrderbookWidget;
