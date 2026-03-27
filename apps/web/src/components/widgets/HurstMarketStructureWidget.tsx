'use client'

import { useMemo, useState } from 'react'
import { Sigma } from 'lucide-react'
import { useHistoricalPrices } from '@/lib/queries'
import type { OHLCData } from '@/lib/chartUtils'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import { getQuantPeriodStartDate, QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'

interface HurstMarketStructureWidgetProps {
  symbol: string
}

function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '-'
  return value.toFixed(digits)
}

function std(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(Math.max(variance, 0))
}

function computeHurstFromPrices(prices: number[]): number | null {
  if (prices.length < 120) return null

  const logPrices = prices.map((price) => Math.log(price)).filter((value) => Number.isFinite(value))
  if (logPrices.length < 120) return null

  const lags = Array.from({ length: 29 }, (_, idx) => idx + 2)
  const validPairs: Array<{ lag: number; tau: number }> = []

  for (const lag of lags) {
    const diffs: number[] = []
    for (let index = lag; index < logPrices.length; index += 1) {
      diffs.push(logPrices[index] - logPrices[index - lag])
    }
    const tau = std(diffs)
    if (Number.isFinite(tau) && tau > 0) {
      validPairs.push({ lag, tau })
    }
  }

  if (validPairs.length < 6) return null

  const x = validPairs.map((pair) => Math.log(pair.lag))
  const y = validPairs.map((pair) => Math.log(pair.tau))
  const xMean = x.reduce((sum, value) => sum + value, 0) / x.length
  const yMean = y.reduce((sum, value) => sum + value, 0) / y.length

  let numerator = 0
  let denominator = 0
  for (let index = 0; index < x.length; index += 1) {
    numerator += (x[index] - xMean) * (y[index] - yMean)
    denominator += (x[index] - xMean) ** 2
  }

  if (!Number.isFinite(denominator) || denominator === 0) return null
  const slope = numerator / denominator
  const hurst = slope * 2
  if (!Number.isFinite(hurst)) return null

  return Math.max(0, Math.min(1, hurst))
}

function computeLag1Autocorrelation(returns: number[]): number | null {
  if (returns.length < 30) return null
  const x = returns.slice(1)
  const y = returns.slice(0, -1)
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length

  let covariance = 0
  let varianceX = 0
  let varianceY = 0

  for (let index = 0; index < x.length; index += 1) {
    const dx = x[index] - meanX
    const dy = y[index] - meanY
    covariance += dx * dy
    varianceX += dx ** 2
    varianceY += dy ** 2
  }

  const denominator = Math.sqrt(varianceX * varianceY)
  if (!Number.isFinite(denominator) || denominator === 0) return null
  return covariance / denominator
}

function classifyHurst(hurst: number | null): { label: string; className: string; note: string } {
  if (hurst == null) {
    return { label: 'Insufficient Data', className: 'text-[var(--text-secondary)]', note: 'Need longer series' }
  }
  if (hurst > 0.55) {
    return { label: 'Trending', className: 'text-emerald-300', note: 'Momentum persistence likely' }
  }
  if (hurst < 0.45) {
    return { label: 'Mean-Reverting', className: 'text-amber-300', note: 'Fade extreme moves' }
  }
  return { label: 'Random Walk', className: 'text-cyan-300', note: 'Range/event edge preferred' }
}

export function HurstMarketStructureWidget({ symbol }: HurstMarketStructureWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('3Y')

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(
    upperSymbol,
    {
      startDate: getQuantPeriodStartDate(period),
      enabled: Boolean(upperSymbol),
    }
  )

  const candles = ((data?.data || []) as OHLCData[])
    .slice()
    .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())

  const closes = candles
    .map((candle) => Number(candle.close))
    .filter((close) => Number.isFinite(close) && close > 0)

  const returns = closes.slice(1).map((close, index) => (close / closes[index]) - 1)
  const hurst = computeHurstFromPrices(closes)
  const lag1 = computeLag1Autocorrelation(returns)
  const structure = classifyHurst(hurst)
  const hasData = closes.length > 120
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  const rollingWindows = useMemo(() => {
    const output: Array<{ label: string; value: number | null }> = []
    const windowSize = 252
    const step = 126

    for (let end = closes.length; end > 0 && output.length < 6; end -= step) {
      const start = Math.max(0, end - windowSize)
      const slice = closes.slice(start, end)
      if (slice.length < 120) continue

      const hurstValue = computeHurstFromPrices(slice)
      const anchor = candles[end - 1]
      const label = anchor?.time?.toString().slice(0, 7) || `W${output.length + 1}`
      output.push({ label, value: hurstValue })
    }

    return output.reverse()
  }, [candles, closes])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to inspect market structure" icon={<Sigma size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Sigma size={12} className="text-cyan-300" />
          <span>Hurst & Market Structure</span>
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
          <WidgetMeta updatedAt={dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} • R/S method`} align="right" />
        </div>
      </div>

      <div className="flex-1 overflow-auto pr-1">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Market structure data took too long to load.')}
            onRetry={() => {
              resetTimeout()
              refetch()
            }}
          />
        ) : isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="Not enough historical data for Hurst estimation" icon={<Sigma size={18} />} size="compact" />
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="uppercase tracking-widest text-[var(--text-muted)]">Hurst</div>
                <div className="font-mono text-cyan-300">{formatNumber(hurst ?? Number.NaN)}</div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="uppercase tracking-widest text-[var(--text-muted)]">Lag-1 AC</div>
                <div className="font-mono text-emerald-300">{formatNumber((lag1 ?? 0) * 100, 2)}%</div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="uppercase tracking-widest text-[var(--text-muted)]">Structure</div>
                <div className={structure.className}>{structure.label}</div>
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
              <span className="text-[var(--text-muted)]">Interpretation:</span> <span className={structure.className}>{structure.note}</span>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Rolling Regime</div>
              <div className="space-y-1">
                {rollingWindows.map((window, index) => {
                  const value = window.value ?? 0.5
                  const widthPct = Math.max(4, Math.min(100, value * 100))
                  const className =
                    value > 0.55
                      ? 'bg-emerald-500/65'
                      : value < 0.45
                        ? 'bg-amber-500/65'
                        : 'bg-cyan-500/65'

                  return (
                    <div key={`${window.label}-${index}`} className="flex items-center gap-2">
                      <div className="w-14 shrink-0 text-[var(--text-muted)]">{window.label}</div>
                      <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--bg-tertiary)]">
                        <div className={className} style={{ width: `${widthPct}%`, height: '100%' }} />
                      </div>
                      <div className="w-12 text-right font-mono text-[var(--text-primary)]">{formatNumber(value, 3)}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2 text-[10px] text-[var(--text-muted)]">
              H &gt; 0.55: persistent trend. H &lt; 0.45: mean reversion. Near 0.50: random walk.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default HurstMarketStructureWidget
