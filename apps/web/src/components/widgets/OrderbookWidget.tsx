'use client';

import { memo, useEffect, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartMountGuard } from '@/components/ui/ChartMountGuard';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import type { PriceDepthResponse } from '@/lib/api';
import { DEFAULT_TICKER } from '@/lib/defaultTicker';
import { usePriceDepth } from '@/lib/queries';
import { formatNumber } from '@/lib/units';

interface OrderbookWidgetProps {
  symbol?: string;
  widgetId?: string;
  onDataChange?: (data: unknown) => void;
}

type DepthEntry = PriceDepthResponse['data']['entries'][number];

function toFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getEntryPrice(entry: DepthEntry): number | null {
  const row = entry as DepthEntry & Record<string, unknown>;
  return toFiniteNumber(
    row.price,
    row.bid_price,
    row.ask_price,
    row.bidPrice,
    row.askPrice,
    row.match_price,
    row.matchPrice,
  );
}

/**
 * HOSE/HNX/UPCOM order book payloads sometimes arrive in raw VND units
 * (e.g. `25,000` for a stock priced at 25.0 VND/share thousands) and
 * sometimes already pre-scaled to thousand-VND units. The chart and the
 * comparison code throughout the dashboard expect "thousand VND" units
 * (matching the convention used in the price ticker, market overview,
 * etc). When a price is more than 5x the lastPrice anchor we treat it
 * as an unscaled raw value and divide by 1000 to align the display.
 *
 * This addresses QA-v3 T2/T7 where ask prices showed 58,000-311,900 for
 * a stock trading at ~25 VND.
 */
function normalizeOrderbookPrice(price: number | null, lastPriceAnchor: number | null): number | null {
  if (price === null || !Number.isFinite(price)) return price;
  if (lastPriceAnchor === null || !Number.isFinite(lastPriceAnchor) || lastPriceAnchor <= 0) {
    // Without an anchor we still apply the heuristic for absurdly large
    // values typical of unscaled HOSE feeds (>= 5,000 effectively means
    // raw VND for any HOSE-listed stock priced in thousand-VND units).
    if (Math.abs(price) >= 5000) return price / 1000;
    return price;
  }
  if (Math.abs(price) > lastPriceAnchor * 5) {
    return price / 1000;
  }
  return price;
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

  const entries = (orderbook?.data?.entries || []) as DepthEntry[];
  const hasData = entries.length > 0;
  const isFallback = Boolean(error && hasData);
  const lastPrice = Number(orderbook?.data?.last_price);

  const maxVolume = useMemo(() => {
    if (entries.length === 0) return 1;
    return Math.max(
      1,
      ...entries.map((entry) => Math.max(Number(entry.bid_vol) || 0, Number(entry.ask_vol) || 0))
    );
  }, [entries]);

  const normalizedEntries = useMemo(
    () => entries.map((entry) => {
      const rawPrice = getEntryPrice(entry);
      const anchor = Number.isFinite(lastPrice) ? lastPrice : null;
      return { ...entry, price: normalizeOrderbookPrice(rawPrice, anchor) };
    }),
    [entries, lastPrice]
  );

  const depthSeries = useMemo(() => {
    const normalized = normalizedEntries
      .map((entry) => ({
        price: Number(entry.price),
        bidVol: Number(entry.bid_vol) || 0,
        askVol: Number(entry.ask_vol) || 0,
      }))
      .filter((entry) => Number.isFinite(entry.price))
      .sort((a, b) => a.price - b.price);

    if (!normalized.length) return [];

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
  }, [normalizedEntries]);

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: {
          empty: !hasData,
          compactHeight: 6,
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
          <>
            <div className="border-b border-[var(--border-subtle)] px-3 py-3 bg-[var(--bg-primary)]">
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                <span>Cumulative Depth</span>
                <span>{Number.isFinite(lastPrice) ? `Last ${formatNumber(lastPrice, { decimals: 0 })}` : '10 levels'}</span>
              </div>
              {depthSeries.length < 2 ? (
                <div className="text-[10px] text-[var(--text-secondary)]">Need at least two levels to draw depth.</div>
              ) : (
                <ChartMountGuard className="h-[180px] min-h-[180px]" minHeight={180}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <AreaChart data={depthSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="orderbookBidFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4ade80" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#4ade80" stopOpacity={0.04} />
                        </linearGradient>
                        <linearGradient id="orderbookAskFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f87171" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#f87171" stopOpacity={0.04} />
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
                      {Number.isFinite(lastPrice) ? (
                        <ReferenceLine x={lastPrice} stroke="rgba(56,189,248,0.65)" strokeDasharray="4 4" />
                      ) : null}
                      <Area type="monotone" dataKey="bidCumulative" stroke="#4ade80" strokeWidth={2} fill="url(#orderbookBidFill)" />
                      <Area type="monotone" dataKey="askCumulative" stroke="#f87171" strokeWidth={2} fill="url(#orderbookAskFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartMountGuard>
              )}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_74px_minmax(0,1fr)] gap-2 border-b border-[var(--border-color)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <div>Bid Vol</div>
              <div className="text-center">Price</div>
              <div className="text-right">Ask Vol</div>
            </div>

            <div className="flex-1 overflow-auto scrollbar-hide">
              {normalizedEntries.map((entry, i) => (
                <div key={i} className="relative grid grid-cols-[minmax(0,1fr)_74px_minmax(0,1fr)] items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
                  <div
                    className="absolute left-0 top-0 h-full bg-green-500/10"
                    style={{ width: `${((Number(entry.bid_vol) || 0) / maxVolume) * 50}%` }}
                  />
                  <div
                    className="absolute right-0 top-0 h-full bg-red-500/10"
                    style={{ width: `${((Number(entry.ask_vol) || 0) / maxVolume) * 50}%` }}
                  />

                  <div className="min-w-0 break-all text-xs text-green-400 font-mono relative z-10">
                    {entry.bid_vol?.toLocaleString() || '--'}
                  </div>
                  <div className="text-center text-xs text-[var(--text-primary)] font-bold relative z-10">
                    {entry.price !== null ? entry.price.toLocaleString() : '--'}
                  </div>
                  <div className="min-w-0 break-all text-right text-xs text-red-400 font-mono relative z-10">
                    {entry.ask_vol?.toLocaleString() || '--'}
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
