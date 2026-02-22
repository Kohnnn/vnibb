'use client';

import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useScreenerData } from '@/lib/queries';
import { formatNumber } from '@/lib/format';

interface MarketBreadthWidgetProps {
  id: string;
  onRemove?: () => void;
}

interface BreadthRow {
  label: string;
  total: number;
  advancers: number;
  decliners: number;
  unchanged: number;
}

const EXCHANGES = [
  { id: 'HOSE', label: 'HOSE' },
  { id: 'HNX', label: 'HNX' },
  { id: 'UPCOM', label: 'UPCOM' },
];

export function MarketBreadthWidget({ id, onRemove }: MarketBreadthWidgetProps) {
  const hose = useScreenerData({ exchange: 'HOSE', limit: 500 });
  const hnx = useScreenerData({ exchange: 'HNX', limit: 400 });
  const upcom = useScreenerData({ exchange: 'UPCOM', limit: 400 });

  const rows = useMemo(() => {
    const datasets = [hose.data?.data ?? [], hnx.data?.data ?? [], upcom.data?.data ?? []];
    return datasets.map((data, index) => {
      const advancers = data.filter((item) => (item.change_1d ?? 0) > 0).length;
      const decliners = data.filter((item) => (item.change_1d ?? 0) < 0).length;
      const total = data.length;
      return {
        label: EXCHANGES[index].label,
        total,
        advancers,
        decliners,
        unchanged: Math.max(total - advancers - decliners, 0),
      };
    });
  }, [hose.data, hnx.data, upcom.data]);

  const hasData = rows.some((row) => row.total > 0);
  const isLoading = hose.isLoading || hnx.isLoading || upcom.isLoading;
  const isFetching = hose.isFetching || hnx.isFetching || upcom.isFetching;
  const error = hose.error || hnx.error || upcom.error;
  const updatedAt = Math.max(hose.dataUpdatedAt || 0, hnx.dataUpdatedAt || 0, upcom.dataUpdatedAt || 0) || undefined;

  return (
    <WidgetContainer
      title="Market Breadth"
      onRefresh={() => {
        hose.refetch();
        hnx.refetch();
        upcom.refetch();
      }}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
      widgetId={id}
    >
      <div className="h-full flex flex-col bg-[var(--bg-primary)]">
        <div className="px-3 py-2 border-b border-gray-800/60">
          <WidgetMeta
            updatedAt={updatedAt}
            isFetching={isFetching && hasData}
            isCached={Boolean(error && hasData)}
            note="Advancers vs decliners"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={4} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => hose.refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Breadth data not available yet" icon={<Activity size={18} />} />
          ) : (
            <div className="space-y-2">
              {rows.map((row) => {
                const ratio = row.decliners === 0 ? null : row.advancers / row.decliners;
                return (
                  <div
                    key={row.label}
                    className="rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-gray-200">{row.label}</div>
                      <div className="text-[10px] text-gray-500">{formatNumber(row.total)}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                      <div className="text-emerald-400">▲ {row.advancers}</div>
                      <div className="text-red-400">▼ {row.decliners}</div>
                      <div className="text-gray-400">= {row.unchanged}</div>
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500">
                      A/D ratio {ratio ? ratio.toFixed(2) : '--'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default MarketBreadthWidget;
