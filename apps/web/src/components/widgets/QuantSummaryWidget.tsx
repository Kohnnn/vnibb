'use client'

import { useMemo, useState } from 'react'
import { Gauge } from 'lucide-react'
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

import { WidgetContainer } from '@/components/ui/WidgetContainer'
import { WidgetEmpty, WidgetError } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import { useQuantRegime } from '@/hooks/useQuantRegime'
import { useQuantMetrics } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import {
  average,
  scoreDrawdown,
  scoreEmaRespect,
  scoreFlow,
  scoreSeasonality,
  scoreSortino,
} from '@/lib/quantRegime'

interface QuantSummaryWidgetProps {
  id: string
  symbol: string
  onRemove?: () => void
}

type SeasonalityMetric = {
  hit_rate_pct?: number | null
  best_month?: string | null
  worst_month?: string | null
}

type VolumeDeltaMetric = {
  current_20d_cumulative_delta?: number | null
  cumulative?: Array<{ cumulative_delta?: number | null }>
  strongest_buy_month?: string | null
  strongest_sell_month?: string | null
}

type SortinoMetric = {
  monthly_sortino?: Record<string, number | null>
}

type EmaMetric = {
  best_support_ema?: string | null
  ema_levels?: Array<{
    support_bounce_rate_pct?: number | null
    support_strength?: string | null
  }>
}

type DrawdownMetric = {
  max_drawdown_from_52w_high_pct?: number | null
  avg_days_to_recovery?: number | null
}

function formatSigned(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`
}

function flowLabel(score: number): string {
  if (score >= 68) return 'Accumulating'
  if (score <= 32) return 'Distributing'
  return 'Balanced'
}

function flowTone(score: number): string {
  if (score >= 68) return 'text-emerald-300'
  if (score <= 32) return 'text-rose-300'
  return 'text-cyan-300'
}

function averageSortino(metric: SortinoMetric | undefined): number | null {
  return average(
    Object.values(metric?.monthly_sortino || {}).filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ),
  )
}

export function QuantSummaryWidget({ id, symbol, onRemove }: QuantSummaryWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('1Y')

  const quantQuery = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['seasonality', 'volume_delta', 'sortino', 'ema_respect', 'drawdown_recovery'],
    enabled: Boolean(upperSymbol),
  })
  const regime = useQuantRegime(upperSymbol, { period, enabled: Boolean(upperSymbol) })

  const metrics = quantQuery.data?.data?.metrics || {}
  const seasonality = metrics.seasonality as SeasonalityMetric | undefined
  const volumeDelta = metrics.volume_delta as VolumeDeltaMetric | undefined
  const sortino = metrics.sortino as SortinoMetric | undefined
  const emaRespect = metrics.ema_respect as EmaMetric | undefined
  const drawdown = metrics.drawdown_recovery as DrawdownMetric | undefined

  const sortinoAverage = averageSortino(sortino)
  const seasonalityScore = scoreSeasonality(seasonality?.hit_rate_pct ?? null)
  const flowScore = scoreFlow(
    volumeDelta?.current_20d_cumulative_delta ?? null,
    (volumeDelta?.cumulative || []).map((point) => point.cumulative_delta ?? null),
  )
  const emaScore = scoreEmaRespect(emaRespect?.ema_levels || [])
  const drawdownScore = scoreDrawdown(
    drawdown?.max_drawdown_from_52w_high_pct ?? null,
    drawdown?.avg_days_to_recovery ?? null,
  )
  const sortinoScore = scoreSortino(sortinoAverage)

  const radarData = useMemo(
    () => [
      { metric: 'Momentum', value: regime.momentum.score, fullMark: 100 },
      { metric: 'Hurst', value: regime.structure.score, fullMark: 100 },
      { metric: 'Sortino', value: sortinoScore, fullMark: 100 },
      { metric: 'Parkinson', value: regime.volatility.score, fullMark: 100 },
      { metric: 'Flow', value: flowScore, fullMark: 100 },
      { metric: 'Drawdown', value: drawdownScore, fullMark: 100 },
      { metric: 'Seasonality', value: seasonalityScore, fullMark: 100 },
      { metric: 'EMA', value: emaScore, fullMark: 100 },
    ],
    [drawdownScore, emaScore, flowScore, regime.momentum.score, regime.structure.score, regime.volatility.score, seasonalityScore, sortinoScore],
  )

  const compositeRiskScore = Math.round(
    average(radarData.map((item) => item.value).filter((value) => Number.isFinite(value))) || 0,
  )
  const hasData = radarData.some((item) => item.value > 0) || regime.hasData
  const isLoading = (quantQuery.isLoading || regime.isLoading) && !hasData
  const isFetching = quantQuery.isFetching || regime.isFetching
  const error = quantQuery.error || regime.error
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading, { timeoutMs: 10_000 })

  const exportRows = [
    {
      symbol: upperSymbol,
      period,
      regime: regime.regimeLabel,
      action: regime.action,
      momentum_score: regime.momentum.score,
      hurst_score: regime.structure.score,
      volatility_score: regime.volatility.score,
      sortino_score: sortinoScore,
      flow_score: flowScore,
      drawdown_score: drawdownScore,
      seasonality_score: seasonalityScore,
      ema_score: emaScore,
      composite_risk_score: compositeRiskScore,
    },
  ]

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view quant summary" icon={<Gauge size={18} />} />
  }

  return (
    <WidgetContainer
      title="Quant Summary"
      symbol={upperSymbol}
      widgetId={id}
      onClose={onRemove}
      onRefresh={() => {
        resetTimeout()
        void quantQuery.refetch()
        void regime.refetch()
      }}
      exportData={exportRows}
      exportFilename={`quant_summary_${upperSymbol}_${period.toLowerCase()}`}
      noPadding
    >
      <div className="flex h-full flex-col bg-[var(--bg-primary)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  period === option
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={quantQuery.data?.data?.last_data_date || quantQuery.data?.data?.computed_at || regime.updatedAt}
            isFetching={isFetching && hasData}
            note={`${period} composite view · ${(quantQuery.data?.data?.adjustment_mode || 'adjusted')} history`}
            align="right"
          />
        </div>

        {timedOut && isLoading ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Quant summary took too long to load.')}
            onRetry={() => {
              resetTimeout()
              void quantQuery.refetch()
              void regime.refetch()
            }}
          />
        ) : isLoading ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => quantQuery.refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="Quant summary is not available yet" icon={<Gauge size={18} />} />
        ) : (
          <div className="flex h-full flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              <div className="flex min-h-[180px] flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Momentum</div>
                <div className={`mt-1 text-lg font-semibold ${regime.momentum.tone}`}>{regime.momentum.shortLabel}</div>
                <div className="text-[10px] text-[var(--text-secondary)]">{regime.momentum.label}</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Volatility</div>
                <div className={`mt-1 text-lg font-semibold ${regime.volatility.tone}`}>{regime.volatility.shortLabel}</div>
                <div className="text-[10px] text-[var(--text-secondary)]">{regime.volatility.label}</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Flow</div>
                <div className={`mt-1 text-lg font-semibold ${flowTone(flowScore)}`}>{flowLabel(flowScore)}</div>
                <div className="text-[10px] text-[var(--text-secondary)]">20D delta {formatSigned(volumeDelta?.current_20d_cumulative_delta ?? null)}</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Trend</div>
                <div className={`mt-1 text-lg font-semibold ${regime.structure.tone}`}>{regime.structure.shortLabel}</div>
                <div className="text-[10px] text-[var(--text-secondary)]">Hurst {regime.hurst === null ? '—' : regime.hurst.toFixed(3)}</div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Risk Score</div>
                <div className="mt-1 text-lg font-semibold text-cyan-300">{compositeRiskScore}/100</div>
                <div className="text-[10px] text-[var(--text-secondary)]">Composite regime risk</div>
              </div>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Quant Radar</div>
                  <div className="text-[10px] text-[var(--text-secondary)]">8-factor blend</div>
                </div>
                <ChartMountGuard className="flex-1 min-h-[180px]" minHeight={180}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} outerRadius="72%">
                      <PolarGrid stroke="rgba(148,163,184,0.25)" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          fontSize: '11px',
                        }}
                        formatter={(value) => [`${Number(value ?? 0).toFixed(0)}`, 'Score'] as [string, string]}
                      />
                      <Radar
                        name="Quant"
                        dataKey="value"
                        stroke="#38bdf8"
                        fill="rgba(56, 189, 248, 0.22)"
                        fillOpacity={1}
                        strokeWidth={2}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </ChartMountGuard>
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Regime</div>
                  <div className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{regime.regimeLabel}</div>
                  <div className="mt-2 text-sm text-[var(--text-secondary)]">{regime.action}</div>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 text-[11px] text-[var(--text-secondary)]">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Best Month</div>
                      <div className="mt-1 text-emerald-300">{seasonality?.best_month || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Worst Month</div>
                      <div className="mt-1 text-rose-300">{seasonality?.worst_month || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Sortino Avg</div>
                      <div className="mt-1 text-[var(--text-primary)]">{formatSigned(sortinoAverage)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Best EMA</div>
                      <div className="mt-1 text-[var(--text-primary)]">{emaRespect?.best_support_ema || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Drawdown</div>
                      <div className="mt-1 text-[var(--text-primary)]">{formatSigned(drawdown?.max_drawdown_from_52w_high_pct, '%')}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Recovery</div>
                      <div className="mt-1 text-[var(--text-primary)]">{formatSigned(drawdown?.avg_days_to_recovery, 'd')}</div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Summary</div>
                    <div className="mt-1 text-[var(--text-primary)]">
                      Flow is {flowLabel(flowScore).toLowerCase()}, seasonality hit rate is {formatSigned(seasonality?.hit_rate_pct, '%')}, and the current setup leans {regime.momentum.shortLabel.toLowerCase()}.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </WidgetContainer>
  )
}

export default QuantSummaryWidget
