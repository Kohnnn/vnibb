'use client'

import { ShieldAlert } from 'lucide-react'
import { useHistoricalPrices } from '@/lib/queries'
import type { OHLCData } from '@/lib/chartUtils'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

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

  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(
    upperSymbol,
    {
      startDate: new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      enabled: Boolean(upperSymbol),
    }
  )

  const candles = ((data?.data || []) as OHLCData[])
    .slice()
    .sort((a, b) => new Date(String(a.time)).getTime() - new Date(String(b.time)).getTime())

  const drawdown = computeDrawdown(candles)
  const hasData = drawdown.length > 30
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
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <ShieldAlert size={12} className="text-amber-400" />
          <span>Drawdown Deep Dive</span>
        </div>
        <WidgetMeta updatedAt={dataUpdatedAt} isFetching={isFetching && hasData} note="Underwater" align="right" />
      </div>

      <div className="mb-2 grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="uppercase tracking-widest text-gray-500">Current DD</div>
          <div className="font-mono text-amber-200">{formatPct(currentDrawdown)}</div>
        </div>
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="uppercase tracking-widest text-gray-500">Max DD</div>
          <div className="font-mono text-red-300">{formatPct(maxDrawdown)}</div>
        </div>
        <div className="rounded-md border border-gray-800/60 bg-black/20 px-2 py-1">
          <div className="uppercase tracking-widest text-gray-500">Avg Recovery</div>
          <div className="font-mono text-cyan-300">{avgRecovery > 0 ? `${Math.round(avgRecovery)}d` : '-'}</div>
        </div>
      </div>

      <div className="mb-2 rounded-md border border-gray-800/50 bg-black/10 p-2 text-[10px]">
        <div className="mb-1 text-gray-500">Underwater curve (last 22 sessions)</div>
        <div className="space-y-1">
          {recent.map((point, index) => {
            const widthPct = (Math.abs(point.drawdownPct) / magnitude) * 100
            return (
              <div key={`${point.time}-${index}`} className="flex items-center gap-2">
                <div className="w-14 shrink-0 text-gray-500">{shortDate(point.time).slice(5)}</div>
                <div className="h-3 flex-1 overflow-hidden rounded bg-gray-800/30">
                  <div className="h-full bg-rose-500/60" style={{ width: `${Math.max(widthPct, 2)}%` }} />
                </div>
                <div className="w-12 text-right font-mono text-gray-300">{point.drawdownPct.toFixed(1)}%</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-1 pr-1">
        {isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : !hasData ? (
          <WidgetEmpty message="Not enough history to compute drawdown profile" icon={<ShieldAlert size={18} />} />
        ) : (
          episodes.slice(-8).reverse().map((episode, index) => (
            <div key={`${episode.troughDate}-${index}`} className="rounded border border-gray-800/50 bg-black/10 px-2 py-1.5 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Peak {shortDate(episode.peakDate)}</span>
                <span className="font-mono text-red-300">{formatPct(episode.depthPct)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-gray-500">
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
