'use client'

import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import { useHistoricalPrices, useForeignTrading } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, getQuantPeriodStartDate, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { buildVolumeProfile, type ProfileBar } from '@/lib/marketStructure'

interface MarketStructureWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
  onDataChange?: (data: unknown) => void
}

function fmtPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

function fmtCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(0)
}

export function MarketStructureWidget({ symbol, onDataChange }: MarketStructureWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('1Y')

  const startDate = useMemo(() => getQuantPeriodStartDate(period), [period])

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(upperSymbol, {
    startDate,
    interval: '1D',
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  })

  const { data: foreign } = useForeignTrading(upperSymbol, { limit: 60, enabled: Boolean(upperSymbol) })

  const bars = useMemo<ProfileBar[]>(() => {
    return (data?.data || []).map((bar) => ({
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }))
  }, [data])

  const profile = useMemo(() => (bars.length ? buildVolumeProfile(bars, 24) : null), [bars])
  const lastClose = bars.length ? bars[bars.length - 1].close : null
  const hasData = Boolean(profile)

  const foreignNet = useMemo(() => {
    const rows = foreign?.data || []
    let sum = 0
    let seen = false
    for (const row of rows) {
      const value = Number(row.net_value)
      if (Number.isFinite(value)) {
        sum += value
        seen = true
      }
    }
    return seen ? sum : null
  }, [foreign])

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !hasData, compactHeight: 6 },
        provenance: {
          sourceLabel: 'Volume profile (derived) + foreign flow',
          apiGroup: '/equity',
          endpoint: `/equity/historical?symbol=${upperSymbol}`,
          adjustmentMode: 'adjusted',
          updatedAt: data?.meta?.last_data_date ?? (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined),
        },
      },
      ...(profile
        ? {
            poc: profile.poc,
            vah: profile.vah,
            val: profile.val,
            keyLevels: profile.keyLevels,
            foreignNet,
          }
        : {}),
    })
  }, [hasData, onDataChange, upperSymbol, profile, foreignNet, data?.meta?.last_data_date, dataUpdatedAt])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view market structure" icon={<LayoutGrid size={18} />} />
  }
  if (isLoading && !hasData) return <WidgetSkeleton />
  if (error && !hasData) return <WidgetError title="Failed to load price history" onRetry={() => refetch()} />
  if (!hasData) {
    return (
      <WidgetEmpty
        message={`Not enough history for ${upperSymbol}`}
        icon={<LayoutGrid size={18} />}
        detail="Market structure needs adjusted EOD bars to build a volume-by-price profile."
      />
    )
  }

  const orderedBins = [...profile!.bins].reverse() // high price at top

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <LayoutGrid size={12} className="text-cyan-400" />
          <span>Market Structure</span>
        </div>
        <div className="flex items-center gap-1">
          {QUANT_PERIOD_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPeriod(option)}
              className={
                period === option
                  ? 'rounded bg-cyan-600/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300'
                  : 'rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {/* Header KPIs */}
      <div className="grid grid-cols-4 gap-1 px-1">
        <Kpi label="Last" value={fmtPrice(lastClose)} />
        <Kpi label="POC" value={fmtPrice(profile!.poc)} tone="text-amber-400" />
        <Kpi label="VAH" value={fmtPrice(profile!.vah)} tone="text-emerald-400" />
        <Kpi label="VAL" value={fmtPrice(profile!.val)} tone="text-red-400" />
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-1">
        {/* Volume-by-price horizontal bars */}
        <div className="space-y-0.5">
          {orderedBins.map((bin, index) => {
            const widthPct = profile!.maxBinVolume > 0 ? (bin.volume / profile!.maxBinVolume) * 100 : 0
            const atPrice = lastClose !== null && Math.abs(bin.price - lastClose) < (profile!.vah! - profile!.val!) / 24
            return (
              <div key={index} className="flex items-center gap-1 text-[9px]">
                <span className="w-12 shrink-0 text-right text-[var(--text-muted)]">{bin.price.toFixed(1)}</span>
                <div className="relative h-2.5 flex-1 rounded-sm bg-[var(--bg-tertiary)]/30">
                  <div
                    className={
                      bin.isPoc
                        ? 'h-full rounded-sm bg-amber-500/70'
                        : bin.inValueArea
                          ? 'h-full rounded-sm bg-cyan-500/50'
                          : 'h-full rounded-sm bg-[var(--text-muted)]/30'
                    }
                    style={{ width: `${Math.max(1, widthPct)}%` }}
                  />
                  {atPrice && <div className="absolute inset-y-0 right-0 w-[2px] bg-[var(--accent-blue)]" />}
                </div>
              </div>
            )
          })}
        </div>

        {/* Key levels */}
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Key high-volume levels
          </div>
          <div className="space-y-0.5 text-[10px]">
            {profile!.keyLevels.map((level, i) => {
              const dist =
                lastClose && lastClose > 0 ? ((level.price - lastClose) / lastClose) * 100 : null
              return (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">{level.price.toFixed(2)}</span>
                  <span className="text-[var(--text-muted)]">{level.volumePct.toFixed(1)}% vol</span>
                  <span className={dist === null ? 'text-[var(--text-muted)]' : dist >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {dist === null ? '—' : `${dist >= 0 ? '+' : ''}${dist.toFixed(1)}%`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Foreign flow tilt */}
        {foreignNet !== null && (
          <div className="mt-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-2 py-1.5 text-[10px]">
            <span className="text-[var(--text-muted)]">Foreign net (last ~60 sessions): </span>
            <span className={foreignNet >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
              {foreignNet >= 0 ? '+' : ''}
              {fmtCompact(foreignNet)}
            </span>
          </div>
        )}
      </div>

      <WidgetMeta
        className="px-1 pt-1"
        isFetching={isFetching}
        updatedAt={data?.meta?.last_data_date ?? dataUpdatedAt}
        sourceLabel="Adjusted EOD · derived"
        align="right"
      />
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-1.5 py-1 text-center">
      <div className="text-[8px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`text-[11px] font-bold ${tone || 'text-[var(--text-primary)]'}`}>{value}</div>
    </div>
  )
}

export default MarketStructureWidget
