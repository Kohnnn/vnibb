'use client';

import { useEffect, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';

import { WidgetContainer } from '@/components/ui/WidgetContainer';
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states';
import { WidgetMeta } from '@/components/ui/WidgetMeta';
import { WidgetSkeleton } from '@/components/ui/widget-skeleton';
import { useGrowthRates } from '@/lib/queries';
import { buildGrowthBridgeRows } from '@/lib/financialDiscovery';
import { formatPercent } from '@/lib/units';
import { buildWidgetRuntime } from '@/lib/widgetRuntime';
import type { WidgetHealthState } from '@/lib/widgetHealth';
import { signedToneClass, priceBgVar, priceDirection } from '@/lib/priceColor';

interface GrowthBridgeWidgetProps {
  id: string;
  symbol: string;
  onRemove?: () => void;
  onDataChange?: (data: WidgetDataPayload) => void;
}

function widthForChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 0
  return Math.min(Math.abs(value), 100)
}

export function GrowthBridgeWidget({ id, symbol, onRemove, onDataChange }: GrowthBridgeWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const query = useGrowthRates(upperSymbol, Boolean(upperSymbol))

  const rows = useMemo(
    () => buildGrowthBridgeRows(query.data?.data || {}),
    [query.data?.data]
  )
  const hasData = rows.some((row) => row.annual !== null || row.quarter !== null)
  // A returned admission reason is content, not absence: a rejected basis or
  // unit is a different state from missing history and must be stated (#246).
  const withheldReasons = Array.from(new Set(
    rows.flatMap((row) => [row.annualReason, row.quarterReason]).filter((reason): reason is string => Boolean(reason)),
  ))
  const availableGrowthPoints = rows.reduce((count, row) => count + (row.annual !== null ? 1 : 0) + (row.quarter !== null ? 1 : 0), 0)
  const expectedGrowthPoints = 9
  const annualLabel = query.data?.data?.as_of?.annual || 'Annual'
  const quarterLabel = query.data?.data?.as_of?.quarter || 'Quarter'
  const growthHealth: WidgetHealthState | undefined = !hasData && !query.isLoading && !query.error
    ? {
        status: 'coverage_gap',
        label: 'Coverage gap',
        detail: `${upperSymbol} does not have enough annual or comparable-quarter history for growth bridge calculations.`,
      }
    : hasData && availableGrowthPoints < expectedGrowthPoints
      ? {
          status: 'limited',
          label: 'Partial growth set',
          detail: `${availableGrowthPoints} of ${expectedGrowthPoints} annual/quarter growth points are available.`,
        }
      : undefined

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: '/equity',
        endpoint: `/equity/${upperSymbol}/growth`,
        sourceLabel: 'Growth bridge',
        lastDataDate: null,
        fetchedAt: query.dataUpdatedAt,
        stale: Boolean(query.error && hasData),
        extra: {
          points: availableGrowthPoints,
          // An withheld rate travels with its reason, so downstream context
          // cannot present it as zero growth (#246).
          unavailable: Object.fromEntries(
            rows.filter((row) => row.annualReason || row.quarterReason)
              .map((row) => [row.key, { annual: row.annualReason, quarter: row.quarterReason }]),
          ),
        },
      }),
    )
  }, [onDataChange, hasData, query.dataUpdatedAt, query.error, upperSymbol, availableGrowthPoints, rows])

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
          <WidgetMeta updatedAt={null} fetchedAt={query.dataUpdatedAt} isFetching={query.isFetching && hasData} note={`${annualLabel} vs ${quarterLabel}`} health={growthHealth} align="right" />
        </div>

        {query.isLoading && !hasData ? (
          <WidgetSkeleton lines={7} />
        ) : query.error && !hasData ? (
          <WidgetError error={query.error as Error} onRetry={() => void query.refetch()} />
        ) : !hasData && withheldReasons.length > 0 ? (
          <div className="space-y-2" data-testid="growth-withheld">
            <div className="text-[11px] text-[var(--text-secondary)]">
              Growth is unavailable for {upperSymbol}: the retained statements do not form an admitted comparison.
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
              <ul className="space-y-1 text-[11px] text-[var(--color-warning)]">
                {rows.flatMap((row) => ([
                  row.annualReason ? <li key={`${row.key}-annual`}>{row.label} (annual): {row.annualReason}</li> : null,
                  row.quarterReason ? <li key={`${row.key}-quarter`}>{row.label} (quarter): {row.quarterReason}</li> : null,
                ]))}
              </ul>
            </div>
          </div>
        ) : !hasData ? (
          <WidgetEmpty
            message={`No growth bridge for ${upperSymbol}`}
            icon={<TrendingUp size={18} />}
            health={growthHealth}
            size="default"
          />
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
                        className={`absolute inset-y-0 left-0 ${priceBgVar(priceDirection(row.annual))}`}
                        style={{ width: `${widthForChange(row.annual)}%` }}
                      />
                      <div className="relative z-10 flex h-full items-center justify-between px-3 text-xs text-[var(--text-primary)]">
                        <span>{annualLabel}</span>
                        <span className={signedToneClass(row.annual)}>
                          {row.annual === null && row.annualReason
                            ? <span className="text-[10px] text-[var(--color-warning)]">{row.annualReason}</span>
                            : formatPercent(row.annual, { decimals: 1, input: 'percent', signed: true, clamp: 'yoy_change' })}
                          {row.annualLabel && <span className="ml-1 text-[10px] text-[var(--color-warning)]">({row.annualLabel})</span>}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Latest Comparable Quarter</div>
                    <div className="relative h-7 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
                      <div
                        className="absolute inset-y-0 left-0 bg-[var(--color-state-bg)]"
                        style={{ width: `${widthForChange(row.quarter)}%` }}
                      />
                      <div className="relative z-10 flex h-full items-center justify-between px-3 text-xs text-[var(--text-primary)]">
                        <span>{quarterLabel}</span>
                        <span className={row.quarter !== null && row.quarter >= 0 ? 'text-[var(--color-accent-primary)]' : 'text-[var(--color-warning)]'}>
                          {row.quarter === null && row.quarterReason
                            ? <span className="text-[10px]">{row.quarterReason}</span>
                            : formatPercent(row.quarter, { decimals: 1, input: 'percent', signed: true, clamp: 'yoy_change' })}
                          {row.quarterLabel && <span className="ml-1 text-[10px] text-[var(--color-warning)]">({row.quarterLabel})</span>}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div className="text-[10px] text-[var(--text-muted)]">
              Growth divides by the absolute prior-period value. Transition labels come from the source comparison, not the percentage sign.
            </div>
          </div>
        )}
      </div>
    </WidgetContainer>
  )
}

export default GrowthBridgeWidget
