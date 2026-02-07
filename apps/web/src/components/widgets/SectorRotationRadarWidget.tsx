'use client';

import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useSectorPerformance } from '@/lib/queries';
import { useWidgetSymbolLink } from '@/hooks/useWidgetSymbolLink';
import type { WidgetGroupId } from '@/types/widget';

interface SectorRotationRadarWidgetProps {
  id: string;
  widgetGroup?: WidgetGroupId;
  onRemove?: () => void;
}

export function SectorRotationRadarWidget({ id, widgetGroup, onRemove }: SectorRotationRadarWidgetProps) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSectorPerformance();
  const { setLinkedSymbol } = useWidgetSymbolLink(widgetGroup);

  const sectors = data?.data || [];
  const hasData = sectors.length > 0;

  const leaders = useMemo(() => {
    return [...sectors]
      .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
      .slice(0, 5);
  }, [sectors]);

  const laggards = useMemo(() => {
    return [...sectors]
      .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))
      .slice(0, 5);
  }, [sectors]);

  return (
    <WidgetContainer
      title="Sector Rotation Radar"
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
            note="Rotation leaders & laggards"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={6} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Sector rotation data not available yet" icon={<TrendingUp size={18} />} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Leaders</div>
                {leaders.map((sector) => {
                  const name = sector.sectorName || sector.sectorNameEn || sector.sectorId;
                  const gainer = sector.topGainer?.symbol;
                  return (
                    <div
                      key={`leader-${sector.sectorId}`}
                      className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                    >
                      <div>
                        <div className="text-xs font-semibold text-gray-200">{name}</div>
                        {gainer && (
                          <button
                            type="button"
                            onClick={() => setLinkedSymbol(gainer)}
                            className="text-[10px] text-emerald-400 hover:text-emerald-300"
                          >
                            Top gainer: {gainer}
                          </button>
                        )}
                      </div>
                      <div className="text-xs font-bold text-emerald-400">
                        +{(sector.changePct ?? 0).toFixed(2)}%
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-red-400">Laggards</div>
                {laggards.map((sector) => {
                  const name = sector.sectorName || sector.sectorNameEn || sector.sectorId;
                  const loser = sector.topLoser?.symbol;
                  return (
                    <div
                      key={`laggard-${sector.sectorId}`}
                      className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                    >
                      <div>
                        <div className="text-xs font-semibold text-gray-200">{name}</div>
                        {loser && (
                          <button
                            type="button"
                            onClick={() => setLinkedSymbol(loser)}
                            className="text-[10px] text-red-400 hover:text-red-300"
                          >
                            Top loser: {loser}
                          </button>
                        )}
                      </div>
                      <div className="text-xs font-bold text-red-400">
                        {(sector.changePct ?? 0).toFixed(2)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default SectorRotationRadarWidget;
