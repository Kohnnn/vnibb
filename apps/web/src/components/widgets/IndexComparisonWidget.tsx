'use client';

import { memo } from 'react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { useMarketOverview } from '@/lib/queries';
import { ArrowUp, ArrowDown, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

const INDICES = [
  { symbol: 'VNINDEX', name: 'VN-Index' },
  { symbol: 'VN30', name: 'VN30' },
  { symbol: 'HNX', name: 'HNX-Index' },
  { symbol: 'UPCOM', name: 'UPCOM-Index' },
];

function IndexComparisonWidgetComponent() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMarketOverview();
  const dataList = data?.data || [];
  const hasData = dataList.length > 0;
  const isFallback = Boolean(error && hasData);

  return (
    <WidgetContainer title="Index Comparison" onRefresh={() => refetch()} isLoading={isLoading && !hasData}>
      <div className="h-full flex flex-col">
        <div className="border-b border-[var(--border-subtle)] pb-2">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Major indices"
            align="right"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 h-full pt-2">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={4} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Index data will appear when available." icon={<Activity size={18} />} />
          ) : (
            INDICES.map((index, idx) => {
              const dataPoint = dataList.find((i: any) =>
                i.index_name === index.symbol ||
                i.index_name === index.name ||
                (index.symbol === 'VNINDEX' && i.index_name === 'VN-INDEX')
              );

              const isUp = (dataPoint?.change_pct || 0) >= 0;

              return (
                <div
                  key={`${index.symbol}-${idx}`}
                  className="flex flex-col justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 transition-colors hover:border-[var(--border-color)]"
                >
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">{index.name}</div>
                  <div className="flex items-baseline justify-between mt-1">
                    <div className="text-lg font-black text-[var(--text-primary)]">
                      {dataPoint?.current_value?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '—'}
                    </div>
                    <div
                      className={cn(
                        'flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded',
                        isUp ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'
                      )}
                    >
                      {isUp ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                      {isUp ? '+' : ''}{dataPoint?.change_pct?.toFixed(2)}%
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export const IndexComparisonWidget = memo(IndexComparisonWidgetComponent);
export default IndexComparisonWidget;
