'use client'

import { CalendarDays } from 'lucide-react'
import { useHistoricalPrices } from '@/lib/queries'
import type { OHLCData } from '@/lib/chartUtils'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface SeasonalityHeatmapWidgetProps {
  symbol: string
}

interface MonthlyReturn {
  year: number
  month: number
  returnPct: number
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function toMonthKey(date: Date): string {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

function computeMonthlyReturns(candles: OHLCData[]): MonthlyReturn[] {
  const grouped = new Map<string, { year: number; month: number; first: number; last: number }>()

  const sorted = candles
    .filter((candle) => Number.isFinite(candle.close))
    .slice()
    .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())

  for (const candle of sorted) {
    const parsed = new Date(String(candle.time))
    if (!Number.isFinite(parsed.getTime())) continue

    const key = toMonthKey(parsed)
    const close = Number(candle.close)
    const year = parsed.getUTCFullYear()
    const month = parsed.getUTCMonth()

    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, { year, month, first: close, last: close })
      continue
    }

    existing.last = close
  }

  return [...grouped.values()]
    .map((entry) => ({
      year: entry.year,
      month: entry.month,
      returnPct: entry.first > 0 ? ((entry.last - entry.first) / entry.first) * 100 : 0,
    }))
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year))
}

function buildHeatmap(rows: MonthlyReturn[]) {
  const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => b - a)
  const matrix = new Map<number, Array<number | null>>()

  for (const year of years) {
    matrix.set(year, Array.from({ length: 12 }, () => null))
  }

  for (const row of rows) {
    const yearRow = matrix.get(row.year)
    if (!yearRow) continue
    yearRow[row.month] = row.returnPct
  }

  return { years, matrix }
}

function computeMonthlyAverages(rows: MonthlyReturn[]): Array<number | null> {
  const grouped = Array.from({ length: 12 }, () => ({ sum: 0, count: 0 }))

  for (const row of rows) {
    grouped[row.month].sum += row.returnPct
    grouped[row.month].count += 1
  }

  return grouped.map((month) => (month.count > 0 ? month.sum / month.count : null))
}

function getCellClass(value: number | null): string {
  if (value === null) return 'bg-gray-800/20 text-gray-500'
  if (value >= 8) return 'bg-emerald-500/60 text-emerald-100'
  if (value >= 4) return 'bg-emerald-500/40 text-emerald-100'
  if (value > 0) return 'bg-emerald-500/20 text-emerald-200'
  if (value <= -8) return 'bg-red-500/60 text-red-100'
  if (value <= -4) return 'bg-red-500/40 text-red-100'
  return 'bg-red-500/20 text-red-200'
}

function getBestAndWorstMonth(monthlyAverages: Array<number | null>) {
  let best: { month: number; value: number } | null = null
  let worst: { month: number; value: number } | null = null

  monthlyAverages.forEach((value, month) => {
    if (value === null) return

    if (!best || value > best.value) {
      best = { month, value }
    }
    if (!worst || value < worst.value) {
      worst = { month, value }
    }
  })

  return { best, worst }
}

export function SeasonalityHeatmapWidget({ symbol }: SeasonalityHeatmapWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(
    upperSymbol,
    {
      startDate: new Date(Date.now() - 9 * 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      enabled: Boolean(upperSymbol),
    }
  )

  const candles = (data?.data || []) as OHLCData[]
  const monthlyReturns = computeMonthlyReturns(candles)
  const hasData = monthlyReturns.length > 12
  const isFallback = Boolean(error && hasData)

  const { years, matrix } = buildHeatmap(monthlyReturns)
  const monthlyAverages = computeMonthlyAverages(monthlyReturns)
  const { best, worst } = getBestAndWorstMonth(monthlyAverages)

  const positiveCount = monthlyAverages.filter((value) => value !== null && value > 0).length
  const totalMonths = monthlyAverages.filter((value) => value !== null).length
  const hitRate = totalMonths > 0 ? (positiveCount / totalMonths) * 100 : 0

  if (!upperSymbol) {
    return (
      <WidgetEmpty message="Select a symbol to view seasonality heatmap" icon={<CalendarDays size={18} />} />
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <CalendarDays size={12} className="text-cyan-400" />
          <span>Monthly Seasonality</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          note="Year x Month"
          align="right"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="text-gray-500 uppercase tracking-widest">Best Avg</div>
          <div className="text-emerald-300 font-mono">
            {best ? `${MONTH_LABELS[best.month]} ${formatPct(best.value)}` : '-'}
          </div>
        </div>
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="text-gray-500 uppercase tracking-widest">Worst Avg</div>
          <div className="text-red-300 font-mono">
            {worst ? `${MONTH_LABELS[worst.month]} ${formatPct(worst.value)}` : '-'}
          </div>
        </div>
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="text-gray-500 uppercase tracking-widest">Hit Rate</div>
          <div className="text-cyan-300 font-mono">{hitRate.toFixed(0)}%</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto pr-1">
        {isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="Not enough historical months for heatmap" icon={<CalendarDays size={18} />} />
        ) : (
          <div className="min-w-[520px] space-y-2">
            <div className="grid grid-cols-[56px_repeat(12,minmax(0,1fr))] gap-1 text-[10px] text-gray-500">
              <div />
              {MONTH_LABELS.map((month) => (
                <div key={month} className="text-center uppercase tracking-widest">
                  {month}
                </div>
              ))}
            </div>

            {years.map((year) => (
              <div key={year} className="grid grid-cols-[56px_repeat(12,minmax(0,1fr))] gap-1 text-[10px]">
                <div className="text-gray-400 font-medium flex items-center">{year}</div>
                {(matrix.get(year) ?? []).map((value, monthIdx) => (
                  <div
                    key={`${year}-${monthIdx}`}
                    className={`h-7 rounded border border-gray-800/30 flex items-center justify-center font-mono ${getCellClass(
                      value
                    )}`}
                    title={`${year} ${MONTH_LABELS[monthIdx]}: ${formatPct(value)}`}
                  >
                    {value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}`}
                  </div>
                ))}
              </div>
            ))}

            <div className="grid grid-cols-[56px_repeat(12,minmax(0,1fr))] gap-1 text-[10px]">
              <div className="text-cyan-300 font-semibold flex items-center">Avg</div>
              {monthlyAverages.map((value, monthIdx) => (
                <div
                  key={`avg-${monthIdx}`}
                  className={`h-7 rounded border border-cyan-500/20 flex items-center justify-center font-mono ${
                    value === null
                      ? 'bg-gray-800/20 text-gray-500'
                      : value >= 0
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'bg-red-500/20 text-red-200'
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
