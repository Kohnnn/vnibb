'use client';

import { useMemo } from 'react';
import { BadgeDollarSign } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useDividends } from '@/lib/queries';
import { formatRelativeTime, formatDate } from '@/lib/format';
import { formatPercent, formatVND } from '@/lib/formatters';
import type { DividendRecord } from '@/lib/api';

interface DividendLadderWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

interface DividendEvent {
  type: 'ex' | 'record' | 'payment';
  label: string;
  date: string;
  payoutLabel: string;
  payoutType: string;
  dividendYield: number | null | undefined;
}

function formatPayout(row: DividendRecord): string {
  if (row.cash_dividend !== null && row.cash_dividend !== undefined) {
    return formatVND(row.cash_dividend)
  }
  if (row.stock_dividend !== null && row.stock_dividend !== undefined) {
    return `${row.stock_dividend.toFixed(2)}% stock`
  }
  if (row.dividend_ratio !== null && row.dividend_ratio !== undefined) {
    return String(row.dividend_ratio)
  }
  if (row.value !== null && row.value !== undefined) {
    return formatVND(row.value)
  }
  return '-'
}

function formatDividendType(type: string | null | undefined): string {
  const normalized = String(type || '').toLowerCase()
  if (normalized === 'cash') return 'Cash'
  if (normalized === 'stock') return 'Stock'
  if (normalized === 'mixed') return 'Mixed'
  return 'Other'
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
      const payoutLabel = formatPayout(dividend)
      const payoutType = formatDividendType(dividend.dividend_type || dividend.type)
      const dividendYield = dividend.dividend_yield

      if (dividend.ex_date) {
        all.push({
          type: 'ex',
          label: 'Ex-Date',
          date: dividend.ex_date,
          payoutLabel,
          payoutType,
          dividendYield,
        });
      }
      if (dividend.record_date) {
        all.push({
          type: 'record',
          label: 'Record Date',
          date: dividend.record_date,
          payoutLabel,
          payoutType,
          dividendYield,
        });
      }
      if (dividend.payment_date) {
        all.push({
          type: 'payment',
          label: 'Payment',
          date: dividend.payment_date,
          payoutLabel,
          payoutType,
          dividendYield,
        });
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
      <div aria-label="Dividend ladder timeline" className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
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
                  className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2"
                >
                  <div>
                    <div className="text-xs font-semibold text-[var(--text-primary)]">{event.label}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {formatDate(event.date, 'short')} • {formatRelativeTime(event.date)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-[var(--text-primary)]">{event.payoutLabel}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {event.payoutType}
                      {event.dividendYield !== null && event.dividendYield !== undefined
                        ? ` • ${formatPercent(event.dividendYield)}`
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
