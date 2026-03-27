'use client'

import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useHistoricalPrices } from '@/lib/queries'
import type { OHLCData } from '@/lib/chartUtils'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { getQuantPeriodStartDate, QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'

interface DrawdownDeepDiveWidgetProps {
  symbol: string
}

interface DrawdownPoint {
  time: string
  drawdownPct: number
}

interface DrawdownEpisode {
  peakDate: string
  troughDate: string
  recoveryDate?: string
  depthPct: number
  daysToTrough: number
  daysToRecovery?: number
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function shortDate(value: string): string {
  if (!value) return '-'
  return value.slice(0, 10)
}

function computeDrawdown(candles: OHLCData[]): DrawdownPoint[] {
  if (!candles.length) return []

  let runningPeak = Number(candles[0].close)
  const points: DrawdownPoint[] = []

  for (const candle of candles) {
    const close = Number(candle.close)
    if (!Number.isFinite(close) || close <= 0) continue

    runningPeak = Math.max(runningPeak, close)
    const drawdownPct = ((close / runningPeak) - 1) * 100
    points.push({ time: String(candle.time), drawdownPct })
  }

  return points
}

function computeEpisodes(points: DrawdownPoint[]): DrawdownEpisode[] {
  const episodes: DrawdownEpisode[] = []
  let startIndex: number | null = null
  let troughIndex: number | null = null

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]

    if (point.drawdownPct < 0) {
      if (startIndex === null) {
        startIndex = Math.max(0, index - 1)
        troughIndex = index
      } else if (troughIndex === null || point.drawdownPct < points[troughIndex].drawdownPct) {
        troughIndex = index
      }
      continue
    }

    if (startIndex !== null && troughIndex !== null) {
      const peak = points[startIndex]
      const trough = points[troughIndex]
      episodes.push({
        peakDate: peak.time,
        troughDate: trough.time,
        recoveryDate: point.time,
        depthPct: trough.drawdownPct,
        daysToTrough: Math.max(0, troughIndex - startIndex),
        daysToRecovery: Math.max(0, index - troughIndex),
      })
      startIndex = null
      troughIndex = null
    }
  }

  if (startIndex !== null && troughIndex !== null) {
    const peak = points[startIndex]
    const trough = points[troughIndex]
    episodes.push({
      peakDate: peak.time,
      troughDate: trough.time,
      depthPct: trough.drawdownPct,
      daysToTrough: Math.max(0, troughIndex - startIndex),
    })
  }

  return episodes
}

function averageRecoveryDays(episodes: DrawdownEpisode[]): number {
  const recovered = episodes.filter((episode) => Number.isFinite(episode.daysToRecovery))
  if (!recovered.length) return 0
  const total = recovered.reduce((sum, episode) => sum + Number(episode.daysToRecovery || 0), 0)
  return total / recovered.length
}

export function DrawdownDeepDiveWidget({ symbol }: DrawdownDeepDiveWidgetProps) {
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

  const drawdown = computeDrawdown(candles)
  const hasData = drawdown.length > 30
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })
  const episodes = computeEpisodes(drawdown)
  const currentDrawdown = drawdown[drawdown.length - 1]?.drawdownPct ?? 0
  const maxDrawdown = episodes.reduce((min, episode) => Math.min(min, episode.depthPct), 0)
  const avgRecovery = averageRecoveryDays(episodes)
  const activeEpisode = episodes[episodes.length - 1]
  const recent = drawdown.slice(-22)
  const magnitude = Math.abs(Math.min(...recent.map((point) => point.drawdownPct), -1))

  if (!upperSymbol) {
    return (
      <WidgetEmpty
        message="Select a symbol to inspect drawdown episodes"
        icon={<ShieldAlert size={18} />}
      />
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <ShieldAlert size={12} className="text-amber-400" />
          <span>Drawdown Deep Dive</span>
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
          <WidgetMeta updatedAt={dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} underwater`} align="right" />
        </div>
      </div>

      <div className="mb-2 grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="uppercase tracking-widest text-[var(--text-muted)]">Current DD</div>
          <div className="font-mono text-amber-200">{formatPct(currentDrawdown)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="uppercase tracking-widest text-[var(--text-muted)]">Max DD</div>
          <div className="font-mono text-red-300">{formatPct(maxDrawdown)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="uppercase tracking-widest text-[var(--text-muted)]">Avg Recovery</div>
          <div className="font-mono text-cyan-300">{avgRecovery > 0 ? `${Math.round(avgRecovery)}d` : '-'}</div>
        </div>
      </div>

      <div className="mb-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2 text-[10px]">
        <div className="mb-1 text-[var(--text-muted)]">Underwater curve (last 22 sessions)</div>
        <div className="space-y-1">
          {recent.map((point, index) => {
            const widthPct = (Math.abs(point.drawdownPct) / magnitude) * 100
            return (
              <div key={`${point.time}-${index}`} className="flex items-center gap-2">
                <div className="w-14 shrink-0 text-[var(--text-muted)]">{shortDate(point.time).slice(5)}</div>
                <div className="h-3 flex-1 overflow-hidden rounded bg-[var(--bg-tertiary)]">
                  <div className="h-full bg-rose-500/60" style={{ width: `${Math.max(widthPct, 2)}%` }} />
                </div>
                <div className="w-12 text-right font-mono text-[var(--text-primary)]">{point.drawdownPct.toFixed(1)}%</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Drawdown history took too long to load.')}
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
          <WidgetEmpty message="Not enough history to compute drawdown profile" icon={<ShieldAlert size={18} />} />
        ) : (
          episodes.slice(-8).reverse().map((episode, index) => (
            <div key={`${episode.troughDate}-${index}`} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Peak {shortDate(episode.peakDate)}</span>
                <span className="font-mono text-red-300">{formatPct(episode.depthPct)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[var(--text-muted)]">
                <span>Trough {shortDate(episode.troughDate)}</span>
                <span>
                  {episode.daysToTrough}d to trough
                  {episode.daysToRecovery != null ? ` • ${episode.daysToRecovery}d recovery` : ' • recovering'}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {activeEpisode && activeEpisode.daysToRecovery == null && (
        <div className="pt-2 text-right text-[10px] text-amber-300">
          Current episode active since {shortDate(activeEpisode.peakDate)}.
        </div>
      )}
    </div>
  )
}

export default DrawdownDeepDiveWidget
