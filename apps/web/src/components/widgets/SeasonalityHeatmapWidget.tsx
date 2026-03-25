'use client'

import { useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { useQuantMetrics } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface SeasonalityHeatmapWidgetProps {
  symbol: string
}

interface MonthlyReturnRow {
  year: number
  month: number
  label: string
  return_pct: number | null
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function getCellClass(value: number | null): string {
  if (value === null) return 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
  if (value >= 8) return 'bg-emerald-500/60 text-emerald-100'
  if (value >= 4) return 'bg-emerald-500/40 text-emerald-100'
  if (value > 0) return 'bg-emerald-500/20 text-emerald-200'
  if (value <= -8) return 'bg-rose-500/60 text-rose-100'
  if (value <= -4) return 'bg-rose-500/40 text-rose-100'
  return 'bg-rose-500/20 text-rose-200'
}

export function SeasonalityHeatmapWidget({ symbol }: SeasonalityHeatmapWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['seasonality'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.seasonality as
    | {
        error?: string
        monthly_returns?: MonthlyReturnRow[]
        monthly_average_return_pct?: Record<string, number | null>
        best_month?: string | null
        worst_month?: string | null
        hit_rate_pct?: number | null
        current_month?: MonthlyReturnRow | null
      }
    | undefined

  const metricError = metric?.error || data?.error || null
  const monthlyReturns = metric?.monthly_returns || []
  const hasData = monthlyReturns.length > 0
  const isFallback = Boolean(error && hasData)

  const years = useMemo(
    () => [...new Set(monthlyReturns.map((row) => row.year))].sort((a, b) => b - a),
    [monthlyReturns]
  )

  const matrix = useMemo(() => {
    const next = new Map<number, Array<number | null>>()
    years.forEach((year) => next.set(year, Array.from({ length: 12 }, () => null)))
    monthlyReturns.forEach((row) => {
      const yearRow = next.get(row.year)
      if (!yearRow) return
      yearRow[row.month - 1] = row.return_pct ?? null
    })
    return next
  }, [monthlyReturns, years])

  const monthlyAverages = MONTH_LABELS.map((month) => metric?.monthly_average_return_pct?.[month] ?? null)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view seasonality heatmap" icon={<CalendarDays size={18} />} />
  }

  return (
    <div className="flex h-full flex-col">
        <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <CalendarDays size={12} className="text-cyan-400" />
          <span>Monthly Seasonality</span>
        </div>
        <div className="flex items-center gap-2">
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
            updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={`${period} backend seasonality`}
            align="right"
          />
        </div>
      </div>

      <div className="mb-2 grid grid-cols-4 gap-2 text-[10px]">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Best Avg</div>
          <div className="mt-1 text-sm font-mono font-semibold text-emerald-300">{metric?.best_month || '-'}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Worst Avg</div>
          <div className="mt-1 text-sm font-mono font-semibold text-rose-300">{metric?.worst_month || '-'}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Hit Rate</div>
          <div className="mt-1 text-sm font-mono font-semibold text-cyan-300">{formatPct(metric?.hit_rate_pct)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Current Month</div>
          <div className="mt-1 text-sm font-mono font-semibold text-[var(--text-primary)]">
            {metric?.current_month ? `${metric.current_month.label} ${formatPct(metric.current_month.return_pct)}` : '-'}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto pr-1">
        {isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : metricError && !hasData ? (
          <WidgetEmpty message={metricError} icon={<CalendarDays size={18} />} />
        ) : !hasData ? (
          <WidgetEmpty message="Insufficient historical data for the selected period" icon={<CalendarDays size={18} />} />
        ) : (
          <div className="min-w-[520px] space-y-2">
            {data?.data?.warning ? (
              <div className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-200">
                {data.data.warning}
              </div>
            ) : null}
            <div className="grid grid-cols-[56px_repeat(12,minmax(0,1fr))] gap-1 text-[10px] text-[var(--text-muted)]">
              <div />
              {MONTH_LABELS.map((month) => (
                <div key={month} className="text-center uppercase tracking-widest">
                  {month}
                </div>
              ))}
            </div>

            {years.map((year) => (
              <div key={year} className="grid grid-cols-[56px_repeat(12,minmax(0,1fr))] gap-1 text-[10px]">
                <div className="flex items-center font-medium text-[var(--text-secondary)]">{year}</div>
                {(matrix.get(year) ?? []).map((value, monthIdx) => (
                  <div
                    key={`${year}-${monthIdx}`}
                    className={`flex h-7 items-center justify-center rounded border border-[var(--border-subtle)] font-mono ${getCellClass(value)}`}
                    title={`${year} ${MONTH_LABELS[monthIdx]}: ${formatPct(value)}`}
                  >
                    {value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}`}
                  </div>
                ))}
              </div>
            ))}

            <div className="grid grid-cols-[56px_repeat(12,minmax(0,1fr))] gap-1 text-[10px]">
              <div className="flex items-center font-semibold text-cyan-300">Avg</div>
              {monthlyAverages.map((value, monthIdx) => (
                <div
                  key={`avg-${monthIdx}`}
                  className={`flex h-7 items-center justify-center rounded border border-cyan-500/20 font-mono ${
                    value === null
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                      : value >= 0
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'bg-rose-500/20 text-rose-200'
                  }`}
                >
                  {value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}`}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SeasonalityHeatmapWidget
