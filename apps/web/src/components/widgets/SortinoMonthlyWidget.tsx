'use client'

import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Bar, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from 'recharts'
import { useQuantMetrics } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'

interface SortinoMonthlyWidgetProps {
  symbol: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function SortinoMonthlyWidget({ symbol }: SortinoMonthlyWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['sortino'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.sortino as
    | {
        error?: string
        monthly_sortino?: Record<string, number | null>
        monthly_sharpe?: Record<string, number | null>
        best_months?: string[]
        avoid_months?: string[]
      }
    | undefined

  const metricError = metric?.error || data?.error || null
  const sortino = metric?.monthly_sortino || {}
  const sharpe = metric?.monthly_sharpe || {}
  const rows = MONTHS.map((month) => ({
    month,
    sortino: typeof sortino[month] === 'number' ? Number(sortino[month]) : null,
    sharpe: typeof sharpe[month] === 'number' ? Number(sharpe[month]) : null,
  }))
  const maxAbs = Math.max(
    ...rows.map((row) => Math.max(Math.abs(row.sortino ?? 0), Math.abs(row.sharpe ?? 0))),
    1
  )
  const hasData = rows.some((row) => row.sortino !== null || row.sharpe !== null)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view Sortino profile" icon={<BarChart3 size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <BarChart3 size={12} className="text-cyan-400" />
          <span>Sortino Monthly</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {QUANT_PERIOD_OPTIONS.map((option) => (
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
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} Sortino vs Sharpe`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : metricError && !hasData ? (
        <WidgetEmpty message={metricError} icon={<BarChart3 size={18} />} />
      ) : !hasData ? (
        <WidgetEmpty message="Insufficient historical data for the selected period" icon={<BarChart3 size={18} />} />
      ) : (
        <>
          {data?.data?.warning ? (
            <div className="mb-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
              {data.data.warning}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Best Months</div>
              <div className="mt-1 text-sm font-semibold text-emerald-300">{metric?.best_months?.join(', ') || '-'}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Avoid Months</div>
              <div className="mt-1 text-sm font-semibold text-red-300">{metric?.avoid_months?.join(', ') || '-'}</div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 mb-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Monthly Risk-Adjusted Returns</div>
              <div className="text-[10px] text-[var(--text-secondary)]">Sortino and Sharpe</div>
            </div>
            <ChartMountGuard className="h-[150px]" minHeight={130}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows}>
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
                    formatter={(value: unknown, name?: string) => [Number(value ?? 0).toFixed(2), name || '']}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="sortino" name="Sortino" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="sharpe" name="Sharpe" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartMountGuard>
          </div>

          <div className="flex-1 overflow-auto space-y-1 pr-1">
            {rows.map((row) => {
              const currentSortino = row.sortino ?? 0
              const width = Math.max(2, (Math.abs(currentSortino) / maxAbs) * 100)
              return (
                <div key={row.month} className="flex items-center gap-2">
                  <div className="w-8 text-[10px] text-[var(--text-muted)]">{row.month}</div>
                  <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                    <div className={`h-full ${currentSortino >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`} style={{ width: `${width}%` }} />
                  </div>
                  <div className="w-14 text-[10px] text-right font-mono text-[var(--text-primary)]">S {(row.sortino ?? 0).toFixed(2)}</div>
                  <div className="w-14 text-[10px] text-right font-mono text-cyan-300">H {(row.sharpe ?? 0).toFixed(2)}</div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default SortinoMonthlyWidget
