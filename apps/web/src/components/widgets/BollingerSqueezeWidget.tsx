'use client'

import { useState } from 'react'
import { CircleDot, Minimize2 } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
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

interface BollingerSqueezeWidgetProps {
  symbol: string
}

interface WidthPoint {
  date: string
  bb_width_pct: number | null
  close: number | null
}

export function BollingerSqueezeWidget({ symbol }: BollingerSqueezeWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('3Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['bollinger'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.bollinger as
    | {
        current_bb_pct?: number | null
        current_bb_width_pct?: number | null
        squeeze_threshold_pct?: number | null
        squeeze_active?: boolean
        bb_width_series?: WidthPoint[]
      }
    | undefined

  const bbPct = Number(metric?.current_bb_pct ?? 0)
  const bbWidth = Number(metric?.current_bb_width_pct ?? 0)
  const threshold = Number(metric?.squeeze_threshold_pct ?? 0)
  const widthSeries = (metric?.bb_width_series || [])
    .filter((row) => Boolean(row?.date))
    .map((row) => ({
      date: row.date,
      bbWidth: Number(row.bb_width_pct ?? 0),
      close: Number(row.close ?? 0),
    }))
  const hasData = bbWidth > 0 || widthSeries.length > 0
  const bbPctProgress = Math.max(0, Math.min(100, bbPct * 100))

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view Bollinger squeeze" icon={<Minimize2 size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Minimize2 size={12} className="text-cyan-400" />
          <span>Bollinger Squeeze</span>
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
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} BB(20,2)`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No Bollinger data" icon={<Minimize2 size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Current BB%</div>
              <div className="font-mono text-cyan-300">{bbPctProgress.toFixed(2)}%</div>
              <div className="mt-1 h-1.5 rounded bg-[var(--bg-tertiary)] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-red-500"
                  style={{ width: `${bbPctProgress}%` }}
                />
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Width</div>
              <div className="font-mono text-amber-300">{bbWidth.toFixed(3)}%</div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 mb-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">BB Width Regime</div>
              <div className="text-[10px] text-[var(--text-secondary)]">Threshold {threshold.toFixed(3)}%</div>
            </div>
            {widthSeries.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-[var(--text-muted)]">No width series</div>
            ) : (
              <ChartMountGuard className="h-[130px]" minHeight={120}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={widthSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      formatter={(value, name) => {
                        const label = typeof name === 'string' ? name : String(name ?? '')
                        const withPercent = label === 'BB Width %' || label === 'Threshold'
                        return [`${Number(value).toFixed(3)}${withPercent ? '%' : ''}`, label]
                      }}
                    />
                    <ReferenceLine y={threshold} stroke="#22c55e" strokeDasharray="4 3" ifOverflow="extendDomain" label={{ value: 'Squeeze Threshold', fill: '#22c55e', fontSize: 10, position: 'insideTopRight' }} />
                    <Line type="monotone" dataKey="bbWidth" name="BB Width %" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            )}
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--text-muted)] uppercase tracking-widest">Squeeze State</span>
              <span className="text-[var(--text-secondary)]">Threshold: {threshold.toFixed(3)}%</span>
            </div>
            <div className={`mt-1 flex items-center gap-2 text-sm font-semibold ${metric?.squeeze_active ? 'text-emerald-300' : 'text-[var(--text-secondary)]'}`}>
              <CircleDot size={14} className={metric?.squeeze_active ? 'text-emerald-400' : 'text-[var(--text-muted)]'} />
              {metric?.squeeze_active ? 'SQUEEZE ACTIVE' : 'NORMAL'}
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-[11px] text-[var(--text-secondary)] leading-relaxed">
            Low BB width often indicates compressed volatility. Watch for expansion after a squeeze, especially when price holds above the mid band.
          </div>
        </>
      )}
    </div>
  )
}

export default BollingerSqueezeWidget
