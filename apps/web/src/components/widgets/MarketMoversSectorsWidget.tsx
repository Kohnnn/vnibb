'use client';

import { useMemo } from 'react';
import { LayoutGrid, TrendingUp } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useSectorPerformance } from '@/lib/queries';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';

interface MarketMoversSectorsWidgetProps {
  id: string;
  widgetGroup?: WidgetGroupId;
  onRemove?: () => void;
}

export function MarketMoversSectorsWidget({ id, widgetGroup, onRemove }: MarketMoversSectorsWidgetProps) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSectorPerformance();
  const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup);

  const sectors = data?.data || [];
  const hasData = sectors.length > 0;
  const isFallback = Boolean(error && hasData);

  const sortedSectors = useMemo(() => {
    return [...sectors].sort((a, b) => Math.abs((b.changePct ?? 0) - (a.changePct ?? 0))).slice(0, 6);
  }, [sectors]);

  const topGainers = useMemo(() => {
    return sectors
      .map((sector) => {
        if (!sector.topGainer?.symbol) return null;
        return {
          symbol: sector.topGainer.symbol,
          changePct: sector.topGainer.changePct,
          sectorName: sector.sectorName || sector.sectorNameEn || sector.sectorId,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.changePct ?? 0) - (a?.changePct ?? 0))
      .slice(0, 4);
  }, [sectors]);

  const topLosers = useMemo(() => {
    return sectors
      .map((sector) => {
        if (!sector.topLoser?.symbol) return null;
        return {
          symbol: sector.topLoser.symbol,
          changePct: sector.topLoser.changePct,
          sectorName: sector.sectorName || sector.sectorNameEn || sector.sectorId,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.changePct ?? 0) - (b?.changePct ?? 0))
      .slice(0, 4);
  }, [sectors]);

  return (
    <WidgetContainer
      title="Market Movers & Sectors"
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Sector performance"
            align="right"
          />
        </div>

        {isLoading && !hasData ? (
          <div className="p-3">
            <WidgetSkeleton lines={6} />
          </div>
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="Sector data not available yet" icon={<LayoutGrid size={18} />} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-3 overflow-auto">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-emerald-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Market Movers</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Top Gainers</div>
                  {topGainers.length === 0 ? (
                    <div className="text-xs text-gray-500">No gainers yet.</div>
                  ) : (
                    topGainers.map((item, index) => (
                      <button
                        key={`gainer-${item?.symbol}-${index}`}
                        type="button"
                        onClick={() => item?.symbol && setLinkedSymbol(item.symbol)}
                        className="w-full flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2 text-left hover:bg-white/5 transition-colors"
                      >
                        <div>
                          <div className="text-xs font-semibold text-gray-200">{item?.symbol}</div>
                          <div className="text-[10px] text-gray-500 line-clamp-1">{item?.sectorName}</div>
                        </div>
                        <div className="text-xs font-bold text-emerald-400">
                          {item?.changePct !== null && item?.changePct !== undefined
                            ? `+${item.changePct.toFixed(2)}%`
                            : '--'}
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Top Losers</div>
                  {topLosers.length === 0 ? (
                    <div className="text-xs text-gray-500">No losers yet.</div>
                  ) : (
                    topLosers.map((item, index) => (
                      <button
                        key={`loser-${item?.symbol}-${index}`}
                        type="button"
                        onClick={() => item?.symbol && setLinkedSymbol(item.symbol)}
                        className="w-full flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2 text-left hover:bg-white/5 transition-colors"
                      >
                        <div>
                          <div className="text-xs font-semibold text-gray-200">{item?.symbol}</div>
                          <div className="text-[10px] text-gray-500 line-clamp-1">{item?.sectorName}</div>
                        </div>
                        <div className="text-xs font-bold text-red-400">
                          {item?.changePct !== null && item?.changePct !== undefined
                            ? `${item.changePct.toFixed(2)}%`
                            : '--'}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <LayoutGrid size={14} className="text-blue-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Sector Performance</span>
              </div>
              <div className="space-y-2">
                {sortedSectors.map((sector) => {
                  const change = sector.changePct ?? 0;
                  const isUp = change >= 0;
                  const name = sector.sectorName || sector.sectorNameEn || sector.sectorId;
                  return (
                    <div
                      key={sector.sectorId}
                      className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                    >
                      <div>
                        <div className="text-xs font-semibold text-gray-200">{name}</div>
                        <div className="text-[10px] text-gray-500">{sector.totalStocks} stocks</div>
                      </div>
                      <div className={`text-xs font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isUp ? '+' : ''}{change.toFixed(2)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </WidgetContainer>
  );
}

export default MarketMoversSectorsWidget;
