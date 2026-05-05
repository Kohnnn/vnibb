'use client'

import { useState } from 'react'
import { Signal } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useQuantMetrics } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'

interface RSISeasonalWidgetProps {
  symbol: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function rsiClass(rsi: number): string {
  if (rsi >= 70) return 'text-red-300'
  if (rsi <= 30) return 'text-emerald-300'
  return 'text-amber-300'
}

export function RSISeasonalWidget({ symbol }: RSISeasonalWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['rsi_seasonal'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.rsi_seasonal as
    | {
        current_rsi?: number | null
        monthly_avg_rsi?: Record<string, number | null>
        overbought_pct?: Record<string, number | null>
        oversold_pct?: Record<string, number | null>
      }
    | undefined

  const avgRsi = metric?.monthly_avg_rsi || {}
  const overbought = metric?.overbought_pct || {}
  const oversold = metric?.oversold_pct || {}
  const rows = MONTHS.map((month) => ({
    month,
    rsi: Number(avgRsi[month] ?? 0),
    overbought: Number(overbought[month] ?? 0),
    oversold: Number(oversold[month] ?? 0),
  }))
  const hasData = rows.some((row) => row.rsi > 0)
  const currentRsi = Number(metric?.current_rsi ?? 0)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view RSI seasonality" icon={<Signal size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Signal size={12} className="text-cyan-400" />
          <span>RSI Seasonal Profile</span>
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
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} RSI(14)`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No RSI seasonal data" icon={<Signal size={18} />} />
      ) : (
        <>
          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">Current RSI</div>
            <div className={`text-lg font-semibold ${rsiClass(currentRsi)}`}>{currentRsi.toFixed(2)}</div>
          </div>

          <div className="mb-2 flex min-h-[210px] flex-col rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Monthly RSI + OB/OS Risk</div>
              <div className="text-[10px] text-[var(--text-secondary)]">{period} profile</div>
            </div>
            <ChartMountGuard className="flex-1 min-h-[150px]" minHeight={150}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="rsi" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="risk" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value: unknown, name?: string) => {
                      const label = name || ''
                      if (label === 'RSI') return [Number(value).toFixed(2), label]
                      return [`${Number(value).toFixed(2)}%`, label]
                    }}
                  />
                  <Bar yAxisId="rsi" dataKey="rsi" name="RSI" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                  <Line yAxisId="risk" type="monotone" dataKey="overbought" name="Overbought %" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line yAxisId="risk" type="monotone" dataKey="oversold" name="Oversold %" stroke="#22c55e" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartMountGuard>
          </div>

          <div className="flex-1 overflow-auto space-y-1 pr-1">
            {rows.map((row) => (
              <div key={row.month} className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-[var(--text-secondary)]">{row.month}</span>
                  <span className={`font-mono ${rsiClass(row.rsi)}`}>{row.rsi.toFixed(2)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="text-red-300">OB: {row.overbought.toFixed(1)}%</div>
                  <div className="text-emerald-300">OS: {row.oversold.toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default RSISeasonalWidget
