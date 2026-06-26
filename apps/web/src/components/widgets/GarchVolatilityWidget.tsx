'use client'

import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import type { GarchVolatilityMetric } from '@/lib/api'
import { useGarchVolatility } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { QuantWarningBanner } from '@/components/ui/QuantWarningBanner'
import { extractQuantWarning } from '@/lib/quantWidgetHelpers'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import { buildWidgetRuntime } from '@/lib/widgetRuntime'

interface GarchVolatilityWidgetProps {
  symbol: string
  onDataChange?: (data: WidgetDataPayload) => void
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '-'
}

function formatPct(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '-'
}

function formatSeriesSummary(series: NonNullable<GarchVolatilityMetric['series']>): string {
  if (series.length === 0) return '0 points'
  const latest = series[series.length - 1]
  return latest?.date ? `${series.length} points · latest ${latest.date}` : `${series.length} points`
}

export function GarchVolatilityWidget({ symbol, onDataChange }: GarchVolatilityWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')

  const { data: garchState, isLoading, error, refetch, isFetching, dataUpdatedAt } = useGarchVolatility(upperSymbol, {
    period,
    enabled: Boolean(upperSymbol),
  })

  const response = garchState?.status === 'ok' ? garchState.response : undefined
  const metric = garchState?.status === 'ok' ? garchState.metric : null
  const backendError = garchState?.status === 'ok' && typeof garchState.error === 'string' ? garchState.error : ''
  const unavailableMessage = garchState?.status === 'not_deployed' ? 'GARCH volatility is unavailable until Wave 5.1 deploys.' : ''
  const series = metric?.series ?? []
  const hasData = Boolean(metric)
  const quantWarning = extractQuantWarning(response, 'garch_volatility')
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/quant',
      endpoint: `/quant/${upperSymbol}?period=${period}&metrics=garch_volatility`,
      sourceLabel: 'GARCH volatility',
      lastDataDate: response?.data.last_data_date ?? response?.data.computed_at ?? dataUpdatedAt,
      adjustmentMode: response?.data.adjustment_mode,
      extra: hasData ? {
        points: series.length,
        persistence: metric?.persistence ?? null,
        conditionalVolPct: metric?.current_conditional_vol_pct ?? null,
      } : undefined,
    }))
  }, [dataUpdatedAt, hasData, metric?.current_conditional_vol_pct, metric?.persistence, onDataChange, period, response?.data.adjustment_mode, response?.data.computed_at, response?.data.last_data_date, series.length, upperSymbol])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view GARCH volatility" icon={<Activity size={18} />} />
  }

  const queryError = error instanceof Error ? error : new Error('Unable to load GARCH volatility')

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Activity size={12} className="text-cyan-400" />
          <span>GARCH Volatility</span>
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
          <WidgetMeta updatedAt={response?.data.last_data_date ?? response?.data.computed_at ?? dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} GARCH(1,1)`} align="right" />
        </div>
      </div>

      {timedOut && isLoading && !hasData ? (
        <WidgetError
          title="Loading timed out"
          error={new Error('GARCH volatility data took too long to load.')}
          onRetry={() => {
            resetTimeout()
            refetch()
          }}
        />
      ) : isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={queryError} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message={unavailableMessage || backendError || 'No GARCH volatility data'} icon={<Activity size={18} />} size="compact" />
      ) : (
        <>
          <QuantWarningBanner warning={quantWarning} className="mb-2" />
          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Omega</div>
              <div className="font-mono text-cyan-300">{formatNumber(metric?.omega)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Alpha</div>
              <div className="font-mono text-cyan-300">{formatNumber(metric?.alpha)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Beta</div>
              <div className="font-mono text-amber-300">{formatNumber(metric?.beta)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Persistence</div>
              <div className="font-mono text-amber-300">{formatNumber(metric?.persistence)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Conditional Vol</div>
              <div className="font-mono text-[var(--text-primary)]">{formatPct(metric?.current_conditional_vol_pct)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Long-run Vol</div>
              <div className="font-mono text-[var(--text-primary)]">{formatPct(metric?.long_run_vol_pct)}</div>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-muted)] uppercase tracking-widest">Series</span>
              <span className="font-mono text-[var(--text-secondary)]">{formatSeriesSummary(series)}</span>
            </div>
            {metric?.note ? (
              <div className="mt-2 text-[var(--text-secondary)]">{metric.note}</div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

export default GarchVolatilityWidget
