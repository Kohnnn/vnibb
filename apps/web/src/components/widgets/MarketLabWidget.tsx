'use client'

import { useEffect, useMemo, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useHistoricalPrices } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, getQuantPeriodStartDate, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import {
  computeMarketLabStats,
  marketLabStatsToRows,
  MONTH_LABELS,
  type MarketLabBar,
} from '@/lib/marketLabStats'

interface MarketLabWidgetProps {
  symbol: string
  isEditing?: boolean
  onRemove?: () => void
  onDataChange?: (data: unknown) => void
}

function valueTone(value: number | null, goodPositive = true): string {
  if (value === null) return 'text-[var(--text-secondary)]'
  const positive = value >= 0
  if (goodPositive) return positive ? 'text-emerald-400' : 'text-red-400'
  return positive ? 'text-red-400' : 'text-emerald-400'
}

export function MarketLabWidget({ symbol, onDataChange }: MarketLabWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('3Y')

  const startDate = useMemo(() => getQuantPeriodStartDate(period), [period])

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(upperSymbol, {
    startDate,
    interval: '1D',
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  })

  const bars = useMemo<MarketLabBar[]>(() => {
    const rows = data?.data || []
    return rows.map((bar) => ({ time: bar.time, close: bar.close, volume: bar.volume }))
  }, [data])

  const stats = useMemo(() => (bars.length ? computeMarketLabStats(upperSymbol, bars) : null), [bars, upperSymbol])
  const hasData = Boolean(stats)

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !hasData, compactHeight: 6 },
        provenance: {
          sourceLabel: 'Market Lab (derived)',
          apiGroup: '/equity',
          endpoint: `/equity/historical?symbol=${upperSymbol}`,
          adjustmentMode: 'adjusted',
          updatedAt: data?.meta?.last_data_date ?? (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined),
        },
      },
      ...(stats ? { stats, rows: marketLabStatsToRows(stats) } : {}),
    })
  }, [hasData, onDataChange, upperSymbol, stats, data?.meta?.last_data_date, dataUpdatedAt])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to run the market lab" icon={<FlaskConical size={18} />} />
  }

  if (isLoading && !hasData) return <WidgetSkeleton />
  if (error && !hasData) return <WidgetError title="Failed to load price history" onRetry={() => refetch()} />
  if (!hasData) {
    return (
      <WidgetEmpty
        message={`Not enough history for ${upperSymbol}`}
        icon={<FlaskConical size={18} />}
        detail="Market Lab needs a few weeks of adjusted EOD bars to compute return and risk statistics."
      />
    )
  }

  const monthlyMax = Math.max(
    1,
    ...stats!.monthlyAvgReturnPct.map((v) => (v === null ? 0 : Math.abs(v))),
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <FlaskConical size={12} className="text-cyan-400" />
          <span>Market Lab</span>
          <span className="text-[10px] text-[var(--text-muted)]">descriptive · not predictive</span>
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

      <div className="flex-1 overflow-y-auto px-1">
        {/* Headline risk/return cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Ann. return" value={stats!.annualizedReturnPct} suffix="%" tone={valueTone(stats!.annualizedReturnPct)} />
          <Stat label="Ann. volatility" value={stats!.annualizedVolPct} suffix="%" />
          <Stat label="Sharpe" value={stats!.sharpe} tone={valueTone(stats!.sharpe)} digits={2} />
          <Stat label="Sortino" value={stats!.sortino} tone={valueTone(stats!.sortino)} digits={2} />
          <Stat label="Max drawdown" value={stats!.maxDrawdownPct} suffix="%" tone="text-red-400" />
          <Stat label="VaR 95% (1d)" value={stats!.var95Pct} suffix="%" tone="text-amber-400" />
        </div>

        {/* Distribution */}
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
          <KV label="CVaR 95%" value={stats!.cvar95Pct} suffix="%" />
          <KV label="Skew" value={stats!.skew} digits={2} />
          <KV label="Excess kurt." value={stats!.excessKurtosis} digits={2} />
          <KV label="Pos. day ratio" value={stats!.positiveDayRatio !== null ? stats!.positiveDayRatio * 100 : null} suffix="%" />
          <KV label="Best day" value={stats!.bestDayPct} suffix="%" />
          <KV label="Worst day" value={stats!.worstDayPct} suffix="%" />
          <KV label="Bars" value={stats!.barCount} digits={0} />
        </div>

        {/* Monthly seasonality strip */}
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Avg return by month
          </div>
          <div className="flex items-end gap-1" style={{ height: 56 }}>
            {stats!.monthlyAvgReturnPct.map((value, index) => {
              const height = value === null ? 0 : (Math.abs(value) / monthlyMax) * 44
              const positive = (value ?? 0) >= 0
              return (
                <div key={MONTH_LABELS[index]} className="flex flex-1 flex-col items-center justify-end gap-0.5">
                  <div
                    className={positive ? 'w-full rounded-sm bg-emerald-500/60' : 'w-full rounded-sm bg-red-500/60'}
                    style={{ height: Math.max(2, height) }}
                    title={value === null ? 'No data' : `${MONTH_LABELS[index]}: ${value.toFixed(2)}%`}
                  />
                  <span className="text-[8px] text-[var(--text-muted)]">{MONTH_LABELS[index][0]}</span>
                </div>
              )
            })}
          </div>
        </div>
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

function Stat({
  label,
  value,
  suffix,
  tone,
  digits = 1,
}: {
  label: string
  value: number | null
  suffix?: string
  tone?: string
  digits?: number
}) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`text-sm font-bold ${tone || 'text-[var(--text-primary)]'}`}>
        {value === null ? '—' : `${value.toFixed(digits)}${suffix || ''}`}
      </div>
    </div>
  )
}

function KV({
  label,
  value,
  suffix,
  digits = 2,
}: {
  label: string
  value: number | null
  suffix?: string
  digits?: number
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-semibold text-[var(--text-primary)]">
        {value === null ? '—' : `${value.toFixed(digits)}${suffix || ''}`}
      </span>
    </div>
  )
}

export default MarketLabWidget
