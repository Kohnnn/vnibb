'use client'

import { useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { useSeasonalityMatrix } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'

interface SeasonalitySpiralHeatmapWidgetProps {
  symbol: string
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function getFill(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'rgba(71,85,105,0.45)'
  if (value >= 8) return 'rgba(16,185,129,0.86)'
  if (value >= 4) return 'rgba(16,185,129,0.62)'
  if (value > 0) return 'rgba(16,185,129,0.34)'
  if (value <= -8) return 'rgba(244,63,94,0.86)'
  if (value <= -4) return 'rgba(244,63,94,0.62)'
  return 'rgba(244,63,94,0.34)'
}

export function SeasonalitySpiralHeatmapWidget({ symbol }: SeasonalitySpiralHeatmapWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSeasonalityMatrix(upperSymbol, {
    period,
    granularity: 'daily',
    enabled: Boolean(upperSymbol),
  })

  const payload = data?.data
  const rows = payload?.rows || []
  const hasData = rows.length > 0
  const isFallback = Boolean(error && hasData)
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  const cells = useMemo(() => {
    return [...rows]
      .map((row) => {
        const date = new Date(row.start_date || row.label || '')
        return {
          id: row.start_date || `${row.row_key}-${row.column}-${row.label}`,
          label: row.label || `${row.row_key} ${row.column}`,
          value: row.return_pct ?? null,
          time: Number.isNaN(date.getTime()) ? 0 : date.getTime(),
        }
      })
      .filter((row) => row.time > 0)
      .sort((a, b) => a.time - b.time)
  }, [rows])

  const geometry = useMemo(() => {
    const center = 170
    const startRadius = 26
    const step = 0.44
    const angleStep = 0.39
    return cells.map((cell, index) => {
      const angle = index * angleStep - Math.PI / 2
      const radius = startRadius + index * step
      return {
        ...cell,
        x: center + Math.cos(angle) * radius,
        y: center + Math.sin(angle) * radius,
        rotate: (angle * 180) / Math.PI,
      }
    })
  }, [cells])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view daily spiral seasonality" icon={<CalendarDays size={18} />} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 py-1">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <CalendarDays size={12} className="text-cyan-400" />
          <span>Daily Spiral Heatmap</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  period === option
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={payload?.last_data_date ?? payload?.computed_at ?? dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={`${period} daily returns`}
            align="right"
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[radial-gradient(circle_at_center,rgba(14,165,233,0.08),transparent_60%)]">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Daily spiral seasonality took too long to load.')}
            onRetry={() => {
              resetTimeout()
              refetch()
            }}
          />
        ) : isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : data?.error && !hasData ? (
          <WidgetEmpty message={data.error} icon={<CalendarDays size={18} />} />
        ) : !hasData ? (
          <WidgetEmpty message="Insufficient daily data for spiral seasonality" icon={<CalendarDays size={18} />} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-auto">
              <svg viewBox="0 0 340 340" className="mx-auto h-full min-h-[300px] max-h-[640px] w-full max-w-[720px]">
                <circle cx="170" cy="170" r="24" fill="rgba(15,23,42,0.72)" stroke="rgba(148,163,184,0.25)" />
                <text x="170" y="166" textAnchor="middle" className="fill-slate-200 text-[10px] font-bold">Daily</text>
                <text x="170" y="180" textAnchor="middle" className="fill-slate-400 text-[8px]">old to new</text>
                {geometry.map((cell) => (
                  <rect
                    key={cell.id}
                    x={cell.x - 2.8}
                    y={cell.y - 2.8}
                    width="5.6"
                    height="5.6"
                    rx="1.6"
                    fill={getFill(cell.value)}
                    stroke="rgba(15,23,42,0.55)"
                    strokeWidth="0.35"
                    transform={`rotate(${cell.rotate} ${cell.x} ${cell.y})`}
                  >
                    <title>{`${cell.label}: ${formatPct(cell.value)}`}</title>
                  </rect>
                ))}
              </svg>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
              <span>Spiral denotes each trading day from oldest center-adjacent cells to newest outer cells.</span>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-5 rounded bg-rose-500/70" /> negative
                <span className="h-2.5 w-5 rounded bg-slate-500/60" /> flat/missing
                <span className="h-2.5 w-5 rounded bg-emerald-500/70" /> positive
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SeasonalitySpiralHeatmapWidget
