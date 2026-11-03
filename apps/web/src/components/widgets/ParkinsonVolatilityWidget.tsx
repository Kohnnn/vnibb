'use client'

import { useEffect, useState } from 'react'
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
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'
import { QuantWarningBanner } from '@/components/ui/QuantWarningBanner'
import { extractQuantWarning } from '@/lib/quantWidgetHelpers'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import { buildWidgetRuntime } from '@/lib/widgetRuntime'

interface ParkinsonVolatilityWidgetProps {
  symbol: string
  onDataChange?: (data: WidgetDataPayload) => void
}

type Regime = 'low' | 'normal' | 'high' | 'extreme'

type SeriesPoint = {
  date: string
  parkinson_vol_pct: number | null
  close_close_vol_pct: number | null
  z_score: number | null
  regime: Regime | null
}

// Volatility regime is an ordinal level, not a direction: low volatility is not
// a gain and an extreme regime is not a loss. Gain/loss colours stay reserved
// for real signed values, so the level climbs the accent ramp instead.
function regimeTone(regime: string): string {
  if (regime === 'low') return 'text-[var(--text-secondary)]'
  if (regime === 'high') return 'text-[var(--color-accent-primary)]'
  if (regime === 'extreme') return 'text-[var(--color-accent-primary)] font-bold'
  return 'text-[var(--text-primary)]'
}

function regimeBand(regime: string): string {
  // A tint, not a solid fill: the panel carries text, so the fill has to stay
  // subordinate to the ink in both themes.
  if (regime === 'high') return 'border-[var(--color-state-border)] bg-[var(--color-state-bg)]'
  if (regime === 'extreme') return 'border-[var(--color-state-border)] bg-[var(--color-state-bg)]'
  return 'border-[var(--border-color)] bg-[var(--bg-secondary)]'
}

export function ParkinsonVolatilityWidget({ symbol, onDataChange }: ParkinsonVolatilityWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['parkinson_volatility'],
    enabled: Boolean(upperSymbol),
  })

  const quality = data?.meta
  // Only a certified unit status admits the derived volatility series; an
  // absent or mixed/unconfirmed status must not render ordinary-looking values
  // (QA #98).
  const derivedWithheld = Boolean(data) && (!['confirmed_vnd', 'index_points', 'not_applicable'].includes(quality?.unit_status ?? '')
    || Boolean(quality?.unresolved_excluded_dates?.length))
  const metric = derivedWithheld
    ? undefined
    : data?.data?.metrics?.parkinson_volatility as
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
    parkinson: row.parkinson_vol_pct,
    closeVol: row.close_close_vol_pct,
    z: row.z_score,
  }))

  const hasData = rows.length > 30
  const currentRegime = metric?.current_regime || 'normal'
  const quantWarning = extractQuantWarning(data, 'parkinson_volatility')
  // Missing observations stay null in the series; a null must not enter the
  // axis maximum as 0, but it also must not be drawn as a volatility reading.
  const maxVol = Math.max(
    ...rows.flatMap((row) => [row.parkinson, row.closeVol]).filter((v): v is number => v != null),
    20
  )
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/quant',
      endpoint: `/quant/${upperSymbol}?period=${period}&metrics=parkinson_volatility`,
      sourceLabel: 'Parkinson volatility',
      lastDataDate: data?.data?.last_data_date ?? null,
      fetchedAt: dataUpdatedAt,
      adjustmentMode: data?.data?.adjustment_mode,
      extra: {
        points: rows.length,
        currentRegime,
        parkinson30dPct: metric?.current_parkinson_vol_30d_pct ?? null,
      },
    }))
  }, [currentRegime, data?.data?.adjustment_mode, data?.data?.last_data_date, dataUpdatedAt, hasData, metric?.current_parkinson_vol_30d_pct, onDataChange, period, rows.length, upperSymbol])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view Parkinson volatility" icon={<Activity size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Activity size={12} className="text-[var(--color-accent-primary)]" />
          <span>Parkinson Volatility</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
              {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta updatedAt={data?.data?.last_data_date} fetchedAt={dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} 30D · ${(data?.data?.adjustment_mode || 'adjusted')} history`} align="right" />
        </div>
      </div>

      {timedOut && isLoading && !hasData ? (
        <WidgetError
          title="Loading timed out"
          error={new Error('Volatility regime data took too long to load.')}
          onRetry={() => {
            resetTimeout()
            refetch()
          }}
        />
      ) : isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty
          message={derivedWithheld
            ? 'Parkinson volatility unavailable: historical price units were not certified.'
            : backendError || 'No volatility data'}
          icon={<Activity size={18} />}
          size="compact"
        />
      ) : (
        <>
          <QuantWarningBanner warning={quantWarning} className="mb-2" />
          <div className="grid grid-cols-4 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Park 30D</div>
              <div className="font-mono text-[var(--color-accent-primary)]">
                {metric?.current_parkinson_vol_30d_pct == null ? 'n/a' : `${metric.current_parkinson_vol_30d_pct.toFixed(2)}%`}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Close 30D</div>
              <div className="font-mono text-[var(--text-secondary)]">
                {metric?.current_close_close_vol_30d_pct == null ? 'n/a' : `${metric.current_close_close_vol_30d_pct.toFixed(2)}%`}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Ratio</div>
              <div className="font-mono text-[var(--text-primary)]">
                {metric?.close_to_park_ratio == null ? 'n/a' : `${metric.close_to_park_ratio.toFixed(3)}x`}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Regime</div>
              <div className={`font-semibold uppercase ${regimeTone(currentRegime)}`}>{currentRegime}</div>
            </div>
          </div>

          <div className={`mb-2 flex min-h-[220px] flex-col rounded-md border p-2 ${regimeBand(currentRegime)}`}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">30D Volatility Regime</div>
              <div className="text-[10px] text-[var(--text-secondary)]">Z-score {metric?.current_regime_z_score == null ? 'n/a' : metric.current_regime_z_score.toFixed(2)}</div>
            </div>
            <ChartMountGuard className="flex-1 min-h-[160px]" minHeight={160}>
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <ComposedChart data={rows.slice(-252)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, Math.ceil(maxVol + 5)]}
                  />
                  {/* 20/35/50% are regime thresholds, not gain/loss levels: the
                      ramp runs neutral -> accent so severity still reads. */}
                  <ReferenceLine y={20} stroke="color-mix(in srgb, var(--text-muted) 55%, transparent)" strokeDasharray="4 4" />
                  <ReferenceLine y={35} stroke="color-mix(in srgb, var(--color-accent-primary) 45%, transparent)" strokeDasharray="4 4" />
                  <ReferenceLine y={50} stroke="color-mix(in srgb, var(--color-accent-primary) 80%, transparent)" strokeDasharray="4 4" />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value: unknown, name?: string) => [value == null ? 'n/a' : `${Number(value).toFixed(2)}%`, name || '']}
                  />
                  <Area
                    type="monotone"
                    dataKey="parkinson"
                    stroke="var(--chart-blue)"
                    fill="color-mix(in srgb, var(--chart-blue) 18%, transparent)"
                    strokeWidth={2}
                    dot={false}
                    name="Parkinson"
                  />
                  <Line
                    type="monotone"
                    dataKey="closeVol"
                    stroke="var(--chart-slate)"
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
