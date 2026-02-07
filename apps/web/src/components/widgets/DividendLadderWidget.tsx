'use client';

import { useMemo } from 'react';
import { BadgeDollarSign } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useDividends } from '@/lib/queries';
import { formatRelativeTime, formatDate } from '@/lib/format';
import { formatVND } from '@/lib/formatters';

interface DividendLadderWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

interface DividendEvent {
  type: 'ex' | 'record' | 'payment';
  label: string;
  date: string;
  value: number | null | undefined;
}

export function DividendLadderWidget({ id, symbol, onRemove }: DividendLadderWidgetProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useDividends(symbol, Boolean(symbol));

  const dividends = data?.data ?? [];

  const events = useMemo(() => {
    const all: DividendEvent[] = [];
    dividends.forEach((dividend) => {
      if (dividend.ex_date) {
        all.push({ type: 'ex', label: 'Ex-Date', date: dividend.ex_date, value: dividend.value });
      }
      if (dividend.record_date) {
        all.push({ type: 'record', label: 'Record Date', date: dividend.record_date, value: dividend.value });
      }
      if (dividend.payment_date) {
        all.push({ type: 'payment', label: 'Payment', date: dividend.payment_date, value: dividend.value });
      }
    });

    return all
      .filter((event) => Boolean(event.date))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [dividends]);

  const upcoming = useMemo(() => {
    const now = new Date();
    return events.filter((event) => new Date(event.date).getTime() >= now.getTime());
  }, [events]);

  const displayEvents = upcoming.length > 0 ? upcoming : events;
  const hasData = displayEvents.length > 0;

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
      <div className="h-full flex flex-col bg-[#0a0a0a]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note={upcoming.length > 0 ? 'Upcoming events' : 'Latest events'}
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
              {displayEvents.slice(0, 8).map((event, index) => (
                <div
                  key={`${event.type}-${event.date}-${index}`}
                  className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                >
                  <div>
                    <div className="text-xs font-semibold text-gray-200">{event.label}</div>
                    <div className="text-[10px] text-gray-500">
                      {formatDate(event.date, 'short')} • {formatRelativeTime(event.date)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-gray-200">{formatVND(event.value)}</div>
                    <div className="text-[10px] text-gray-500">{symbol}</div>
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
