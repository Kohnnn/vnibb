'use client';

import { memo, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useSectorBoard } from '@/lib/queries';
import { formatNumber } from '@/lib/units';
import { cn } from '@/lib/utils';

interface SectorBoardWidgetProps {
  id: string;
  onRemove?: () => void;
}

const SORT_OPTIONS = [
  { value: 'volume', label: 'Volume' },
  { value: 'market_cap', label: 'Market Cap' },
  { value: 'change_pct', label: 'Change %' },
] as const;

function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return formatNumber(value, { decimals: 0 });
}

function colorClass(color: string) {
  switch (color) {
    case 'purple':
      return 'text-violet-300';
    case 'blue':
      return 'text-sky-300';
    case 'green':
      return 'text-emerald-300';
    case 'red':
      return 'text-rose-300';
    default:
      return 'text-amber-200';
  }
}

function SectorBoardWidgetComponent({ id, onRemove }: SectorBoardWidgetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sortBy, setSortBy] = useState<'volume' | 'market_cap' | 'change_pct'>('volume');

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSectorBoard({
    limit_per_sector: 12,
    sort_by: sortBy,
  });

  const sectors = data?.sectors || [];
  const hasData = sectors.length > 0;
  const marketSummary = data?.market_summary || {};

  const marketBadges = useMemo(
    () => Object.entries(marketSummary).slice(0, 4),
    [marketSummary]
  );

  const scroll = (direction: 'left' | 'right') => {
    scrollRef.current?.scrollBy({
      left: direction === 'left' ? -260 : 260,
      behavior: 'smooth',
    });
  };

  return (
    <WidgetContainer
      title="Sector Board"
      subtitle="Columnar sector tape with price, change, and liquidity"
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      exportData={sectors}
      exportFilename="sector_board"
      widgetId={id}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {marketBadges.map(([key, value]) => (
              <div
                key={key}
                className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1"
              >
                <div className="text-[9px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{key}</div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">{formatNumber(value?.value ?? null, { decimals: 2 })}</div>
                <div className={cn('text-[10px] font-semibold', (value?.change_pct ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                  {formatNumber(value?.change_pct ?? null, { decimals: 2 })}%
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSortBy(option.value)}
                  className={cn(
                    'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
                    sortBy === option.value
                      ? 'bg-blue-600 text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <WidgetMeta
              updatedAt={data?.updated_at || dataUpdatedAt}
              isFetching={isFetching && hasData}
              note={`Sorted by ${sortBy.replace('_', ' ')}`}
              align="right"
            />
          </div>
        </div>

        <div className="relative flex-1">
          <button
            type="button"
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 z-20 -translate-y-1/2 rounded-r-lg border border-l-0 border-[var(--border-default)] bg-[var(--bg-surface)]/95 p-1.5 text-[var(--text-primary)]"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-lg border border-r-0 border-[var(--border-default)] bg-[var(--bg-surface)]/95 p-1.5 text-[var(--text-primary)]"
          >
            <ChevronRight size={16} />
          </button>

          <div ref={scrollRef} className="flex h-full overflow-x-auto scrollbar-hide">
            {isLoading && !hasData ? (
              <div className="w-full p-3"><WidgetSkeleton lines={8} /></div>
            ) : error && !hasData ? (
              <WidgetError error={error as Error} onRetry={() => refetch()} />
            ) : !hasData ? (
              <WidgetEmpty message="Sector board data unavailable" icon={<LayoutGrid size={18} />} />
            ) : (
              sectors.map((sector) => (
                <div key={sector.name} className="min-w-[190px] border-r border-[var(--border-subtle)] last:border-r-0">
                  <div className="sticky top-0 z-10 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2">
                    <div className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {sector.name}
                    </div>
                    <div className={cn('text-xs font-semibold', sector.change_pct >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                      {sector.change_pct >= 0 ? '+' : ''}{formatNumber(sector.change_pct, { decimals: 2 })}%
                    </div>
                  </div>
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {sector.stocks.map((stock) => (
                      <div key={`${sector.name}:${stock.symbol}`} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <div className="text-xs font-bold text-[var(--text-primary)]">{stock.symbol}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            Vol {formatCompactNumber(stock.volume)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={cn('text-xs font-semibold', colorClass(stock.color))}>
                            {stock.change_pct != null && stock.change_pct > 0 ? '+' : ''}
                            {formatNumber(stock.change_pct ?? null, { decimals: 2 })}%
                          </div>
                          <div className="text-[10px] font-mono text-[var(--text-secondary)]">
                            {formatNumber(stock.price ?? null, { decimals: 2 })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </WidgetContainer>
  );
}

export const SectorBoardWidget = memo(SectorBoardWidgetComponent);
export default SectorBoardWidget;
