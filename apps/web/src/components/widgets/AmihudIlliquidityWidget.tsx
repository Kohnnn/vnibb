'use client'

import { Droplets, TrendingDown, TrendingUp } from 'lucide-react'
import { useHistoricalPrices } from '@/lib/queries'
import type { OHLCData } from '@/lib/chartUtils'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'

interface AmihudIlliquidityWidgetProps {
  symbol: string
}

interface AmihudPoint {
  time: string
  year: number
  value: number
}

function formatAmihud(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value >= 1) return value.toFixed(2)
  if (value >= 0.01) return value.toFixed(4)
  if (value >= 0.0001) return value.toFixed(6)
  return value.toExponential(2)
}

function formatCompact(value: number): string {
  const absValue = Math.abs(value)
  if (absValue >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (absValue >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (absValue >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(0)
}

function toDateLabel(raw: string): string {
  if (!raw) return '-'
  if (raw.length >= 10) return raw.slice(5, 10)
  return raw
}

function percentChange(current: number, previous: number): number {
  if (!Number.isFinite(previous) || previous === 0) return 0
  return ((current - previous) / Math.abs(previous)) * 100
}

function calculateAmihudSeries(candles: OHLCData[]): AmihudPoint[] {
  const output: AmihudPoint[] = []

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index]
    const previous = candles[index - 1]

    const close = Number(current.close)
    const prevClose = Number(previous.close)
    const volume = Number(current.volume ?? 0)

    if (!Number.isFinite(close) || !Number.isFinite(prevClose) || close <= 0 || prevClose <= 0) {
      continue
    }
    if (!Number.isFinite(volume) || volume <= 0) {
      continue
    }

    const dailyReturn = (close - prevClose) / prevClose
    const scaledTurnover = (volume * close) / 1e9

    if (!Number.isFinite(scaledTurnover) || scaledTurnover <= 0) {
      continue
    }

    const value = Math.abs(dailyReturn) / scaledTurnover
    const parsedDate = new Date(String(current.time))
    if (!Number.isFinite(parsedDate.getTime())) {
      continue
    }

    output.push({
      time: String(current.time),
      year: parsedDate.getUTCFullYear(),
      value,
    })
  }

  return output
}

function rollingMean(data: AmihudPoint[], windowSize: number): AmihudPoint[] {
  if (data.length < windowSize) return []

  const output: AmihudPoint[] = []

  for (let index = windowSize - 1; index < data.length; index += 1) {
    let sum = 0
    for (let offset = 0; offset < windowSize; offset += 1) {
      sum += data[index - offset].value
    }

    const anchor = data[index]
    output.push({
      time: anchor.time,
      year: anchor.year,
      value: sum / windowSize,
    })
  }

  return output
}

function yearlyMeans(data: AmihudPoint[]): { year: number; value: number }[] {
  const grouped = new Map<number, { sum: number; count: number }>()

  for (const point of data) {
    const current = grouped.get(point.year) ?? { sum: 0, count: 0 }
    current.sum += point.value
    current.count += 1
    grouped.set(point.year, current)
  }

  return [...grouped.entries()]
    .map(([year, value]) => ({ year, value: value.count > 0 ? value.sum / value.count : 0 }))
    .sort((a, b) => a.year - b.year)
}

function resolveLiquidityState(trendPct: number) {
  if (trendPct <= -5) return { label: 'Improving', className: 'text-emerald-300' }
  if (trendPct >= 5) return { label: 'Deteriorating', className: 'text-red-300' }
  return { label: 'Stable', className: 'text-cyan-300' }
}

export function AmihudIlliquidityWidget({ symbol }: AmihudIlliquidityWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(
    upperSymbol,
    {
      startDate: new Date(Date.now() - 6 * 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      enabled: Boolean(upperSymbol),
    }
  )

  const candles = (data?.data || []) as OHLCData[]
  const dailyAmihud = calculateAmihudSeries(candles)
  const rolling20 = rollingMean(dailyAmihud, 20)
  const hasData = rolling20.length > 20
  const isFallback = Boolean(error && hasData)
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  const yearly = yearlyMeans(dailyAmihud).slice(-8)
  const current = rolling20[rolling20.length - 1]?.value ?? 0
  const previousMonth = rolling20[Math.max(0, rolling20.length - 21)]?.value ?? current
  const trendPct = percentChange(current, previousMonth)
  const liquidityState = resolveLiquidityState(trendPct)

  const recent = rolling20.slice(-12)
  const maxRecent = recent.reduce((max, row) => Math.max(max, row.value), 1)
  const maxYearly = yearly.reduce((max, row) => Math.max(max, row.value), 1)

  if (!upperSymbol) {
    return (
      <WidgetEmpty message="Select a symbol to view Amihud illiquidity" icon={<Droplets size={18} />} />
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Droplets size={12} className="text-cyan-400" />
          <span>Amihud Illiquidity</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          note="20D mean"
          align="right"
        />
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Amihud illiquidity data took too long to load.')}
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
          <WidgetEmpty message="Not enough history to compute Amihud ratio" icon={<Droplets size={18} />} size="compact" />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">Current</div>
                <div className="font-mono text-cyan-300">{formatAmihud(current)}</div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">20D Trend</div>
                <div className={trendPct <= 0 ? 'text-emerald-300 font-mono' : 'text-red-300 font-mono'}>
                  {trendPct >= 0 ? '+' : ''}
                  {trendPct.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">Liquidity</div>
                <div className={`font-semibold ${liquidityState.className}`}>{liquidityState.label}</div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1 mb-2 text-[10px]">
              {yearly.map((row) => {
                const widthPct = (row.value / maxYearly) * 100
                return (
                  <div key={row.year} className="rounded border border-[var(--border-subtle)] px-2 py-1 bg-[var(--bg-secondary)]">
                    <div className="text-[var(--text-muted)]">{row.year}</div>
                    <div className="text-cyan-300 font-mono">{formatAmihud(row.value)}</div>
                    <div className="mt-1 h-1.5 rounded bg-[var(--bg-tertiary)] overflow-hidden">
                      <div className="h-full bg-cyan-500/70" style={{ width: `${Math.max(6, widthPct)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>

            {recent.map((row, index) => {
              const previous = recent[index - 1]?.value ?? row.value
              const improving = row.value <= previous
              const widthPct = (row.value / maxRecent) * 100

              return (
                <div key={`${row.time}-${index}`} className="flex items-center gap-2">
                  <div className="w-12 text-[10px] text-[var(--text-muted)] shrink-0">{toDateLabel(row.time)}</div>
                  <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                    <div
                      className={`h-full ${improving ? 'bg-emerald-500/65' : 'bg-red-500/65'}`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                  <div className="w-16 text-[10px] text-right text-[var(--text-primary)] font-mono">
                    {formatAmihud(row.value)}
                  </div>
                  {improving ? (
                    <TrendingDown size={10} className="text-emerald-400" />
                  ) : (
                    <TrendingUp size={10} className="text-red-400" />
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="pt-2 text-[10px] text-[var(--text-muted)] text-right">
        Lower values indicate less price impact per {formatCompact(1_000_000)} shares.
      </div>
    </div>
  )
}

export default AmihudIlliquidityWidget
