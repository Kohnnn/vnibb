'use client'

import { useEffect, useMemo } from 'react'
import { ArrowDownToLine, ArrowUpToLine, Scale } from 'lucide-react'
import { useHistoricalPrices, useMicrostructureAnalysis } from '@/lib/queries'
import { sourceObservation } from '@/lib/intradayAvailability'
import { microstructureFailures, microstructureProvenance, microstructureTickFailure } from '@/lib/microstructureAvailability'
import type { EquityHistoricalData } from '@/types/equity'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import { buildWidgetRuntime } from '@/lib/widgetRuntime'
import { signedToneClass } from '@/lib/priceColor'
import { deriveWidgetHealth } from '@/lib/widgetHealth'
import { isObservedVolume } from '@/lib/volumeObservation'

interface VolumeDeltaWidgetProps {
  symbol: string
  onDataChange?: (data: WidgetDataPayload) => void
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

function calculateVolumeDelta(candles: EquityHistoricalData[]): VolumeDeltaPoint[] | null {
  const points: VolumeDeltaPoint[] = []
  let runningDelta = 0

  for (const { time, high, low, close, volume } of candles) {
    if (!isObservedVolume(volume) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      return null
    }

    const range = high - low
    const closePosition = range > 0 ? clamp((close - low) / range, 0, 1) : 0.5
    const buyVolume = volume * closePosition
    const sellVolume = volume * (1 - closePosition)
    const delta = buyVolume - sellVolume
    runningDelta += delta
    points.push({ time, close, delta, cumulativeDelta: runningDelta, closePosition })
  }

  return points
}

function aggregateMicroBars(bars: Array<{ time: string; delta: number; cumulative_delta: number }>): VolumeDeltaPoint[] {
  const days = new Map<string, VolumeDeltaPoint>()
  for (const bar of bars) {
    const time = bar.time.slice(0, 10)
    const existing = days.get(time)
    if (existing) {
      existing.delta += Number(bar.delta) || 0
      existing.cumulativeDelta = Number(bar.cumulative_delta) || 0
    } else {
      days.set(time, {
        time,
        close: 0,
        delta: Number(bar.delta) || 0,
        cumulativeDelta: Number(bar.cumulative_delta) || 0,
        closePosition: 0.5,
      })
    }
  }
  return [...days.values()]
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

function getDivergenceSignal(recent: VolumeDeltaPoint[]) {
  const first = recent[0]
  const last = recent[recent.length - 1]

  const priceChange = percentChange(last.close, first.close)
  const deltaChange = last.cumulativeDelta - first.cumulativeDelta

  if (priceChange > 1 && deltaChange < 0) {
    return {
      label: 'Distribution divergence',
      className: 'text-[var(--color-negative)]',
      priceChange,
      deltaChange,
    }
  }

  if (priceChange < -1 && deltaChange > 0) {
    return {
      label: 'Accumulation divergence',
      className: 'text-[var(--color-positive)]',
      priceChange,
      deltaChange,
    }
  }

  return {
    label: 'Aligned flow',
    className: 'text-[var(--text-muted)]',
    priceChange,
    deltaChange,
  }
}

export function VolumeDeltaWidget({ symbol, onDataChange }: VolumeDeltaWidgetProps) {
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

  const {
    data: microstructure,
    isLoading: isMicroLoading,
    error: microError,
    refetch: refetchMicro,
    isFetching: isMicroFetching,
    dataUpdatedAt: microUpdatedAt,
  } = useMicrostructureAnalysis(upperSymbol, {
    interval: '5m',
    lookbackDays: 7,
    enabled: Boolean(upperSymbol),
  })

  const historyUnitStatus = data?.meta?.unit_status ?? ''
  const historyExpectedUnit = historyUnitStatus === 'confirmed_vnd' ? 'VND' : 'index_points'
  // Only per-row `price_unit` markers certify the OHLC fallback; a response-level
  // `unit_status` cannot certify rows that carry no marker (QA #98).
  const historyWithheld = (data?.data?.length ?? 0) > 0 && !(
    ['confirmed_vnd', 'index_points', 'not_applicable'].includes(historyUnitStatus)
    && (data?.data ?? []).every((row) => row.price_unit === historyExpectedUnit)
  )
  const candles = historyWithheld ? [] : (data?.data ?? [])
  const microBars = microstructure?.data?.deep_trades?.bars || []
  const hasMicroData = microBars.length > 0
  const tickFeed = microstructure?.meta?.feed
  const failures = microstructureFailures(microstructure)
  const tickFailure = microError?.message || microstructureTickFailure(microstructure, failures)
  const historyFailure = error?.message || data?.error || undefined
  // The monthly averages and exported cumulative delta depend on the full returned set.
  const historicalDelta = hasMicroData ? null : calculateVolumeDelta(candles)
  const deltaSeries = hasMicroData ? aggregateMicroBars(microBars) : (historicalDelta ?? [])
  const unavailableReason = hasMicroData ? undefined : historyWithheld
    ? 'Volume delta unavailable: historical price units were not certified.'
    : historicalDelta === null ? 'Volume delta unavailable: incomplete historical observations.' : undefined
  const lastPoint = deltaSeries.at(-1)
  const hasData = !!lastPoint && (hasMicroData || deltaSeries.length > 30)
  const usesTicks = hasMicroData || (!hasData && !historyFailure && Boolean(tickFailure || isMicroLoading))
  const refreshFailure = usesTicks ? tickFailure : historyFailure
  const alternateWarning = usesTicks && historyFailure ? `Historical prices: ${historyFailure}`
    : usesTicks ? undefined : tickFailure
  const unscopedWarning = failures.unscoped !== refreshFailure && failures.unscoped !== alternateWarning
    ? failures.unscoped : undefined
  const lastDataDate = hasData ? usesTicks
    ? sourceObservation(tickFeed?.source_as_of)
    : data?.meta?.freshness_as_of ?? data?.meta?.last_data_date ?? candles.at(-1)?.time ?? null
    : null
  const fetchedAt = usesTicks ? sourceObservation(tickFeed?.fetched_at) ?? microUpdatedAt : dataUpdatedAt
  const seriesFetching = usesTicks ? isMicroFetching : isFetching
  const isRetained = hasData && (usesTicks
    ? Boolean(microError || tickFeed?.fallback) : Boolean(historyFailure))
  const primaryLoading = isMicroLoading || (!hasMicroData && isLoading)
  const observationStatus = hasData ? 'available' : primaryLoading ? 'loading'
    : refreshFailure || unavailableReason ? 'unavailable' : 'empty'
  const refreshStatus = refreshFailure ? 'failed' : seriesFetching ? 'refreshing'
    : (usesTicks ? microstructure : data) ? 'succeeded' : undefined
  const intraday = useMemo(() => usesTicks
    ? microstructureProvenance(microstructure, 'trade_ticks', { hasData, failure: tickFailure, requestError: microError })
    : undefined, [usesTicks, microstructure, hasData, tickFailure, microError])
  const { timedOut, resetTimeout } = useLoadingTimeout(primaryLoading && !hasData, { timeoutMs: 8_000 })

  const rollingPoints = hasMicroData ? deltaSeries : deltaSeries.slice(-LOOKBACK_DAYS)
  const rollingDelta = rollingPoints.reduce((sum, point) => sum + point.delta, 0)
  const divergence = !hasData || !lastPoint ? null : hasMicroData
    ? {
        label: 'Mongo match-type flow',
        className: signedToneClass(lastPoint.cumulativeDelta),
        priceChange: 0,
        deltaChange: lastPoint.cumulativeDelta,
      }
    : getDivergenceSignal(rollingPoints)
  const monthlyAverages = calculateMonthlyAverageDelta(deltaSeries).slice(-6)

  const recentPoints = deltaSeries.slice(-12)
  const maxAbsDelta = recentPoints.reduce((max, point) => Math.max(max, Math.abs(point.delta)), 1)
  const cumulativeDelta = hasData ? lastPoint?.cumulativeDelta : undefined

  useEffect(() => {
    onDataChange?.(
      buildWidgetRuntime({
        empty: !hasData,
        apiGroup: usesTicks ? '/microstructure' : '/equity',
        endpoint: usesTicks
          ? `/microstructure/${upperSymbol}?interval=5m&lookback_days=7`
          : `/equity/historical?symbol=${upperSymbol}`,
        sourceLabel: usesTicks ? 'Volume delta · trade ticks' : 'Volume delta (derived)',
        basis: !usesTicks && hasData ? 'Cumulative delta uses all returned bars; 20D flow uses the latest 20 bars.' : undefined,
        lastDataDate,
        fetchedAt,
        cached: isRetained,
        coverage: 'unknown',
        observationStatus,
        refreshStatus,
        intraday,
        warnings: [refreshFailure, alternateWarning, unscopedWarning].filter((reason): reason is string => Boolean(reason)),
        derived: hasData && !usesTicks,
        extra: cumulativeDelta !== undefined ? { cumulativeDelta } : undefined,
      }),
    )
  }, [onDataChange, hasData, usesTicks, isRetained, lastDataDate, fetchedAt, upperSymbol, cumulativeDelta,
    observationStatus, refreshStatus, intraday, refreshFailure, alternateWarning, unscopedWarning])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view volume delta" icon={<Scale size={18} />} />
  }

  const warning = [hasData && refreshFailure, alternateWarning, unscopedWarning].filter(Boolean).join('; ')

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Scale size={12} className="text-[var(--text-muted)]" />
          <span>{hasMicroData ? 'Volume Delta (Mongo)' : `Volume Delta (${LOOKBACK_DAYS}D)`}</span>
        </div>
        <WidgetMeta
          updatedAt={lastDataDate}
          fetchedAt={fetchedAt}
          isFetching={seriesFetching && hasData}
          isCached={isRetained}
          health={intraday && hasData ? deriveWidgetHealth({
            intraday, observationStatus, refreshStatus, updatedAt: lastDataDate, cached: isRetained, coverage: 'unknown',
          }) : undefined}
          note={hasMicroData ? 'Mongo match-type proxy' : 'OHLC proxy'}
          align="right"
        />
      </div>
      {warning && !primaryLoading && (
        <p role="status" className="mb-1 text-[11px] text-[var(--color-warning)]">{warning}</p>
      )}

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {timedOut && primaryLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Volume delta data took too long to load.')}
            onRetry={() => {
              resetTimeout()
              refetchMicro()
              refetch()
            }}
          />
        ) : primaryLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : refreshFailure && !hasData ? (
          <WidgetError title={unavailableReason ?? 'Volume delta unavailable'} error={new Error(refreshFailure)} onRetry={() => { refetchMicro(); refetch() }} />
        ) : !lastPoint || !divergence ? (
          <WidgetEmpty
            message={unavailableReason ?? 'Not enough historical candles'}
            icon={<Scale size={18} />}
            size="compact"
          />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">Today</div>
                <div className={`font-mono ${signedToneClass(lastPoint.delta)}`}>
                  {lastPoint.delta > 0 ? '+' : ''}
                  {formatCompact(lastPoint.delta)}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">{hasMicroData ? 'Loaded Cum' : '20D Cum'}</div>
                <div className={`font-mono ${signedToneClass(rollingDelta)}`}>
                  {rollingDelta > 0 ? '+' : ''}
                  {formatCompact(rollingDelta)}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[var(--text-muted)] uppercase tracking-widest">{hasMicroData ? 'CVD' : 'Close Pos'}</div>
                <div className="font-mono text-[var(--text-muted)]">
                  {hasMicroData ? formatCompact(lastPoint.cumulativeDelta) : `${(lastPoint.closePosition * 100).toFixed(0)}%`}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 mb-2">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Flow Signal</div>
              <div className={`text-sm font-semibold ${divergence.className}`}>{divergence.label}</div>
              <div className="grid grid-cols-2 gap-2 mt-1 text-[10px]">
                  <div className={hasMicroData ? 'text-[var(--text-muted)]' : signedToneClass(divergence.priceChange)}>
                  {hasMicroData ? 'Mode: tick proxy' : `Price: ${Number(divergence.priceChange) > 0 ? '+' : ''}${divergence.priceChange.toFixed(2)}%`}
                </div>
                <div className={signedToneClass(divergence.deltaChange)}>
                  Delta: {divergence.deltaChange > 0 ? '+' : ''}
                  {formatCompact(divergence.deltaChange)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 mb-2 text-[10px]">
              {monthlyAverages.map((row) => (
                <div key={row.month} className="rounded border border-[var(--border-subtle)] px-2 py-1 bg-[var(--bg-secondary)]">
                  <div className="text-[var(--text-muted)]">M{row.month}</div>
                  <div className={`font-mono ${signedToneClass(row.avgDelta)}`}>
                    {row.avgDelta > 0 ? '+' : ''}
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
                      className={`h-full ${isPositive ? 'bg-[var(--color-positive-muted)]' : 'bg-[var(--color-negative-muted)]'}`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                  <div
                    className={`w-16 text-[10px] text-right font-mono ${
                      isPositive ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]'
                    }`}
                  >
                    {isPositive ? '+' : ''}
                    {formatCompact(point.delta)}
                  </div>
                  {isPositive ? (
                    <ArrowUpToLine size={10} className="text-[var(--color-positive)]" />
                  ) : (
                    <ArrowDownToLine size={10} className="text-[var(--color-negative)]" />
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
