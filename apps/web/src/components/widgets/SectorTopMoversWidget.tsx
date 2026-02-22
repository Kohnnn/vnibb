'use client';

import { memo, useState, useRef, useMemo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/lib/api';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';
import { getAdaptiveRefetchInterval, POLLING_PRESETS } from '@/lib/pollingPolicy';

interface StockPerformance {
  symbol: string;
  price: number;
  change_pct: number;
  volume?: number;
}

interface SectorData {
  sector: string;
  sector_vi: string;
  stocks: StockPerformance[];
}

interface SectorTopMoversWidgetProps {
  id: string;
  onRemove?: () => void;
  widgetGroup?: WidgetGroupId;
}

function SectorTopMoversWidgetComponent({ id, onRemove, widgetGroup }: SectorTopMoversWidgetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewType, setViewType] = useState<'gainers' | 'losers'>('gainers');
  const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup);

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['sector-top-movers-v2', viewType],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/sectors/top-movers?type=${viewType}`);
      if (!res.ok) throw new Error('Sector data failed');
      return res.json();
    },
    refetchInterval: () => getAdaptiveRefetchInterval(POLLING_PRESETS.movers),
    refetchIntervalInBackground: false,
    networkMode: 'online',
  });

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -250 : 250,
        behavior: 'smooth',
      });
    }
  };

  const headerActions = (
    <div className="flex bg-[var(--bg-secondary)] rounded p-0.5 border border-[var(--border-default)] mr-2">
      {(['gainers', 'losers'] as const).map((type) => (
        <button
          key={type}
          onClick={() => setViewType(type)}
          className={cn(
            'px-2 py-0.5 text-[9px] font-black uppercase rounded transition-all',
            viewType === type
              ? type === 'gainers'
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          )}
        >
          {type}
        </button>
      ))}
    </div>
  );

  const sectors = data?.sectors || [];
  const hasData = sectors.length > 0;
  const isFallback = Boolean(error && hasData);
  const updatedAt = data?.updated_at || dataUpdatedAt;

  return (
    <WidgetContainer
      title="Sector Movers"
      widgetId={id}
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      headerActions={headerActions}
      noPadding
    >
      <div className="h-full flex flex-col relative group/widget">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <WidgetMeta
            updatedAt={updatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={viewType === 'gainers' ? 'Top gainers by sector' : 'Top losers by sector'}
            align="right"
          />
        </div>
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 p-1.5 bg-[var(--bg-surface)]/95 text-[var(--text-primary)] rounded-r-lg border-r border-y border-[var(--border-default)] opacity-0 group-hover/widget:opacity-100 transition-opacity"
          type="button"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 p-1.5 bg-[var(--bg-surface)]/95 text-[var(--text-primary)] rounded-l-lg border-l border-y border-[var(--border-default)] opacity-0 group-hover/widget:opacity-100 transition-opacity"
          type="button"
        >
          <ChevronRight size={16} />
        </button>

        <div ref={scrollRef} className="flex-1 flex overflow-x-auto scrollbar-hide select-none bg-[var(--bg-primary)]">
          {isLoading && !hasData ? (
            <div className="flex flex-col items-center justify-center w-full text-[var(--text-muted)] gap-2">
              <WidgetSkeleton lines={4} />
            </div>
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No sector data available" icon={<Layers size={18} />} />
          ) : (
            sectors.map((sector: SectorData, idx: number) => (
              <SectorColumn
                key={`${sector.sector}-${idx}`}
                sector={sector}
                onSelectSymbol={setLinkedSymbol}
              />
            ))
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

function SectorColumn({
  sector,
  onSelectSymbol,
}: {
  sector: SectorData;
  onSelectSymbol: (symbol: string) => void;
}) {
  const stocks = sector.stocks || [];
  const avgChange = useMemo(() => {
    if (stocks.length === 0) return 0;
    return stocks.reduce((acc, s) => acc + (s.change_pct || 0), 0) / stocks.length;
  }, [stocks]);

  const isPositive = avgChange >= 0;

  return (
    <div className="min-w-[150px] border-r border-[var(--border-subtle)] last:border-r-0 flex flex-col bg-[var(--bg-primary)]">
      <div
        className={cn(
          'px-3 py-2 border-b border-[var(--border-default)] transition-colors sticky top-0 bg-[var(--bg-secondary)] z-10',
          isPositive ? 'border-b-green-900/30' : 'border-b-red-900/30'
        )}
      >
        <div className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest truncate mb-0.5">
          {sector.sector_vi || sector.sector}
        </div>
        <div
          className={cn(
            'text-[11px] font-black flex items-center justify-between',
            isPositive ? 'text-green-500' : 'text-red-500'
          )}
        >
          <span>{isPositive ? '+' : ''}{avgChange.toFixed(2)}%</span>
          <span className="text-[8px] text-[var(--text-muted)]">{stocks.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-[var(--border-subtle)]">
        {stocks.map((stock, index) => (
          <StockRow key={`${stock.symbol}-${index}`} stock={stock} onSelect={onSelectSymbol} />
        ))}
      </div>
    </div>
  );
}

function StockRow({ stock, onSelect }: { stock: StockPerformance; onSelect: (symbol: string) => void }) {
  const isPositive = (stock.change_pct || 0) >= 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(stock.symbol)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(stock.symbol);
        }
      }}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-hover)] transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30',
        isPositive
          ? (stock.change_pct || 0) > 4
            ? 'bg-green-500/10'
            : 'bg-transparent'
          : (stock.change_pct || 0) < -4
            ? 'bg-red-500/10'
            : 'bg-transparent'
      )}
    >
      <div className="flex flex-col">
        <span className="text-xs font-black text-blue-400 group-hover:text-blue-300 transition-colors">
          {stock.symbol}
        </span>
        {stock.volume && (
          <span className="text-[8px] font-bold text-[var(--text-muted)]">
            {(stock.volume / 1000).toFixed(0)}K
          </span>
        )}
      </div>
      <div className="text-right">
        <div
          className={cn(
            'text-[11px] font-black font-mono',
            isPositive ? 'text-green-500' : 'text-red-500'
          )}
        >
          {isPositive ? '+' : ''}{(stock.change_pct || 0).toFixed(1)}%
        </div>
        <div className="text-[9px] font-bold text-[var(--text-secondary)] font-mono">
          {stock.price.toLocaleString()}
        </div>
      </div>
    </button>
  );
}

export const SectorTopMoversWidget = memo(SectorTopMoversWidgetComponent);
export default SectorTopMoversWidget;
