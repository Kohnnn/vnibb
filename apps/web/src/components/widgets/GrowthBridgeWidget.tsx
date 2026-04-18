'use client';

import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useGrowthRates } from '@/lib/queries';
import { buildGrowthBridgeRows } from '@/lib/financialDiscovery';
import { formatPercent } from '@/lib/units';

interface GrowthBridgeWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
}

function widthForChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 0
  return Math.min(Math.abs(value), 100)
}

export function GrowthBridgeWidget({ id, symbol, onRemove }: GrowthBridgeWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const query = useGrowthRates(upperSymbol, Boolean(upperSymbol))

  const rows = useMemo(
    () => buildGrowthBridgeRows(query.data?.data || {}),
    [query.data?.data]
  )
  const hasData = rows.some((row) => row.annual !== null || row.quarter !== null)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view growth bridge" icon={<TrendingUp size={18} />} />
  }

  return (
    <WidgetContainer
      title="Growth Bridge"
      subtitle="Annual and latest comparable-quarter growth pulse"
      symbol={upperSymbol}
      widgetId={id}
      onClose={onRemove}
      onRefresh={() => void query.refetch()}
      noPadding
      exportData={query.data?.data}
      exportFilename={`growth_bridge_${upperSymbol}`}
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[11px] text-[var(--text-secondary)]">
            Compares annual YoY growth with the latest comparable quarter for core earnings drivers.
          </div>
          <WidgetMeta updatedAt={query.dataUpdatedAt} isFetching={query.isFetching && hasData} note={`${query.data?.data?.as_of?.annual || 'Annual'} vs ${query.data?.data?.as_of?.quarter || 'quarter'} `} align="right" />
        </div>

        {query.isLoading && !hasData ? (
          <WidgetSkeleton lines={7} />
        ) : query.error && !hasData ? (
          <WidgetError error={query.error as Error} onRetry={() => void query.refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="No growth bridge available yet" icon={<TrendingUp size={18} />} />
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.key} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{row.label}</div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">YoY growth</div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Annual</div>
                    <div className="relative h-7 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
                      <div
                        className={`absolute inset-y-0 left-0 ${row.annual !== null && row.annual >= 0 ? 'bg-emerald-500/35' : 'bg-rose-500/30'}`}
                        style={{ width: `${widthForChange(row.annual)}%` }}
                      />
                      <div className="relative z-10 flex h-full items-center justify-between px-3 text-xs text-[var(--text-primary)]">
                        <span>{query.data?.data?.as_of?.annual || 'Annual'}</span>
                        <span className={row.annual !== null && row.annual >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                          {formatPercent(row.annual, { decimals: 1, input: 'percent', clamp: 'yoy_change' })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Latest Comparable Quarter</div>
                    <div className="relative h-7 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
                      <div
                        className={`absolute inset-y-0 left-0 ${row.quarter !== null && row.quarter >= 0 ? 'bg-cyan-500/35' : 'bg-amber-500/30'}`}
                        style={{ width: `${widthForChange(row.quarter)}%` }}
                      />
                      <div className="relative z-10 flex h-full items-center justify-between px-3 text-xs text-[var(--text-primary)]">
                        <span>{query.data?.data?.as_of?.quarter || 'Quarter'}</span>
                        <span className={row.quarter !== null && row.quarter >= 0 ? 'text-cyan-300' : 'text-amber-300'}>
                          {formatPercent(row.quarter, { decimals: 1, input: 'percent', clamp: 'yoy_change' })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetContainer>
  )
}

export default GrowthBridgeWidget
