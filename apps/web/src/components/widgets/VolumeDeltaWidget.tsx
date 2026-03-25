'use client'

import { ArrowDownToLine, ArrowUpToLine, Scale } from 'lucide-react'
import { useHistoricalPrices } from '@/lib/queries'
import type { OHLCData } from '@/lib/chartUtils'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'

interface VolumeDeltaWidgetProps {
  symbol: string
}

interface VolumeDeltaPoint {
  time: string
  close: number
  delta: number
  cumulativeDelta: number
  closePosition: number
}

interface MonthlyDelta {
  month: number
  avgDelta: number
}

const LOOKBACK_DAYS = 20

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

function calculateVolumeDelta(candles: OHLCData[]): VolumeDeltaPoint[] {
  let runningDelta = 0

  return candles
    .filter((candle) => Number.isFinite(candle.close))
    .map((candle) => {
      const high = Number(candle.high)
      const low = Number(candle.low)
      const close = Number(candle.close)
      const volume = Math.max(0, Number(candle.volume ?? 0))

      const range = high - low
      const closePosition = range > 0 ? clamp((close - low) / range, 0, 1) : 0.5
      const buyVolume = volume * closePosition
      const sellVolume = volume * (1 - closePosition)
      const delta = buyVolume - sellVolume

      runningDelta += delta

      return {
        time: String(candle.time),
        close,
        delta,
        cumulativeDelta: runningDelta,
        closePosition,
      }
    })
}

function calculateMonthlyAverageDelta(points: VolumeDeltaPoint[]): MonthlyDelta[] {
  const monthly = new Map<number, { sum: number; count: number }>()

  for (const point of points) {
    const parsed = new Date(point.time)
    if (!Number.isFinite(parsed.getTime())) continue

    const month = parsed.getUTCMonth() + 1
    const current = monthly.get(month) ?? { sum: 0, count: 0 }
    current.sum += point.delta
    current.count += 1
    monthly.set(month, current)
  }

  return [...monthly.entries()]
    .map(([month, value]) => ({
      month,
      avgDelta: value.count > 0 ? value.sum / value.count : 0,
    }))
    .sort((a, b) => a.month - b.month)
}

function getDivergenceSignal(points: VolumeDeltaPoint[]) {
  if (points.length < LOOKBACK_DAYS) {
    return {
      label: 'No signal',
      className: 'text-[var(--text-secondary)]',
      priceChange: 0,
      deltaChange: 0,
    }
  }

  const recent = points.slice(-LOOKBACK_DAYS)
  const first = recent[0]
  const last = recent[recent.length - 1]

  const priceChange = percentChange(last.close, first.close)
  const deltaChange = last.cumulativeDelta - first.cumulativeDelta

  if (priceChange > 1 && deltaChange < 0) {
    return {
      label: 'Distribution divergence',
      className: 'text-red-300',
      priceChange,
      deltaChange,
    }
  }

  if (priceChange < -1 && deltaChange > 0) {
    return {
      label: 'Accumulation divergence',
      className: 'text-emerald-300',
      priceChange,
      deltaChange,
    }
  }

  return {
    label: 'Aligned flow',
    className: 'text-cyan-300',
    priceChange,
    deltaChange,
  }
}

export function VolumeDeltaWidget({ symbol }: VolumeDeltaWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(
    upperSymbol,
    {
      startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      enabled: Boolean(upperSymbol),
    }
  )

  const candles = (data?.data || []) as OHLCData[]
  const deltaSeries = calculateVolumeDelta(candles)
  const hasData = deltaSeries.length > 30
  const isFallback = Boolean(error && hasData)
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  const lastPoint = deltaSeries[deltaSeries.length - 1]
  const rollingDelta = deltaSeries
    .slice(-LOOKBACK_DAYS)
    .reduce((sum, point) => sum + point.delta, 0)
  const divergence = getDivergenceSignal(deltaSeries)
  const monthlyAverages = calculateMonthlyAverageDelta(deltaSeries).slice(-6)

  const recentPoints = deltaSeries.slice(-12)
  const maxAbsDelta = recentPoints.reduce((max, point) => Math.max(max, Math.abs(point.delta)), 1)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view volume delta" icon={<Scale size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Scale size={12} className="text-cyan-400" />
          <span>Volume Delta ({LOOKBACK_DAYS}D)</span>
        </div>
        <WidgetMeta
          updatedAt={dataUpdatedAt}
          isFetching={isFetching && hasData}
          isCached={isFallback}
          note="Order-flow proxy"
          align="right"
        />
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Volume delta data took too long to load.')}
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
          <WidgetEmpty message="Not enough historical candles" icon={<Scale size={18} />} size="compact" />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">Today</div>
                <div className={`font-mono ${lastPoint?.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {lastPoint?.delta >= 0 ? '+' : ''}
                  {formatCompact(lastPoint?.delta ?? 0)}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">20D Cum</div>
                <div className={`font-mono ${rollingDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {rollingDelta >= 0 ? '+' : ''}
                  {formatCompact(rollingDelta)}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">Close Pos</div>
                <div className="font-mono text-cyan-300">{((lastPoint?.closePosition ?? 0) * 100).toFixed(0)}%</div>
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Flow Signal</div>
              <div className={`text-sm font-semibold ${divergence.className}`}>{divergence.label}</div>
              <div className="grid grid-cols-2 gap-2 mt-1 text-[10px]">
                <div className={divergence.priceChange >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                  Price: {divergence.priceChange >= 0 ? '+' : ''}
                  {divergence.priceChange.toFixed(2)}%
                </div>
                <div className={divergence.deltaChange >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                  Delta: {divergence.deltaChange >= 0 ? '+' : ''}
                  {formatCompact(divergence.deltaChange)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 mb-2 text-[10px]">
              {monthlyAverages.map((row) => (
                <div key={row.month} className="rounded border border-[var(--border-subtle)] px-2 py-1 bg-[var(--bg-secondary)]">
                  <div className="text-[var(--text-muted)]">M{row.month}</div>
                  <div className={row.avgDelta >= 0 ? 'text-emerald-300 font-mono' : 'text-red-300 font-mono'}>
                    {row.avgDelta >= 0 ? '+' : ''}
                    {formatCompact(row.avgDelta)}
                  </div>
                </div>
              ))}
            </div>

            {recentPoints.map((point, index) => {
              const isPositive = point.delta >= 0
              const widthPct = (Math.abs(point.delta) / maxAbsDelta) * 100

              return (
                <div key={`${point.time}-${index}`} className="flex items-center gap-2">
                  <div className="w-12 text-[10px] text-[var(--text-muted)] shrink-0">{toDateLabel(point.time)}</div>
                  <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                    <div
                      className={`h-full ${isPositive ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                  <div
                    className={`w-16 text-[10px] text-right font-mono ${
                      isPositive ? 'text-emerald-300' : 'text-red-300'
                    }`}
                  >
                    {isPositive ? '+' : ''}
                    {formatCompact(point.delta)}
                  </div>
                  {isPositive ? (
                    <ArrowUpToLine size={10} className="text-emerald-400" />
                  ) : (
                    <ArrowDownToLine size={10} className="text-red-400" />
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

export default VolumeDeltaWidget
