'use client'

import { useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { useSeasonalityMatrix } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import type { SeasonalityGranularity } from '@/lib/api'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'

interface SeasonalitySpiralHeatmapWidgetProps {
  symbol: string
}

type SpiralGranularity = Extract<SeasonalityGranularity, 'daily' | 'weekly'>

const SPIRAL_GRANULARITY_OPTIONS: Array<{
  value: SpiralGranularity
  label: string
  centerLabel: string
  note: string
}> = [
  { value: 'daily', label: 'Daily', centerLabel: 'Daily', note: 'each segment = one trading day' },
  { value: 'weekly', label: 'Weekly', centerLabel: 'Weekly', note: 'each segment = one ISO week' },
]

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

/**
 * Divergent red/green color scale with five buckets per side so adjacent
 * cells visually differ. Missing values use a neutral slate.
 */
function getFill(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'rgba(71,85,105,0.42)'
  if (value >= 8) return 'rgba(16,185,129,0.95)'
  if (value >= 4) return 'rgba(16,185,129,0.78)'
  if (value >= 1) return 'rgba(16,185,129,0.52)'
  if (value > 0) return 'rgba(16,185,129,0.32)'
  if (value <= -8) return 'rgba(244,63,94,0.95)'
  if (value <= -4) return 'rgba(244,63,94,0.78)'
  if (value <= -1) return 'rgba(244,63,94,0.52)'
  return 'rgba(244,63,94,0.32)'
}

function stripWeekPrefix(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\bW0?(\d+)\b/g, '$1')
}

interface SpiralSegment {
  id: string
  label: string
  value: number | null
  pathD: string
  cx: number
  cy: number
}

/**
 * Build segments along an Archimedean spiral
 *
 *   r(theta) = r0 + (turnSpacing / 2*pi) * theta
 *
 * Each segment is a quadrilateral spanning [theta_i, theta_{i+1}] and
 * [r_i - thickness/2, r_i + thickness/2]. Drawn as polygon (M..L..Z)
 * because at small dTheta the curvature is invisible while polygons
 * avoid the SVG arc-rendering quirks that mismatched start/end radii
 * trigger.
 */
function buildSpiralSegments(
  cells: Array<{ id: string; label: string; value: number | null }>,
  options: { center: number; turnSpacing: number; segmentsPerTurn: number; thickness: number; r0: number },
): SpiralSegment[] {
  const { center, turnSpacing, segmentsPerTurn, thickness, r0 } = options
  const a = turnSpacing / (2 * Math.PI)
  const dTheta = (2 * Math.PI) / segmentsPerTurn
  const half = thickness / 2

  return cells.map((cell, index) => {
    const theta0 = index * dTheta
    const theta1 = theta0 + dTheta
    const rMid0 = r0 + a * theta0
    const rMid1 = r0 + a * theta1

    const rOuter0 = rMid0 + half
    const rOuter1 = rMid1 + half
    const rInner0 = rMid0 - half
    const rInner1 = rMid1 - half

    const cos0 = Math.cos(theta0)
    const sin0 = Math.sin(theta0)
    const cos1 = Math.cos(theta1)
    const sin1 = Math.sin(theta1)

    const x1 = center + rOuter0 * cos0
    const y1 = center + rOuter0 * sin0
    const x2 = center + rOuter1 * cos1
    const y2 = center + rOuter1 * sin1
    const x3 = center + rInner1 * cos1
    const y3 = center + rInner1 * sin1
    const x4 = center + rInner0 * cos0
    const y4 = center + rInner0 * sin0

    const pathD = [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
      `L ${x4.toFixed(2)} ${y4.toFixed(2)}`,
      'Z',
    ].join(' ')

    const thetaMid = (theta0 + theta1) / 2
    const rMidAvg = (rMid0 + rMid1) / 2
    return {
      id: cell.id,
      label: cell.label,
      value: cell.value,
      pathD,
      cx: center + rMidAvg * Math.cos(thetaMid),
      cy: center + rMidAvg * Math.sin(thetaMid),
    }
  })
}

export function SeasonalitySpiralHeatmapWidget({ symbol }: SeasonalitySpiralHeatmapWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')
  const [granularity, setGranularity] = useState<SpiralGranularity>('weekly')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSeasonalityMatrix(upperSymbol, {
    period,
    granularity,
    enabled: Boolean(upperSymbol),
  })

  const payload = data?.data
  const rows = payload?.rows || []
  const hasData = rows.length > 0
  const isFallback = Boolean(error && hasData)
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  const granularityConfig = useMemo(
    () => SPIRAL_GRANULARITY_OPTIONS.find((option) => option.value === granularity)!,
    [granularity],
  )

  const cells = useMemo(() => {
    return [...rows]
      .map((row) => {
        const date = new Date(row.start_date || row.label || '')
        const rawLabel = row.label || `${row.row_key} ${row.column}`
        return {
          id: row.start_date || `${row.row_key}-${row.column}-${row.label}`,
          label: granularity === 'weekly' ? stripWeekPrefix(rawLabel) : rawLabel,
          value: row.return_pct ?? null,
          time: Number.isNaN(date.getTime()) ? 0 : date.getTime(),
        }
      })
      .filter((row) => row.time > 0)
      .sort((a, b) => a.time - b.time)
  }, [granularity, rows])

  const geometry = useMemo(() => {
    if (cells.length === 0) {
      return { segments: [] as SpiralSegment[], outerRadius: 18 }
    }

    // Pick segmentsPerTurn so a "natural cycle" wraps once per ring.
    // Weekly: 52 weeks per ISO year. Daily: ~252 trading days per year,
    // but that produces too-tight rings; cap at 60/turn so each ring is
    // a comfortable two-month bucket and the spiral stays legible.
    const isWeekly = granularity === 'weekly'
    const segmentsPerTurn = isWeekly ? 52 : 60
    // Thickness = how thick each ring is, turnSpacing = distance between
    // ring centers. We need turnSpacing > thickness for visible gaps; a
    // 1.4x ratio reads cleanly.
    const thickness = isWeekly ? 12 : 8
    const turnSpacing = thickness * 1.4
    const r0 = 26

    const center = 200
    const segments = buildSpiralSegments(cells, {
      center,
      turnSpacing,
      segmentsPerTurn,
      thickness,
      r0,
    })

    const a = turnSpacing / (2 * Math.PI)
    const lastTheta = cells.length * ((2 * Math.PI) / segmentsPerTurn)
    const outerRadius = r0 + a * lastTheta + thickness / 2

    return { segments, outerRadius }
  }, [cells, granularity])

  // Pad SVG viewBox to fit the outermost ring plus a small margin.
  const viewBoxSize = useMemo(() => {
    const center = 200
    const desired = Math.max(360, (geometry.outerRadius + 12) * 2)
    return { side: desired, center: desired / 2 }
  }, [geometry.outerRadius])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view spiral seasonality" icon={<CalendarDays size={18} />} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 py-1">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <CalendarDays size={12} className="text-cyan-400" />
          <span>Spiral Heatmap</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            {SPIRAL_GRANULARITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setGranularity(option.value)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  granularity === option.value
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  period === option
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={payload?.last_data_date ?? payload?.computed_at ?? dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={`${period} ${granularityConfig.note}`}
            align="right"
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[radial-gradient(circle_at_center,rgba(14,165,233,0.08),transparent_60%)]">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Spiral seasonality took too long to load.')}
            onRetry={() => {
              resetTimeout()
              refetch()
            }}
          />
        ) : isLoading && !hasData ? (
          <WidgetSkeleton lines={8} />
        ) : error && !hasData ? (
          <WidgetError error={error as Error} onRetry={() => refetch()} />
        ) : data?.error && !hasData ? (
          <WidgetEmpty message={data.error} icon={<CalendarDays size={18} />} />
        ) : !hasData ? (
          <WidgetEmpty message="Insufficient data for spiral seasonality" icon={<CalendarDays size={18} />} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-auto">
              <svg
                viewBox={`0 0 ${viewBoxSize.side} ${viewBoxSize.side}`}
                className="mx-auto h-full min-h-[320px] max-h-[680px] w-full max-w-[720px]"
              >
                <g transform={`translate(${viewBoxSize.center - 200} ${viewBoxSize.center - 200})`}>
                  {/* Center disc */}
                  <circle
                    cx="200"
                    cy="200"
                    r="20"
                    fill="rgba(15,23,42,0.78)"
                    stroke="rgba(148,163,184,0.35)"
                    strokeWidth="0.6"
                  />
                  <text
                    x="200"
                    y="198"
                    textAnchor="middle"
                    className="fill-slate-200 text-[8px] font-bold uppercase tracking-[0.18em]"
                  >
                    {granularityConfig.centerLabel}
                  </text>
                  <text x="200" y="208" textAnchor="middle" className="fill-slate-400 text-[6px]">
                    oldest
                  </text>

                  {geometry.segments.map((segment) => (
                    <path
                      key={segment.id}
                      d={segment.pathD}
                      fill={getFill(segment.value)}
                      stroke="rgba(15,23,42,0.45)"
                      strokeWidth="0.35"
                    >
                      <title>{`${segment.label}: ${formatPct(segment.value)}`}</title>
                    </path>
                  ))}

                  {/* Marker on the outermost (newest) cell so users can */}
                  {/* find "today" at a glance. */}
                  {geometry.segments.length > 0 && (
                    <circle
                      cx={geometry.segments[geometry.segments.length - 1].cx}
                      cy={geometry.segments[geometry.segments.length - 1].cy}
                      r="3"
                      fill="rgba(56,189,248,1)"
                      stroke="rgba(15,23,42,0.85)"
                      strokeWidth="0.7"
                    />
                  )}
                </g>
              </svg>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
              <span>
                Each ring covers {granularity === 'weekly' ? 'one ISO year (52 weeks)' : '~60 trading days'}; outer rings
                are newer. Cyan dot marks the latest period.
              </span>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-5 rounded bg-rose-500/70" /> negative
                <span className="h-2.5 w-5 rounded bg-slate-500/60" /> flat/missing
                <span className="h-2.5 w-5 rounded bg-emerald-500/70" /> positive
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SeasonalitySpiralHeatmapWidget
