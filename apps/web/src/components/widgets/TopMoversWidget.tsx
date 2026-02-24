'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { useTopMovers } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import { CompanyLogo } from '@/components/ui/CompanyLogo';
import type { WidgetGroupId } from '@/types/widget';

interface TopMoversWidgetProps {
  isEditing?: boolean;
  onRemove?: () => void;
  onSymbolClick?: (symbol: string) => void;
  widgetGroup?: WidgetGroupId;
}

type ViewMode = 'gainer' | 'loser';

export function TopMoversWidget({
  onRemove,
  onSymbolClick,
  widgetGroup,
  lastRefresh,
}: TopMoversWidgetProps & { lastRefresh?: number }) {
  const [mode, setMode] = useState<ViewMode>('gainer');
  const {
    data,
    isLoading,
    error,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useTopMovers({
    type: mode,
    limit: 10,
    index: 'VNINDEX',
  });

  const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup);

  useEffect(() => {
    if (lastRefresh) {
      refetch();
    }
  }, [lastRefresh, refetch]);

  const stocks = data?.data || [];
  const hasData = stocks.length > 0;
  const isFallback = Boolean(error && hasData);

  const handleSymbolSelect = (symbol: string) => {
    onSymbolClick?.(symbol);
    setLinkedSymbol(symbol);
  };

  const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, '').trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  return (
    <WidgetContainer
      title="Market Movers"
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
    >
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-center px-3 py-2 border-b border-[var(--border-subtle)]">
          <div className="flex bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-lg p-0.5 text-[10px]">
            <button
              onClick={() => setMode('gainer')}
              className={`px-4 py-1.5 rounded-md flex items-center gap-1.5 transition-all ${
                mode === 'gainer'
                  ? 'bg-green-600 text-white shadow-lg shadow-green-600/20'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <TrendingUp size={12} /> Gainers
            </button>
            <button
              onClick={() => setMode('loser')}
              className={`px-4 py-1.5 rounded-md flex items-center gap-1.5 transition-all ${
                mode === 'loser'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <TrendingDown size={12} /> Losers
            </button>
          </div>
        </div>

        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={mode === 'gainer' ? 'Top gainers' : 'Top losers'}
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto px-2 py-1">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={6} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Market mover data will appear when available." icon={<Activity size={18} />} />
          ) : (
            <div className="space-y-0.5">
              {stocks.map((stock, index) => {
                const payload = stock as unknown as Record<string, unknown>;
                const price = toNumber(stock.last_price ?? payload['lastPrice']);
                const absChange = toNumber(stock.price_change ?? payload['priceChange'] ?? payload['change']);
                const explicitPct = toNumber(
                  stock.price_change_pct
                  ?? payload['priceChangePct']
                  ?? payload['change_pct']
                  ?? payload['changePct']
                );

                let changePct = explicitPct;
                if ((changePct === null || Math.abs(changePct) < 0.001) && absChange !== null && price !== null) {
                  const referencePrice = price - absChange;
                  if (referencePrice !== 0) {
                    changePct = (absChange / referencePrice) * 100;
                  }
                }

                if (changePct === null) {
                  changePct = 0;
                }

                const isUp = changePct >= 0;
                return (
                  <button
                    key={`${stock.symbol}-${index}`}
                    type="button"
                    onClick={() => handleSymbolSelect(stock.symbol)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSymbolSelect(stock.symbol);
                      }
                    }}
                    className={`w-full flex items-center justify-between py-2 px-2.5 rounded-lg group transition-all text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ${
                      isUp
                        ? 'hover:bg-green-500/10 hover:border-green-500/20'
                        : 'hover:bg-red-500/10 hover:border-red-500/20'
                    } border border-transparent`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded ${
                          index < 3
                            ? isUp
                              ? 'bg-green-600/20 text-green-600'
                              : 'bg-red-600/20 text-red-600'
                            : 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <CompanyLogo symbol={stock.symbol} name={stock.symbol} size={18} className="shrink-0" />
                      <span className="font-bold text-[var(--accent-blue)] text-xs tracking-wide">
                        {stock.symbol}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-[var(--text-primary)] text-xs font-mono tabular-nums">
                        {price !== null ? price.toLocaleString() : '--'}
                      </span>
                      <span
                        className={`text-[11px] font-bold min-w-[55px] text-right px-1.5 py-0.5 rounded ${
                          isUp
                            ? 'text-green-600 bg-green-500/10'
                            : 'text-red-600 bg-red-500/10'
                        }`}
                      >
                        {isUp ? '+' : ''}{changePct.toFixed(2)}%
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default TopMoversWidget;
