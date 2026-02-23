'use client';

import { TrendingDown, TrendingUp, Activity } from 'lucide-react';
import { useMarketOverview } from '@/lib/queries';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';

interface MarketOverviewWidgetProps {
  isEditing?: boolean;
  onRemove?: () => void;
}

function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

export function MarketOverviewWidget({ onRemove }: MarketOverviewWidgetProps) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useMarketOverview();
  const indices = data?.data || [];
  const hasData = indices.length > 0;
  const isFallback = Boolean(error && hasData);

  return (
    <WidgetContainer
      title="Vietnam Markets"
      onRefresh={() => refetch()}
      onClose={onRemove}
      isLoading={isLoading && !hasData}
      noPadding
    >
      <div aria-label="Market overview panel" className="h-full flex flex-col">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note="Indices snapshot"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={4} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="Market data will appear when available." icon={<Activity size={20} />} />
          ) : (
            <div className="index-cards-grid">
              {indices.map((idx, i) => {
                const indexPayload = idx as unknown as Record<string, unknown>;
                const changePct = Number(idx.change_pct ?? indexPayload.changePct ?? 0);
                const changeValue = Number(idx.change ?? indexPayload.changeValue ?? 0);
                const currentValue = Number(idx.current_value ?? indexPayload.currentValue ?? 0);
                const indexName =
                  (idx.index_name as string | undefined) ||
                  (indexPayload.indexName as string | undefined) ||
                  (indexPayload.index_code as string | undefined) ||
                  `Index ${i + 1}`;
                const isUp = changePct >= 0;

                return (
                  <div key={i} className={`index-card ${isUp ? 'up' : 'down'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="index-card__name">{indexName}</span>
                      {isUp ? (
                        <TrendingUp size={14} className="text-green-600" />
                      ) : (
                        <TrendingDown size={14} className="text-red-600" />
                      )}
                    </div>

                    <div className={`index-card__value ${isUp ? 'data-value-up' : 'data-value-down'}`}>
                      {formatValue(currentValue)}
                    </div>

                    <div className={`index-card__change ${isUp ? 'data-value-up' : 'data-value-down'}`}>
                      {formatValue(changeValue)} ({formatPct(changePct)})
                    </div>

                    <div className="flex items-center gap-2 mt-2 text-[9px] text-[var(--text-muted)]">
                      <span>Vol: {idx.volume?.toLocaleString() || '-'}</span>
                      <span>H: {formatValue(idx.high)}</span>
                      <span>L: {formatValue(idx.low)}</span>
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

export default MarketOverviewWidget;
