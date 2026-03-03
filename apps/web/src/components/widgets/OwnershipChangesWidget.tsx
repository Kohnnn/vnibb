'use client';

import { Users } from 'lucide-react';
import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { useShareholders } from '@/lib/queries';
import { formatNumber } from '@/lib/formatters';

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
  const ownershipValues = holders
    .map((holder) => {
      const row = holder as unknown as Record<string, number | null | undefined>
      const value = holder.ownership_pct ?? row.ownership ?? row.share_own_percent
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    })
    .filter((value): value is number => value !== null)
  const treatOwnershipAsRatio =
    ownershipValues.length > 0 && ownershipValues.every((value) => Math.abs(value) <= 1)

  const formatOwnershipPct = (value: number | null | undefined): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return '-'
    const normalized = treatOwnershipAsRatio ? value * 100 : value
    return `${normalized.toFixed(2)}%`
  }

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
      <div className="h-full flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="px-3 py-2 border-b border-[var(--border-color)]/70">
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
              {holders.map((holder, idx) => {
                const row = holder as unknown as Record<string, string | number | null | undefined>
                const holderName =
                  (holder.shareholder_name || row.name || row.share_holder || 'Shareholder') as string
                const holderType =
                  (holder.shareholder_type || row.type || row.owner_type || '-') as string
                const ownershipValue =
                  holder.ownership_pct ??
                  (typeof row.ownership === 'number' ? row.ownership : null) ??
                  (typeof row.share_own_percent === 'number' ? row.share_own_percent : null)
                const sharesOwned =
                  holder.shares_owned ??
                  (typeof row.shares === 'number' ? row.shares : null) ??
                  (typeof row.quantity === 'number' ? row.quantity : null)

                return (
                  <div
                    key={`${holderName}-${idx}`}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-secondary)]/60 px-3 py-2"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        {holderName}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">{holderType || '-'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-mono text-[var(--text-primary)]">
                        {formatOwnershipPct(ownershipValue as number | null | undefined)}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {formatNumber(sharesOwned as number | null | undefined)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </WidgetContainer>
  );
}

export default OwnershipChangesWidget;
