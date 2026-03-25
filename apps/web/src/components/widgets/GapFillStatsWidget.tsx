'use client';

import { ArrowDownCircle, ArrowUpCircle, CalendarClock } from 'lucide-react';
import { useHistoricalPrices } from '@/lib/queries';
import type { OHLCData } from '@/lib/chartUtils';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout';

interface GapFillStatsWidgetProps {
  symbol: string;
}

interface GapEvent {
  date: string;
  direction: 'up' | 'down';
  gapPct: number;
  filled: boolean;
  daysToFill: number | null;
}

function toLabelDate(raw: string): string {
  if (!raw) return '-';
  return raw.length >= 10 ? raw.slice(5, 10) : raw;
}

function calculateGapEvents(candles: OHLCData[], minGapPct = 0.5, maxLookahead = 20): GapEvent[] {
  const events: GapEvent[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1].close;
    const open = candles[i].open;
    if (!Number.isFinite(prevClose) || prevClose <= 0 || !Number.isFinite(open)) continue;

    const gapPct = ((open - prevClose) / prevClose) * 100;
    if (Math.abs(gapPct) < minGapPct) continue;

    const direction: 'up' | 'down' = gapPct > 0 ? 'up' : 'down';

    let filled = false;
    let daysToFill: number | null = null;

    for (let j = i; j < Math.min(candles.length, i + maxLookahead + 1); j += 1) {
      const probe = candles[j];
      const isFilled = direction === 'up' ? probe.low <= prevClose : probe.high >= prevClose;
      if (isFilled) {
        filled = true;
        daysToFill = j - i;
        break;
      }
    }

    events.push({
      date: String(candles[i].time),
      direction,
      gapPct,
      filled,
      daysToFill,
    });
  }

  return events;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function GapFillStatsWidget({ symbol }: GapFillStatsWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || '';
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useHistoricalPrices(upperSymbol, {
    startDate: new Date(Date.now() - 420 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    enabled: Boolean(upperSymbol),
  });

  const candles = (data?.data || []) as OHLCData[];
  const events = calculateGapEvents(candles, 0.5, 20);
  const hasData = events.length > 0;
  const isFallback = Boolean(error && hasData);
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 });

  const filledEvents = events.filter((event) => event.filled);
  const fillRate = events.length > 0 ? (filledEvents.length / events.length) * 100 : 0;

  const upEvents = events.filter((event) => event.direction === 'up');
  const downEvents = events.filter((event) => event.direction === 'down');
  const upFillRate = upEvents.length ? (upEvents.filter((event) => event.filled).length / upEvents.length) * 100 : 0;
  const downFillRate = downEvents.length
    ? (downEvents.filter((event) => event.filled).length / downEvents.length) * 100
    : 0;

  const avgDays = average(
    filledEvents
      .map((event) => event.daysToFill)
      .filter((value): value is number => value !== null)
  );

  const recentEvents = events.slice(-10).reverse();

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view gap fill stats" icon={<CalendarClock size={18} />} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <CalendarClock size={12} className="text-cyan-400" />
          <span>Gap Fill Stats (1Y)</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          note="0.5%+ gaps"
          align="right"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Gaps</div>
          <div className="text-cyan-300 font-mono">{events.length}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Fill Rate</div>
          <div className="text-emerald-300 font-mono">{fillRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Avg Fill</div>
          <div className="text-amber-300 font-mono">{avgDays.toFixed(1)}d</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Gap Up Fill</div>
          <div className="text-emerald-300 font-mono">{upFillRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[var(--text-muted)] uppercase tracking-widest">Gap Down Fill</div>
          <div className="text-red-300 font-mono">{downFillRate.toFixed(1)}%</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Gap fill statistics took too long to load.')}
            onRetry={() => {
              resetTimeout();
              refetch();
            }}
          />
        ) : isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="No qualifying gaps in lookback window" icon={<CalendarClock size={18} />} size="compact" />
        ) : (
          recentEvents.map((event, index) => {
            const isUp = event.direction === 'up';
            return (
              <div key={`${event.date}-${index}`} className="flex items-center gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="w-12 text-[10px] text-[var(--text-muted)] shrink-0">{toLabelDate(event.date)}</div>
                <div className="w-5 shrink-0">
                  {isUp ? (
                    <ArrowUpCircle size={11} className="text-emerald-400" />
                  ) : (
                    <ArrowDownCircle size={11} className="text-red-400" />
                  )}
                </div>
                <div className={`w-16 text-[10px] font-mono ${isUp ? 'text-emerald-300' : 'text-red-300'}`}>
                  {event.gapPct >= 0 ? '+' : ''}
                  {event.gapPct.toFixed(2)}%
                </div>
                <div className="flex-1 text-right text-[10px]">
                  {event.filled ? (
                    <span className="text-cyan-300">Filled {event.daysToFill}d</span>
                  ) : (
                    <span className="text-[var(--text-secondary)]">Unfilled</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default GapFillStatsWidget;
