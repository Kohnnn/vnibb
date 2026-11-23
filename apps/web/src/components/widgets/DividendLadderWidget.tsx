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
import { DividendCoverageNotice } from './DividendCoverageNotice';
import { admittedDividendRows, dividendCoverageBasis, dividendDistributionExport, dividendExport, dividendRowLabel, readDividendCoverage } from '@/lib/dividendHistory';
import { formatDividendPayout } from '@/lib/formatters';

/** Re-read the VN calendar day so the label/range roll over at ICT midnight. */
const DAY_TICK_MS = 60_000;

interface DividendLadderWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
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

  const coverage = readDividendCoverage(data);
  const dividends = admittedDividendRows(data);

  const events = useMemo(
    () => buildDividendEvents(dividends, (dividend) => ({
      payoutLabel: formatDividendPayout(dividend),
      payoutType: dividendRowLabel(dividend),
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
  const failure = error?.message || data?.error;
  const isFallback = Boolean(failure && hasData);

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/equity',
      endpoint: `/equity/${symbol}/dividends`,
      sourceLabel: 'Retained dividend observations',
      lastDataDate: null,
      fetchedAt: dataUpdatedAt,
      cached: isFallback,
      refreshStatus: isFallback ? 'failed' : undefined,
      coverage: coverage?.status === 'partial' ? 'partial' : 'unknown',
      observationStatus: isLoading && !hasData ? 'loading' : hasData ? 'available' : 'unavailable',
      basis: dividendCoverageBasis(coverage),
      exportData: dividendExport(coverage, displayEvents.map(event => ({
        ...dividendDistributionExport(event.distribution),
        action_type: event.type,
        action_day: event.day,
      }))),
      extra: { events: displayEvents.length },
    }));
  }, [coverage, dataUpdatedAt, displayEvents, hasData, isFallback, isLoading, onDataChange, symbol]);

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
            isCached={isFallback}
            note={rangeLabel}
            align="right"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto space-y-2 p-3">
          {(!isLoading || coverage) && <DividendCoverageNotice coverage={coverage} failed={Boolean(failure)} />}
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={5} />
          ) : failure && !hasData ? (
            <WidgetError error={new Error(failure)} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No dividend events available yet" icon={<BadgeDollarSign size={18} />} />
          ) : (
            <div className="space-y-2">
              {displayEvents.map((event) => (
                <div
                  key={`${event.day}-${event.type}-${event.sequence}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2"
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
