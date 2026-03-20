'use client'

import { useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useQuantMetrics } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'

interface GapAnalysisWidgetProps {
  symbol: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PERIOD_OPTIONS = ['6M', '1Y', '3Y', '5Y'] as const

type PeriodOption = (typeof PERIOD_OPTIONS)[number]

type GapRow = {
  date: string
  type: string
  gap_pct: number | null
  filled: boolean
  next_day_return_pct: number | null
}

export function GapAnalysisWidget({ symbol }: GapAnalysisWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<PeriodOption>('5Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['gap_stats'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.gap_stats as
    | {
        gap_up_frequency_pct?: number | null
        gap_down_frequency_pct?: number | null
        gap_fill_rate_pct?: number | null
        monthly_avg_gap_pct?: Record<string, number | null>
        top_gaps?: GapRow[]
      }
    | undefined

  const topGaps = metric?.top_gaps || []
  const monthlyAvgGap = metric?.monthly_avg_gap_pct || {}
  const monthRows = MONTHS.map((month) => ({
    month,
    value: Number(monthlyAvgGap[month] ?? 0),
  }))
  const maxAbs = Math.max(...monthRows.map((row) => Math.abs(row.value)), 1)
  const hasData = topGaps.length > 0

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view gap analysis" icon={<ArrowUpDown size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <ArrowUpDown size={12} className="text-cyan-400" />
          <span>Gap Analysis</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} gap stats`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No gap data" icon={<ArrowUpDown size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Gap Up</div>
              <div className="text-emerald-300 font-mono">{Number(metric?.gap_up_frequency_pct ?? 0).toFixed(2)}%</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Gap Down</div>
              <div className="text-red-300 font-mono">{Number(metric?.gap_down_frequency_pct ?? 0).toFixed(2)}%</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Fill Rate</div>
              <div className="text-cyan-300 font-mono">{Number(metric?.gap_fill_rate_pct ?? 0).toFixed(2)}%</div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 mb-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Monthly Avg Gap</div>
              <div className="text-[10px] text-[var(--text-secondary)]">Positive up / Negative down</div>
            </div>
            <ChartMountGuard className="h-[120px]" minHeight={110}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    domain={[-maxAbs, maxAbs]}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value: unknown) => [`${Number(value).toFixed(2)}%`, 'Avg Gap']}
                  />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {monthRows.map((entry) => (
                      <Cell key={`gap-month-${entry.month}`} fill={entry.value >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartMountGuard>
          </div>

          <div className="flex-1 overflow-auto pr-1">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[var(--text-muted)] border-b border-[var(--border-color)]">
                  <th className="text-left py-1">Date</th>
                  <th className="text-left py-1">Type</th>
                  <th className="text-right py-1">Gap %</th>
                  <th className="text-right py-1">Next Day</th>
                  <th className="text-center py-1">Fill</th>
                </tr>
              </thead>
              <tbody>
                {topGaps.slice(0, 10).map((row) => (
                  <tr key={`${row.date}-${row.type}-${row.gap_pct}`} className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                    <td className="py-1">{row.date}</td>
                    <td className={`py-1 ${row.type === 'gap_up' ? 'text-emerald-300' : row.type === 'gap_down' ? 'text-red-300' : 'text-[var(--text-muted)]'}`}>
                      {row.type}
                    </td>
                    <td className="py-1 text-right font-mono">{Number(row.gap_pct ?? 0).toFixed(2)}%</td>
                    <td className={`py-1 text-right font-mono ${Number(row.next_day_return_pct ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {Number(row.next_day_return_pct ?? 0).toFixed(2)}%
                    </td>
                    <td className={`py-1 text-center ${row.filled ? 'text-emerald-300' : 'text-[var(--text-muted)]'}`}>{row.filled ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default GapAnalysisWidget
