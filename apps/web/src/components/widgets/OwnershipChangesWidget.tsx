'use client';

import { Users } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useShareholders } from '@/lib/queries';
import { formatNumber, formatPercent } from '@/lib/formatters';

interface OwnershipChangesWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

export function OwnershipChangesWidget({ id, symbol, onRemove }: OwnershipChangesWidgetProps) {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useShareholders(symbol, Boolean(symbol));

  const holders = (data?.data ?? []).slice(0, 6);
  const hasData = holders.length > 0;

  if (!symbol) {
    return <WidgetEmpty message="Select a symbol to view ownership" />;
  }

  return (
    <WidgetContainer
      title="Ownership Changes"
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
            note="Latest ownership snapshot"
            align="right"
          />
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading && !hasData ? (
            <WidgetSkeleton lines={5} />
          ) : error && !hasData ? (
            <WidgetError error={error as Error} onRetry={() => refetch()} />
          ) : !hasData ? (
            <WidgetEmpty message="No ownership data available yet" icon={<Users size={18} />} />
          ) : (
            <div className="space-y-2">
              {holders.map((holder, idx) => (
                <div
                  key={`${holder.shareholder_name}-${idx}`}
                  className="flex items-center justify-between rounded-lg border border-gray-800/60 bg-black/20 px-3 py-2"
                >
                  <div>
                    <div className="text-xs font-semibold text-gray-200">
                      {holder.shareholder_name || 'Shareholder'}
                    </div>
                    <div className="text-[10px] text-gray-500">{holder.shareholder_type || '—'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-gray-200">
                      {formatPercent(holder.ownership_pct)}
                    </div>
                    <div className="text-[10px] text-gray-500">{formatNumber(holder.shares_owned)}</div>
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

export default OwnershipChangesWidget;
