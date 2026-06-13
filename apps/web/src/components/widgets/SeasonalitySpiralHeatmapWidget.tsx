'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { useSeasonalityMatrix } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import type { SeasonalityGranularity } from '@/lib/api'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import { buildWidgetRuntime } from '@/lib/widgetRuntime'

interface SeasonalitySpiralHeatmapWidgetProps {
  symbol: string
  onDataChange?: (data: unknown) => void
}

type SpiralGranularity = Extract<SeasonalityGranularity, 'daily' | 'weekly'>

const SPIRAL_GRANULARITY_OPTIONS: Array<{
  value: SpiralGranularity
  label: string
  centerLabel: string
  note: string
}> = [
  { value: 'daily', label: 'Daily', centerLabel: 'Daily', note: 'each cell = one trading day' },
  { value: 'weekly', label: 'Weekly', centerLabel: 'Weekly', note: 'each cell = one ISO week' },
]

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

/**
 * Recalibrated divergent red/green color scale. Daily returns are
 * typically <= 2% so the previous 1/4/8 thresholds left almost every
 * daily cell in the lightest opacity bucket and reading nearly grey.
 * The new bucketing emphasizes <= 2% changes which is where the
 * day-to-day signal lives.
 */
function getFill(value: number | null | undefined, granularity: SpiralGranularity): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'rgba(71,85,105,0.42)'

  // Daily uses tighter bands; weekly uses wider bands matching typical
  // weekly return distributions (-6% to +6%).
  const bands = granularity === 'daily'
    ? [0.2, 0.5, 1.0, 2.0]
    : [0.5, 1.5, 3.0, 6.0]

  if (value >= bands[3]) return 'rgba(16,185,129,0.95)'
  if (value >= bands[2]) return 'rgba(16,185,129,0.78)'
  if (value >= bands[1]) return 'rgba(16,185,129,0.56)'
  if (value >= bands[0]) return 'rgba(16,185,129,0.36)'
  if (value > 0) return 'rgba(16,185,129,0.22)'
  if (value <= -bands[3]) return 'rgba(244,63,94,0.95)'
  if (value <= -bands[2]) return 'rgba(244,63,94,0.78)'
  if (value <= -bands[1]) return 'rgba(244,63,94,0.56)'
  if (value <= -bands[0]) return 'rgba(244,63,94,0.36)'
  return 'rgba(244,63,94,0.22)'
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const diff = date.getTime() - start
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

interface SpiralCell {
  id: string
  label: string
  value: number | null
  year: number
  date: Date
}

interface SpiralSegment extends SpiralCell {
  pathD: string
  cx: number
  cy: number
}

/**
 * Build polygon segments for each cell so cells with the same calendar
 * position across years align at the same angle but different rings.
 *
 *   angle  = (dayOfYear / 365 or isoWeek / 53) * 2*pi
 *   radius = r0 + yearIndex * turnSpacing
 *
 * yearIndex is 0 for the oldest year (closest to the center) so the
 * newest year forms the outermost ring.
 */
function buildCalendarSegments(
  cells: SpiralCell[],
  options: {
    center: number
    r0: number
    turnSpacing: number
    thickness: number
    granularity: SpiralGranularity
    yearOrder: number[]
  },
): SpiralSegment[] {
  const { center, r0, turnSpacing, thickness, granularity, yearOrder } = options
  const yearIndex = new Map(yearOrder.map((year, index) => [year, index]))
  const half = thickness / 2

  // Slice width in radians. Daily uses 1/365 of a turn; weekly uses 1/52.
  return cells.map((cell) => {
    let theta0 = 0
    let theta1 = 0
    if (granularity === 'weekly') {
      const isoWeek = getIsoWeek(cell.date)
      const weekFraction = (isoWeek - 1) / 52
      const dTheta = (2 * Math.PI) / 52
      theta0 = weekFraction * 2 * Math.PI - Math.PI / 2
      theta1 = theta0 + dTheta
    } else {
      const doy = dayOfYear(cell.date)
      const yearLen = isLeapYear(cell.date.getUTCFullYear()) ? 366 : 365
      const dTheta = (2 * Math.PI) / yearLen
      theta0 = ((doy - 1) / yearLen) * 2 * Math.PI - Math.PI / 2
      theta1 = theta0 + dTheta
    }

    const idx = yearIndex.get(cell.year) ?? 0
    const rMid = r0 + idx * turnSpacing
    const rOuter = rMid + half
    const rInner = Math.max(2, rMid - half)

    const cos0 = Math.cos(theta0)
    const sin0 = Math.sin(theta0)
    const cos1 = Math.cos(theta1)
    const sin1 = Math.sin(theta1)

    const x1 = center + rOuter * cos0
    const y1 = center + rOuter * sin0
    const x2 = center + rOuter * cos1
    const y2 = center + rOuter * sin1
    const x3 = center + rInner * cos1
    const y3 = center + rInner * sin1
    const x4 = center + rInner * cos0
    const y4 = center + rInner * sin0

    const pathD = [
      `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
      `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
      `L ${x4.toFixed(2)} ${y4.toFixed(2)}`,
      'Z',
    ].join(' ')

    const thetaMid = (theta0 + theta1) / 2
    return {
      ...cell,
      pathD,
      cx: center + rMid * Math.cos(thetaMid),
      cy: center + rMid * Math.sin(thetaMid),
    }
  })
}

function getIsoWeek(date: Date): number {
  // Standard ISO 8601 week-of-year. Algorithm copied from MDN reference.
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const diff = target.getTime() - firstThursday.getTime()
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000))
}

function formatDDMM(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

function formatTooltip(cell: SpiralCell, granularity: SpiralGranularity): string {
  const value = formatPct(cell.value)
  if (granularity === 'weekly') {
    const start = cell.date
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000)
    return `${formatDDMM(start)} - ${formatDDMM(end)} ${cell.year}: ${value}`
  }
  return `${formatDDMM(cell.date)}/${cell.year}: ${value}`
}

export function SeasonalitySpiralHeatmapWidget({ symbol, onDataChange }: SeasonalitySpiralHeatmapWidgetProps) {
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

  useEffect(() => {
    onDataChange?.(buildWidgetRuntime({
      empty: !hasData,
      apiGroup: '/quant',
      endpoint: `/quant/${upperSymbol}/seasonality-matrix?period=${period}&granularity=${granularity}`,
      sourceLabel: 'Seasonality matrix',
      lastDataDate: payload?.last_data_date ?? dataUpdatedAt,
      adjustmentMode: payload?.adjustment_mode,
      extra: {
        rows: rows.length,
        granularity,
      },
    }))
  }, [dataUpdatedAt, granularity, hasData, onDataChange, payload?.adjustment_mode, payload?.last_data_date, period, rows.length, upperSymbol])

  const granularityConfig = useMemo(
    () => SPIRAL_GRANULARITY_OPTIONS.find((option) => option.value === granularity)!,
    [granularity],
  )

  const cells = useMemo<SpiralCell[]>(() => {
    return rows
      .map((row) => {
        const date = new Date(row.start_date || row.label || '')
        if (Number.isNaN(date.getTime())) return null
        return {
          id: row.start_date || `${row.row_key}-${row.column}`,
          label: row.label || `${row.row_key} ${row.column}`,
          value: row.return_pct ?? null,
          year: date.getUTCFullYear(),
          date,
        }
      })
      .filter((c): c is SpiralCell => c !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [rows])

  // Year order: oldest -> newest. Closest-to-center index = 0 for oldest;
  // outermost ring is the newest year, matching "history grows outward".
  const yearOrder = useMemo(() => {
    const years = Array.from(new Set(cells.map((c) => c.year))).sort((a, b) => a - b)
    return years
  }, [cells])

  const geometry = useMemo(() => {
    if (cells.length === 0) {
      return { segments: [] as SpiralSegment[], outerRadius: 24, r0: 30, turnSpacing: 24 }
    }

    const isWeekly = granularity === 'weekly'
    const r0 = 36
    // Per-ring thickness; ring spacing must exceed thickness so years
    // don't visually merge.
    const thickness = isWeekly ? 16 : 12
    const turnSpacing = thickness * 1.25

    const center = 220
    const segments = buildCalendarSegments(cells, {
      center,
      r0,
      turnSpacing,
      thickness,
      granularity,
      yearOrder,
    })

    const outerRadius = r0 + (yearOrder.length - 1) * turnSpacing + thickness / 2

    return { segments, outerRadius, r0, turnSpacing }
  }, [cells, granularity, yearOrder])

  // SVG sizing: scales with outer radius so the full figure fits.
  const viewBoxSize = useMemo(() => {
    const padding = 28
    const side = Math.max(380, (geometry.outerRadius + padding) * 2)
    return { side, center: side / 2 }
  }, [geometry.outerRadius])

  const monthMarkers = useMemo(() => {
    if (geometry.segments.length === 0) return []
    const monthAngles = MONTH_INITIALS.map((label, monthIndex) => {
      // Angle to the START of each month, normalized as a fraction of the year.
      const startDay = monthFirstDayOfYear(monthIndex)
      const fraction = startDay / 365
      const angle = fraction * 2 * Math.PI - Math.PI / 2
      const labelRadius = geometry.outerRadius + 12
      return {
        label,
        x: viewBoxSize.center + labelRadius * Math.cos(angle),
        y: viewBoxSize.center + labelRadius * Math.sin(angle),
      }
    })
    return monthAngles
  }, [geometry.outerRadius, geometry.segments.length, viewBoxSize.center])

  const yearMarkers = useMemo(() => {
    if (yearOrder.length === 0) return []
    return yearOrder.map((year, index) => {
      const r = geometry.r0 + index * geometry.turnSpacing
      // Place at Jan 1 angle (top of the spiral, 12 o'clock).
      const angle = -Math.PI / 2
      return {
        year,
        x: viewBoxSize.center + r * Math.cos(angle),
        y: viewBoxSize.center + r * Math.sin(angle) - geometry.turnSpacing / 2 + 4,
      }
    })
  }, [geometry.r0, geometry.turnSpacing, viewBoxSize.center, yearOrder])

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
                className="mx-auto h-full min-h-[340px] max-h-[720px] w-full max-w-[760px]"
              >
                {/* Center disc with granularity label */}
                <circle
                  cx={viewBoxSize.center}
                  cy={viewBoxSize.center}
                  r="22"
                  fill="rgba(15,23,42,0.78)"
                  stroke="rgba(148,163,184,0.35)"
                  strokeWidth="0.6"
                />
                <text
                  x={viewBoxSize.center}
                  y={viewBoxSize.center - 1}
                  textAnchor="middle"
                  className="fill-slate-200 text-[8px] font-bold uppercase tracking-[0.18em]"
                >
                  {granularityConfig.centerLabel}
                </text>
                <text
                  x={viewBoxSize.center}
                  y={viewBoxSize.center + 9}
                  textAnchor="middle"
                  className="fill-slate-400 text-[6px]"
                >
                  by year
                </text>

                {/* Month compass markers around the outer ring */}
                {monthMarkers.map((marker, idx) => (
                  <text
                    key={`month-${idx}`}
                    x={marker.x}
                    y={marker.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-slate-400 text-[7px] font-semibold"
                  >
                    {marker.label}
                  </text>
                ))}

                {/* Cells */}
                {geometry.segments.map((segment) => (
                  <path
                    key={segment.id}
                    d={segment.pathD}
                    fill={getFill(segment.value, granularity)}
                    stroke="rgba(15,23,42,0.4)"
                    strokeWidth="0.3"
                  >
                    <title>{formatTooltip(segment, granularity)}</title>
                  </path>
                ))}

                {/* Year tags placed at Jan 1 angle on each ring */}
                {yearMarkers.map((marker) => (
                  <g key={`year-${marker.year}`}>
                    <text
                      x={marker.x}
                      y={marker.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-slate-300 text-[7px] font-bold"
                      style={{ paintOrder: 'stroke', stroke: 'rgba(15,23,42,0.85)', strokeWidth: 2 }}
                    >
                      {marker.year}
                    </text>
                  </g>
                ))}

                {/* Marker on the most recent cell */}
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
              </svg>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
              <span>
                Same calendar position across years aligns on the same angle. Outer rings are newer years; inner ring is the oldest. Cyan dot marks the latest period.
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

function monthFirstDayOfYear(monthIndex: number): number {
  // 0-indexed month -> day-of-year for the 1st (non-leap reference).
  const offsets = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
  return offsets[monthIndex] ?? 1
}

export default SeasonalitySpiralHeatmapWidget
