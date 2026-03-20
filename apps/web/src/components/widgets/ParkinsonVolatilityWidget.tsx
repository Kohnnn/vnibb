'use client'

import { useState } from 'react'
import { Activity } from 'lucide-react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
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

interface ParkinsonVolatilityWidgetProps {
  symbol: string
}

const PERIOD_OPTIONS = ['6M', '1Y', '3Y', '5Y'] as const

type PeriodOption = (typeof PERIOD_OPTIONS)[number]
type Regime = 'low' | 'normal' | 'high' | 'extreme'

type SeriesPoint = {
  date: string
  parkinson_vol_pct: number | null
  close_close_vol_pct: number | null
  z_score: number | null
  regime: Regime | null
}

function regimeTone(regime: string): string {
  if (regime === 'low') return 'text-emerald-300'
  if (regime === 'high') return 'text-amber-300'
  if (regime === 'extreme') return 'text-red-300'
  return 'text-cyan-300'
}

function regimeBand(regime: string): string {
  if (regime === 'low') return 'from-emerald-900/20 to-emerald-700/5'
  if (regime === 'high') return 'from-amber-900/25 to-amber-700/10'
  if (regime === 'extreme') return 'from-red-900/30 to-red-700/12'
  return 'from-slate-900/20 to-slate-700/8'
}

export function ParkinsonVolatilityWidget({ symbol }: ParkinsonVolatilityWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<PeriodOption>('5Y')

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['parkinson_volatility'],
    enabled: Boolean(upperSymbol),
  })

  const metric = data?.data?.metrics?.parkinson_volatility as
    | {
        current_parkinson_vol_30d_pct?: number | null
        current_close_close_vol_30d_pct?: number | null
        close_to_park_ratio?: number | null
        current_regime?: Regime
        current_regime_z_score?: number | null
        series?: SeriesPoint[]
      }
    | undefined
  const backendError = typeof data?.error === 'string' ? data.error : ''

  const rows = (metric?.series || []).map((row) => ({
    date: row.date,
    parkinson: Number(row.parkinson_vol_pct ?? 0),
    closeVol: Number(row.close_close_vol_pct ?? 0),
    z: Number(row.z_score ?? 0),
  }))

  const hasData = rows.length > 30
  const currentRegime = metric?.current_regime || 'normal'
  const maxVol = Math.max(...rows.map((row) => Math.max(row.parkinson, row.closeVol)), 20)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view Parkinson volatility" icon={<Activity size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Activity size={12} className="text-cyan-400" />
          <span>Parkinson Volatility</span>
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
          <WidgetMeta updatedAt={data?.data?.last_data_date ?? data?.data?.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} 30D`} align="right" />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message={backendError || 'No volatility data'} icon={<Activity size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Park 30D</div>
              <div className="font-mono text-cyan-300">
                {Number(metric?.current_parkinson_vol_30d_pct ?? 0).toFixed(2)}%
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Close 30D</div>
              <div className="font-mono text-amber-300">
                {Number(metric?.current_close_close_vol_30d_pct ?? 0).toFixed(2)}%
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Ratio</div>
              <div className="font-mono text-[var(--text-primary)]">
                {Number(metric?.close_to_park_ratio ?? 0).toFixed(3)}x
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Regime</div>
              <div className={`font-semibold uppercase ${regimeTone(currentRegime)}`}>{currentRegime}</div>
            </div>
          </div>

          <div className={`rounded-md border border-[var(--border-color)] bg-gradient-to-br ${regimeBand(currentRegime)} p-2 mb-2`}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">30D Volatility Regime</div>
              <div className="text-[10px] text-[var(--text-secondary)]">Z-score {Number(metric?.current_regime_z_score ?? 0).toFixed(2)}</div>
            </div>
            <ChartMountGuard className="h-[165px]" minHeight={130}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows.slice(-252)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, Math.ceil(maxVol + 5)]}
                  />
                  <ReferenceLine y={20} stroke="rgba(34,197,94,0.25)" strokeDasharray="4 4" />
                  <ReferenceLine y={35} stroke="rgba(245,158,11,0.25)" strokeDasharray="4 4" />
                  <ReferenceLine y={50} stroke="rgba(239,68,68,0.25)" strokeDasharray="4 4" />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value: unknown, name?: string) => [`${Number(value).toFixed(2)}%`, name || '']}
                  />
                  <Area
                    type="monotone"
                    dataKey="parkinson"
                    stroke="#22d3ee"
                    fill="rgba(34,211,238,0.18)"
                    strokeWidth={2}
                    dot={false}
                    name="Parkinson"
                  />
                  <Line
                    type="monotone"
                    dataKey="closeVol"
                    stroke="#f59e0b"
                    strokeWidth={1.8}
                    dot={false}
                    name="Close-Close"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartMountGuard>
          </div>
        </>
      )}
    </div>
  )
}

export default ParkinsonVolatilityWidget
