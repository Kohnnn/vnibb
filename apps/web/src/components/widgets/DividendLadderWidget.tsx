'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useDividends } from '@/lib/queries';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import {
  DIVIDEND_LADDER_LIMIT,
  buildDividendEvents,
  getVnDayKey,
  selectDividendLadder,
} from '@/lib/dividendLadder';
import { formatDividendPayout, formatDividendYield } from '@/lib/formatters';
import type { DividendRecord } from '@/lib/api';

const EMPTY_DIVIDENDS: DividendRecord[] = [];

/** Re-read the VN calendar day so the label/range roll over at ICT midnight. */
const DAY_TICK_MS = 60_000;

interface DividendLadderWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function formatDividendType(type: string | null | undefined): string {
  const normalized = String(type || '').toLowerCase()
  if (normalized === 'cash') return 'Cash'
  if (normalized === 'stock') return 'Stock'
  if (normalized === 'mixed') return 'Mixed'
  return 'Other'
}

export function DividendLadderWidget({ id, symbol, onRemove, onDataChange }: DividendLadderWidgetProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useDividends(symbol, Boolean(symbol));

  const dividends = data?.data?.length ? data.data : EMPTY_DIVIDENDS;

  const events = useMemo(
    () => buildDividendEvents(dividends, (dividend) => ({
      payoutLabel: formatDividendPayout(dividend),
      payoutType: formatDividendType(dividend.dividend_type || dividend.type),
    })),
    [dividends],
  );

  // Action days are VN calendar days, not instants: pin "today" to the ICT
  // date and re-read it at that boundary, so the label and rows flip together
  // at midnight ICT instead of drifting with the host clock (#259).
  const [todayKey, setTodayKey] = useState(() => getVnDayKey(new Date()));

  useEffect(() => {
    const tick = () => setTodayKey((previous) => {
      const next = getVnDayKey(new Date());
      return next === previous ? previous : next;
    });
    const timer = window.setInterval(tick, DAY_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const { events: displayEvents, label: rangeLabel } = useMemo(
    () => selectDividendLadder(events, todayKey, DIVIDEND_LADDER_LIMIT),
    [events, todayKey],
  );

  const hasData = displayEvents.length > 0;
  // Dividend ex/record/payment dates are action schedules, not source
  // observations, so freshness stays unknown and receipts go to fetchedAt.

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/equity',
      endpoint: `/equity/${symbol}/dividends`,
      sourceLabel: 'vnstock',
      lastDataDate: null,
      fetchedAt: dataUpdatedAt,
      stale: Boolean(error && hasData),
      extra: { events: displayEvents.length },
    }));
  }, [dataUpdatedAt, displayEvents, error, hasData, onDataChange, symbol]);

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view dividends" />;
  }

  return (
    <WidgetContainer
      title="Dividend Ladder"
      symbol={symbol}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
    >
      <div aria-label="Dividend ladder timeline" className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <WidgetMeta
            updatedAt={null}
            fetchedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note={rangeLabel}
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={5} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No dividend events available yet" icon={<BadgeDollarSign size={18} />} />
          ) : (
            <div className="space-y-2">
              {displayEvents.map((event) => (
                <div
                  key={`${event.day}-${event.type}-${event.sequence}`}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2"
                >
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-primary)]">{event.label}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {event.day}
                      </div>
                    </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-[var(--text-primary)]">{event.payoutLabel}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {event.payoutType}
                      {event.dividendYield !== null && event.dividendYield !== undefined
                        ? ` • ${formatDividendYield(event.dividendYield)}`
                        : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default DividendLadderWidget;
