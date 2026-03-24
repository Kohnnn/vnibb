'use client'

import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
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

interface DrawdownRecoveryWidgetProps {
  symbol: string
}

type UnderwaterPoint = {
  date: string
  drawdown_pct: number | null
  drawdown_52w_pct: number | null
}

type Episode = {
  peak_date: string
  trough_date: string
  recovery_date: string | null
  depth_pct: number | null
  days_to_trough: number
  days_to_recovery: number | null
}

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '-'
  return `${Number(value).toFixed(1)}%`
}

export function DrawdownRecoveryWidget({ symbol }: DrawdownRecoveryWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['drawdown_recovery'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.drawdown_recovery as
    | {
        current_drawdown_pct?: number | null
        current_drawdown_from_52w_high_pct?: number | null
        max_drawdown_from_52w_high_pct?: number | null
        avg_days_to_recovery?: number | null
        median_days_to_recovery?: number | null
        episodes?: Episode[]
        underwater_series?: UnderwaterPoint[]
      }
    | undefined
  const backendError = typeof data?.error === 'string' ? data.error : ''

  const series = (metric?.underwater_series || []).map((row) => ({
    date: row.date,
    drawdown: Number(row.drawdown_pct ?? 0),
    drawdown52w: Number(row.drawdown_52w_pct ?? 0),
  }))
  const episodes = metric?.episodes || []
  const hasData = series.length > 30

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view drawdown recovery" icon={<ShieldAlert size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <ShieldAlert size={12} className="text-amber-400" />
          <span>Drawdown & Recovery</span>
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
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} underwater`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message={backendError || 'No drawdown profile available'} icon={<ShieldAlert size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Current DD</div>
              <div className="font-mono text-amber-200">{formatPct(metric?.current_drawdown_pct)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">52W DD</div>
              <div className="font-mono text-red-300">{formatPct(metric?.current_drawdown_from_52w_high_pct)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Avg Recovery</div>
              <div className="font-mono text-cyan-300">
                {metric?.avg_days_to_recovery != null ? `${Number(metric.avg_days_to_recovery).toFixed(1)}d` : '-'}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Median Recovery</div>
              <div className="font-mono text-[var(--text-primary)]">
                {metric?.median_days_to_recovery != null ? `${Number(metric.median_days_to_recovery).toFixed(1)}d` : '-'}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 mb-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Underwater Curve</div>
              <div className="text-[10px] text-[var(--text-secondary)]">Current vs 52W high</div>
            </div>
            <ChartMountGuard className="h-[150px]" minHeight={120}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series.slice(-252)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    domain={[-100, 0]}
                  />
                  <ReferenceLine y={0} stroke="rgba(148,163,184,0.35)" />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value: unknown, name?: string) => [`${Number(value).toFixed(1)}%`, name || '']}
                  />
                  <Area
                    type="monotone"
                    dataKey="drawdown"
                    name="Drawdown"
                    stroke="#ef4444"
                    fill="rgba(239,68,68,0.2)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="drawdown52w"
                    name="52W Drawdown"
                    stroke="#f59e0b"
                    fill="rgba(245,158,11,0.1)"
                    strokeWidth={1.6}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartMountGuard>
          </div>

          <div className="flex-1 overflow-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[var(--text-muted)] border-b border-[var(--border-color)]">
                  <th className="text-left py-1">Peak</th>
                  <th className="text-left py-1">Trough</th>
                  <th className="text-right py-1">Depth</th>
                  <th className="text-right py-1">To Trough</th>
                  <th className="text-right py-1">Recovery</th>
                </tr>
              </thead>
              <tbody>
                {episodes.slice(-12).reverse().map((episode) => (
                  <tr key={`${episode.peak_date}-${episode.trough_date}`} className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                    <td className="py-1">{episode.peak_date}</td>
                    <td className="py-1">{episode.trough_date}</td>
                    <td className="py-1 text-right font-mono text-red-300">{formatPct(episode.depth_pct)}</td>
                    <td className="py-1 text-right font-mono">{episode.days_to_trough}d</td>
                    <td className="py-1 text-right font-mono">
                      {episode.days_to_recovery != null ? `${episode.days_to_recovery}d` : 'recovering'}
                    </td>
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

export default DrawdownRecoveryWidget
