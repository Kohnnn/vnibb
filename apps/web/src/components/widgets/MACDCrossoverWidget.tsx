'use client'

import { useState } from 'react'
import { ActivitySquare } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
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

interface MACDCrossoverWidgetProps {
  symbol: string
}

const PERIOD_OPTIONS = ['6M', '1Y', '3Y', '5Y'] as const

type PeriodOption = (typeof PERIOD_OPTIONS)[number]

type CrossoverRow = {
  date: string
  type: 'bullish' | 'bearish'
  price: number | null
  return_1m_pct: number | null
  return_3m_pct: number | null
}

type MACDSeriesRow = {
  date: string
  macd: number | null
  signal: number | null
  histogram: number | null
}

function stateClass(state: string): string {
  if (state === 'bullish') return 'text-emerald-300'
  if (state === 'bearish') return 'text-red-300'
  return 'text-[var(--text-secondary)]'
}

export function MACDCrossoverWidget({ symbol }: MACDCrossoverWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<PeriodOption>('5Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['macd_crossovers'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.macd_crossovers as
    | {
        current_state?: string
        current_macd?: number | null
        current_signal?: number | null
        current_histogram?: number | null
        avg_return_after_bullish_1m_pct?: number | null
        avg_return_after_bullish_3m_pct?: number | null
        macd_series?: MACDSeriesRow[]
        crossovers?: CrossoverRow[]
      }
    | undefined
  const backendError = typeof data?.error === 'string' ? data.error : ''

  const macdSeries = metric?.macd_series || []
  const crossovers = metric?.crossovers || []
  const macdPanelSeries = macdSeries.slice(-120).map((row) => ({
    date: row.date,
    macd: Number(row.macd ?? 0),
    signal: Number(row.signal ?? 0),
    histogram: Number(row.histogram ?? 0),
  }))
  const crossoverBars = crossovers.slice(-24).map((row) => ({
    date: row.date,
    type: row.type,
    return1m: Number(row.return_1m_pct ?? 0),
    return3m: Number(row.return_3m_pct ?? 0),
  }))
  const maxMacdAbs = Math.max(
    ...macdPanelSeries.map((row) =>
      Math.max(Math.abs(row.macd), Math.abs(row.signal), Math.abs(row.histogram))
    ),
    0.5
  )
  const maxReturnAbs = Math.max(
    ...crossoverBars.map((row) => Math.max(Math.abs(row.return1m), Math.abs(row.return3m))),
    1
  )
  const hasData = macdSeries.length > 0 || crossovers.length > 0

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view MACD crossovers" icon={<ActivitySquare size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <ActivitySquare size={12} className="text-cyan-400" />
          <span>MACD Crossover History</span>
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
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} EMA(12,26,9)`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message={backendError || 'No crossover history'} icon={<ActivitySquare size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">State</div>
              <div className={`font-semibold uppercase ${stateClass(metric?.current_state || 'neutral')}`}>
                {metric?.current_state || 'neutral'}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">MACD</div>
              <div className="text-cyan-300 font-mono">{Number(metric?.current_macd ?? 0).toFixed(4)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Signal</div>
              <div className="text-amber-300 font-mono">{Number(metric?.current_signal ?? 0).toFixed(4)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Histogram</div>
              <div
                className={`font-mono ${Number(metric?.current_histogram ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
              >
                {Number(metric?.current_histogram ?? 0).toFixed(4)}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 mb-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">MACD Panel</div>
              <div className="text-[10px] text-[var(--text-secondary)]">MACD, Signal, Histogram</div>
            </div>
            {macdPanelSeries.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-[var(--text-muted)]">No MACD series available</div>
            ) : (
              <ChartMountGuard className="h-[140px]" minHeight={120}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={macdPanelSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      domain={[-maxMacdAbs, maxMacdAbs]}
                    />
                    <ReferenceLine y={0} stroke="rgba(148,163,184,0.32)" />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      formatter={(value: unknown, name?: string) => [Number(value).toFixed(4), name || '']}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    <Bar dataKey="histogram" name="Histogram" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                    <Line type="monotone" dataKey="macd" name="MACD" stroke="#22d3ee" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="signal" name="Signal" stroke="#f59e0b" dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Bull 1M Avg</div>
              <div className="text-emerald-300 font-mono">
                {Number(metric?.avg_return_after_bullish_1m_pct ?? 0).toFixed(2)}%
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Bull 3M Avg</div>
              <div className="text-cyan-300 font-mono">
                {Number(metric?.avg_return_after_bullish_3m_pct ?? 0).toFixed(2)}%
              </div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 mb-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Post-Crossover Forward Returns</div>
              <div className="text-[10px] text-[var(--text-secondary)]">1M and 3M</div>
            </div>
            {crossoverBars.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-[var(--text-muted)]">No crossover return series</div>
            ) : (
              <ChartMountGuard className="h-[140px]" minHeight={120}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={crossoverBars}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      domain={[-maxReturnAbs, maxReturnAbs]}
                    />
                    <ReferenceLine y={0} stroke="rgba(148,163,184,0.32)" />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      formatter={(value: unknown, name?: string) => [`${Number(value).toFixed(2)}%`, name || '']}
                    />
                    <Bar dataKey="return1m" name="1M Return" fill="#22c55e" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="return3m" name="3M Return" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            )}
          </div>

          <div className="flex-1 overflow-auto pr-1">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-[var(--text-muted)] border-b border-[var(--border-color)]">
                  <th className="text-left py-1">Date</th>
                  <th className="text-left py-1">Type</th>
                  <th className="text-right py-1">1M</th>
                  <th className="text-right py-1">3M</th>
                </tr>
              </thead>
              <tbody>
                {crossovers.slice(-12).reverse().map((row) => (
                  <tr key={`${row.date}-${row.type}-${row.price}`} className="border-b border-[var(--border-color)] text-[var(--text-secondary)]">
                    <td className="py-1">{row.date}</td>
                    <td className={`py-1 uppercase ${row.type === 'bullish' ? 'text-emerald-300' : 'text-red-300'}`}>
                      {row.type}
                    </td>
                    <td className="py-1 text-right font-mono">{Number(row.return_1m_pct ?? 0).toFixed(2)}%</td>
                    <td className="py-1 text-right font-mono">{Number(row.return_3m_pct ?? 0).toFixed(2)}%</td>
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

export default MACDCrossoverWidget
