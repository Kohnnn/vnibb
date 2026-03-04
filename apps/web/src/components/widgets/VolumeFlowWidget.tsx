'use client'

import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Waves } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useQuantMetrics } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'

interface VolumeFlowWidgetProps {
  symbol: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PERIOD_OPTIONS = ['1Y', '3Y', '5Y'] as const

type PeriodOption = (typeof PERIOD_OPTIONS)[number]

interface CumulativePoint {
  date: string
  delta: number | null
  cumulative_delta: number | null
  close: number | null
}

function formatCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  return value.toFixed(2)
}

export function VolumeFlowWidget({ symbol }: VolumeFlowWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<PeriodOption>('5Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['volume_delta'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.volume_delta as
    | {
        monthly_avg?: Record<string, number | null>
        cumulative?: CumulativePoint[]
        current_20d_cumulative_delta?: number | null
        strongest_buy_month?: string | null
        strongest_sell_month?: string | null
        divergence_months?: number
      }
    | undefined
  const backendError = typeof data?.error === 'string' ? data.error : ''

  const monthlyAvg = metric?.monthly_avg || {}
  const monthRows = MONTHS.map((month) => ({ month, value: Number(monthlyAvg[month] ?? 0) }))
  const cumulativeRows = (metric?.cumulative || [])
    .filter((row) => Boolean(row?.date))
    .map((row) => ({
      date: row.date,
      cumulativeDelta: Number(row.cumulative_delta ?? 0),
      close: Number(row.close ?? 0),
    }))
  const maxAbs = Math.max(...monthRows.map((row) => Math.abs(row.value)), 1)
  const hasData = monthRows.some((row) => row.value !== 0)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view volume flow" icon={<Waves size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Waves size={12} className="text-cyan-400" />
          <span>Volume Flow (Order Flow Proxy)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/70'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta updatedAt={dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} delta`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty
          message={backendError || `Insufficient Data: Expected at least 30 sessions, got ${cumulativeRows.length}.`}
          icon={<Waves size={18} />}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">20D Cumulative</div>
              <div className={`font-mono ${Number(metric?.current_20d_cumulative_delta || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {formatCompact(Number(metric?.current_20d_cumulative_delta || 0))}
              </div>
            </div>
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">Divergence Months</div>
              <div className="font-mono text-amber-300">{metric?.divergence_months ?? 0}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">Strongest Buy</div>
              <div className="text-emerald-300 font-semibold">{metric?.strongest_buy_month || '-'}</div>
            </div>
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">Strongest Sell</div>
              <div className="text-red-300 font-semibold">{metric?.strongest_sell_month || '-'}</div>
            </div>
          </div>

          <div className="flex-1 overflow-auto space-y-2 pr-1">
            <div className="rounded-md border border-gray-800/60 bg-black/20 p-2">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-gray-500">Monthly Avg Delta</div>
                <div className="text-[10px] text-gray-400">Green buying / Red selling</div>
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
                      formatter={(value) => formatCompact(Number(value))}
                    />
                    <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                      {monthRows.map((entry) => (
                        <Cell key={`month-bar-${entry.month}`} fill={entry.value >= 0 ? '#22c55e' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            </div>

            <div className="rounded-md border border-gray-800/60 bg-black/20 p-2">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-gray-500">Cumulative Delta vs Price</div>
                <div className="text-[10px] text-gray-400">Last 252 sessions</div>
              </div>
              {cumulativeRows.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-gray-500">No cumulative delta series</div>
              ) : (
                <ChartMountGuard className="h-[130px]" minHeight={120}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cumulativeRows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="delta" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          fontSize: '11px',
                        }}
                      />
                      <Line yAxisId="delta" type="monotone" dataKey="cumulativeDelta" stroke="#06b6d4" strokeWidth={2} dot={false} name="Cumulative Delta" />
                      <Line yAxisId="price" type="monotone" dataKey="close" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Close" />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartMountGuard>
              )}
            </div>

            <div className="space-y-1">
              {monthRows.map((row) => {
                const isPositive = row.value >= 0
                const width = Math.max(2, (Math.abs(row.value) / maxAbs) * 100)
                return (
                  <div key={row.month} className="flex items-center gap-2">
                    <div className="w-8 text-[10px] text-gray-500">{row.month}</div>
                    <div className="flex-1 h-4 bg-gray-800/30 rounded overflow-hidden">
                      <div className={`h-full ${isPositive ? 'bg-emerald-500/70' : 'bg-red-500/70'}`} style={{ width: `${width}%` }} />
                    </div>
                    <div className={`w-16 text-[10px] text-right font-mono ${isPositive ? 'text-emerald-300' : 'text-red-300'}`}>
                      {formatCompact(row.value)}
                    </div>
                    {isPositive ? <ArrowUpRight size={10} className="text-emerald-400" /> : <ArrowDownRight size={10} className="text-red-400" />}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default VolumeFlowWidget
