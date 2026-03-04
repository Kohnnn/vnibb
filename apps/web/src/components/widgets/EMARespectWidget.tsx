'use client'

import { useState } from 'react'
import { Rows3 } from 'lucide-react'
import { useQuantMetrics } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

interface EMARespectWidgetProps {
  symbol: string
}

const PERIOD_OPTIONS = ['1Y', '3Y', '5Y'] as const

type PeriodOption = (typeof PERIOD_OPTIONS)[number]

type EmaLevel = {
  ema_period: number
  current_ema: number | null
  current_distance_pct: number | null
  interaction_count: number
  support_tests: number
  support_bounce_rate_pct: number | null
  support_breakdown_rate_pct: number | null
  avg_5d_return_after_support_test_pct: number | null
  resistance_tests: number
  resistance_rejection_rate_pct: number | null
  support_strength: string
}

function tone(strength: string): string {
  if (strength === 'strong') return 'text-emerald-300'
  if (strength === 'moderate') return 'text-cyan-300'
  if (strength === 'weak') return 'text-amber-300'
  if (strength === 'fragile') return 'text-red-300'
  return 'text-gray-300'
}

function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '-'
  return `${Number(value).toFixed(1)}%`
}

export function EMARespectWidget({ symbol }: EMARespectWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<PeriodOption>('5Y')

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['ema_respect'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.ema_respect as
    | {
        interaction_tolerance_pct?: number
        lookahead_sessions?: number
        best_support_ema?: string | null
        ema_levels?: EmaLevel[]
      }
    | undefined
  const backendError = typeof data?.error === 'string' ? data.error : ''

  const rows = metric?.ema_levels || []
  const hasData = rows.length > 0

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view EMA respect" icon={<Rows3 size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Rows3 size={12} className="text-cyan-400" />
          <span>EMA Respect Analysis</span>
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
          <WidgetMeta updatedAt={dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} EMA20/50/200`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message={backendError || 'No EMA interaction data'} icon={<Rows3 size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">Best Support</div>
              <div className="font-semibold text-cyan-300">{metric?.best_support_ema || '-'}</div>
            </div>
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">Tolerance</div>
              <div className="font-mono text-gray-200">±{Number(metric?.interaction_tolerance_pct ?? 0).toFixed(1)}%</div>
            </div>
            <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
              <div className="text-gray-500 uppercase tracking-widest">Lookahead</div>
              <div className="font-mono text-gray-200">{metric?.lookahead_sessions ?? 0} sessions</div>
            </div>
          </div>

          <div className="flex-1 overflow-auto rounded-md border border-gray-800/60 bg-black/20 p-2">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800/70">
                  <th className="text-left py-1">EMA</th>
                  <th className="text-right py-1">Dist</th>
                  <th className="text-right py-1">Support</th>
                  <th className="text-right py-1">Break</th>
                  <th className="text-right py-1">Ret(5D)</th>
                  <th className="text-right py-1">Resistance</th>
                  <th className="text-right py-1">Strength</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.ema_period} className="border-b border-gray-900/80 text-gray-300">
                    <td className="py-1 font-semibold text-gray-100">EMA{row.ema_period}</td>
                    <td className="py-1 text-right font-mono">{pct(row.current_distance_pct)}</td>
                    <td className="py-1 text-right font-mono">
                      {pct(row.support_bounce_rate_pct)} ({row.support_tests})
                    </td>
                    <td className="py-1 text-right font-mono">{pct(row.support_breakdown_rate_pct)}</td>
                    <td
                      className={`py-1 text-right font-mono ${Number(row.avg_5d_return_after_support_test_pct ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                    >
                      {pct(row.avg_5d_return_after_support_test_pct)}
                    </td>
                    <td className="py-1 text-right font-mono">
                      {pct(row.resistance_rejection_rate_pct)} ({row.resistance_tests})
                    </td>
                    <td className={`py-1 text-right uppercase font-semibold ${tone(row.support_strength)}`}>
                      {row.support_strength}
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

export default EMARespectWidget
