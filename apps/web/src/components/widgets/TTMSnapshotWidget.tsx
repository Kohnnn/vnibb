'use client';

import { Activity } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useUnit } from '@/contexts/UnitContext';
import { useTTMSnapshot } from '@/lib/queries';
import { buildTTMSnapshotCards } from '@/lib/financialDiscovery';

interface TTMSnapshotWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

export function TTMSnapshotWidget({ id, symbol, onRemove }: TTMSnapshotWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const { config: unitConfig } = useUnit()
  const query = useTTMSnapshot(upperSymbol, Boolean(upperSymbol))

  const payload = query.data?.data
  const cards = buildTTMSnapshotCards(payload || {}, unitConfig)
  const hasData = cards.length > 0

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to inspect TTM snapshot" icon={<Activity size={18} />} />
  }

  return (
    <WidgetContainer
      title="TTM Snapshot"
      subtitle="Trailing-twelve-month fundamental pulse"
      symbol={upperSymbol}
      widgetId={id}
      onClose={onRemove}
      onRefresh={() => void query.refetch()}
      noPadding
      exportData={payload}
      exportFilename={`ttm_snapshot_${upperSymbol}`}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[11px] text-[var(--text-secondary)]">
            Latest trailing-twelve-month snapshot across income, cash flow, and balance sheet.
          </div>
          <WidgetMeta updatedAt={query.dataUpdatedAt} isFetching={query.isFetching && hasData} note={unitConfig.display === 'USD' ? 'TTM · USD display' : 'TTM · VND display'} align="right" />
        </div>

        {query.isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : query.error && !hasData ? (
          <WidgetError error={query.error as Error} onRetry={() => void query.refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="No TTM snapshot available yet" icon={<Activity size={18} />} />
        ) : (
          <div className="grid flex-1 grid-cols-2 gap-2 xl:grid-cols-4">
            {cards.map((card) => (
              <div key={card.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{card.label}</div>
                <div className={`mt-2 text-lg font-semibold ${card.tone}`}>{card.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetContainer>
  )
}

export default TTMSnapshotWidget
