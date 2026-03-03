'use client'

import { useState } from 'react'
import { ActivitySquare } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useQuantMetrics } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'

interface MACDCrossoverWidgetProps {
  symbol: string
}

const PERIOD_OPTIONS = ['1Y', '3Y', '5Y'] as const

type PeriodOption = (typeof PERIOD_OPTIONS)[number]

type CrossoverRow = {
  date: string
  type: 'bullish' | 'bearish'
  price: number | null
  return_1m_pct: number | null
  return_3m_pct: number | null
}

function stateClass(state: string): string {
  if (state === 'bullish') return 'text-emerald-300'
  if (state === 'bearish') return 'text-red-300'
  return 'text-gray-300'
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
        avg_return_after_bullish_1m_pct?: number | null
        avg_return_after_bullish_3m_pct?: number | null
        crossovers?: CrossoverRow[]
      }
    | undefined

  const crossovers = metric?.crossovers || []
  const crossoverBars = crossovers.slice(-24).map((row) => ({
    date: row.date,
    type: row.type,
    return1m: Number(row.return_1m_pct ?? 0),
    return3m: Number(row.return_3m_pct ?? 0),
  }))
  const maxAbs = Math.max(
    ...crossoverBars.map((row) => Math.max(Math.abs(row.return1m), Math.abs(row.return3m))),
    1
  )
  const hasData = crossovers.length > 0

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view MACD crossovers" icon={<ActivitySquare size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-400">
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
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/70'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta updatedAt={dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} EMA(12,26,9)`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No crossover history" icon={<ActivitySquare size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">State</div>
              <div className={`font-semibold uppercase ${stateClass(metric?.current_state || 'neutral')}`}>{metric?.current_state || 'neutral'}</div>
            </div>
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">Bull 1M Avg</div>
              <div className="text-emerald-300 font-mono">{Number(metric?.avg_return_after_bullish_1m_pct ?? 0).toFixed(2)}%</div>
            </div>
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">Bull 3M Avg</div>
              <div className="text-cyan-300 font-mono">{Number(metric?.avg_return_after_bullish_3m_pct ?? 0).toFixed(2)}%</div>
            </div>
          </div>

          <div className="rounded-md border border-gray-800/60 bg-black/20 p-2 mb-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Post-Crossover Forward Returns</div>
              <div className="text-[10px] text-gray-400">1M and 3M</div>
            </div>
            {crossoverBars.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-gray-500">No crossover return series</div>
            ) : (
              <ChartMountGuard className="h-[140px]" minHeight={120}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={crossoverBars}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
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
                      formatter={(value: unknown, name?: string) => [`${Number(value).toFixed(2)}%`, name || '']}
                    />
                    <Bar dataKey="return1m" name="1M Return" fill="#22c55e" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="return3m" name="3M Return" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            )}
          </div>

          <div className="flex-1 overflow-auto pr-1">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800/70">
                  <th className="text-left py-1">Date</th>
                  <th className="text-left py-1">Type</th>
                  <th className="text-right py-1">1M</th>
                  <th className="text-right py-1">3M</th>
                </tr>
              </thead>
              <tbody>
                {crossovers.slice(-12).reverse().map((row) => (
                  <tr key={`${row.date}-${row.type}-${row.price}`} className="border-b border-gray-900/80 text-gray-300">
                    <td className="py-1">{row.date}</td>
                    <td className={`py-1 uppercase ${row.type === 'bullish' ? 'text-emerald-300' : 'text-red-300'}`}>{row.type}</td>
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
