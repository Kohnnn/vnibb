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

interface SeasonalityHeatmapWidgetProps {
  symbol: string
  onDataChange?: (data: unknown) => void
}

const GRANULARITY_OPTIONS: Array<{ value: SeasonalityGranularity; label: string; note: string }> = [
  { value: 'monthly', label: 'Month', note: 'monthly returns' },
  { value: 'weekly', label: 'Week', note: 'weekly returns' },
]

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function getCellClass(value: number | null): string {
  if (value === null) return 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
  if (value >= 8) return 'bg-emerald-500/60 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.22)]'
  if (value >= 4) return 'bg-emerald-500/40 text-emerald-100'
  if (value > 0) return 'bg-emerald-500/20 text-emerald-200'
  if (value <= -8) return 'bg-rose-500/60 text-rose-100 shadow-[0_0_12px_rgba(244,63,94,0.22)]'
  if (value <= -4) return 'bg-rose-500/40 text-rose-100'
  return 'bg-rose-500/20 text-rose-200'
}

function getRowLimit(granularity: SeasonalityGranularity): number {
  if (granularity === 'weekly') return 120
  return 60
}

function formatColumnLabel(column: string, granularity: SeasonalityGranularity): string {
  if (granularity !== 'weekly') return column
  const match = column.match(/^W0?(\d+)$/i)
  return match ? match[1] : column
}

function formatColumnTitle(column: string, granularity: SeasonalityGranularity): string {
  if (granularity !== 'weekly') return column
  return formatColumnLabel(column, granularity)
}

/**
 * Strip the legacy `W` prefix from period labels coming back from the
 * backend matrix endpoint. The backend keeps `W##` as the stable column
 * key for cache + matrix lookups; this helper is used purely for display.
 *
 * Examples: "W42" -> "42", "W42 2025" -> "42 2025", "Mar" -> "Mar".
 */
function stripWeekPrefix(value: string | null | undefined): string {
  if (!value) return '-'
  return value.replace(/\bW0?(\d+)\b/g, '$1')
}

function formatDDMM(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

/**
 * Build a tooltip describing a single cell. For weekly granularity the
 * tooltip shows the full Monday->Sunday date range so users no longer
 * have to mentally translate "W20 2024" into "12/05 - 18/05".
 */
function buildCellTooltip(
  rowKey: string,
  column: string,
  granularity: SeasonalityGranularity,
  startDateMap: Map<string, Date>,
  value: number | null,
): string {
  const pct = formatPct(value)
  if (granularity === 'weekly') {
    const key = `${rowKey}|${column}`
    const startDate = startDateMap.get(key)
    if (startDate && !Number.isNaN(startDate.getTime())) {
      const endDate = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000)
      return `Week ${formatColumnLabel(column, granularity)} ${rowKey} (${formatDDMM(startDate)} - ${formatDDMM(endDate)}): ${pct}`
    }
    return `Week ${formatColumnLabel(column, granularity)} ${rowKey}: ${pct}`
  }
  return `${rowKey} ${formatColumnTitle(column, granularity)}: ${pct}`
}

export function SeasonalityHeatmapWidget({ symbol, onDataChange }: SeasonalityHeatmapWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')
  const [granularity, setGranularity] = useState<SeasonalityGranularity>('monthly')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useSeasonalityMatrix(upperSymbol, {
    period,
    granularity,
    enabled: Boolean(upperSymbol),
  })

  const payload = data?.data
  const rows = payload?.rows || []
  const columns = payload?.columns || []
  const hasData = rows.length > 0 && columns.length > 0
  const isFallback = Boolean(error && hasData)
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  const visibleRows = useMemo(() => {
    const rowKeys = [...new Set(rows.map((row) => row.row_key))].sort((a, b) => b.localeCompare(a))
    return rowKeys.slice(0, getRowLimit(granularity))
  }, [granularity, rows])

  const matrix = useMemo(() => {
    const next = new Map<string, Map<string, number | null>>()
    visibleRows.forEach((rowKey) => next.set(rowKey, new Map()))
    rows.forEach((row) => {
      const rowMap = next.get(row.row_key)
      if (!rowMap) return
      rowMap.set(row.column, row.return_pct ?? null)
    })
    return next
  }, [rows, visibleRows])

  // Lookup map of `${row_key}|${column}` -> Date built from backend
  // start_date so weekly tooltips can show the actual Monday -> Sunday
  // calendar range for the cell rather than just "W20 2024".
  const startDateMap = useMemo(() => {
    const map = new Map<string, Date>()
    rows.forEach((row) => {
      if (!row.start_date) return
      const date = new Date(row.start_date)
      if (Number.isNaN(date.getTime())) return
      map.set(`${row.row_key}|${row.column}`, date)
    })
    return map
  }, [rows])

  const note = GRANULARITY_OPTIONS.find((option) => option.value === granularity)?.note || 'seasonality'
  const compactCells = granularity === 'weekly'

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: {
          empty: !hasData,
          compactHeight: granularity === 'weekly' ? 5 : 4,
        },
      },
    })
  }, [granularity, hasData, onDataChange])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view seasonality heatmap" icon={<CalendarDays size={18} />} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 py-1">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <CalendarDays size={12} className="text-cyan-400" />
          <span>Seasonality Heatmap</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            {GRANULARITY_OPTIONS.map((option) => (
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
            note={`${period} ${note}`}
            align="right"
          />
        </div>
      </div>

      <div className="mb-2 grid grid-cols-4 gap-2 text-[10px]">
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Best Avg</div>
          <div className="mt-1 text-sm font-mono font-semibold text-emerald-300">{stripWeekPrefix(payload?.best_period)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Worst Avg</div>
          <div className="mt-1 text-sm font-mono font-semibold text-rose-300">{stripWeekPrefix(payload?.worst_period)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Hit Rate</div>
          <div className="mt-1 text-sm font-mono font-semibold text-cyan-300">{formatPct(payload?.hit_rate_pct)}</div>
        </div>
        <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Latest</div>
          <div className="mt-1 truncate text-sm font-mono font-semibold text-[var(--text-primary)]">
            {payload?.current_period ? `${stripWeekPrefix(payload.current_period.label)} ${formatPct(payload.current_period.return_pct)}` : '-'}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto pr-1">
        {timedOut && isLoading && !hasData ? (
          <WidgetError
            title="Loading timed out"
            error={new Error('Seasonality data took too long to load.')}
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
          <WidgetEmpty message="Insufficient data for the selected seasonality mode" icon={<CalendarDays size={18} />} />
        ) : (
          <div className={compactCells ? 'min-w-[980px] space-y-1' : 'min-w-[560px] space-y-2'}>
            {payload?.warning ? (
              <div className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-200">
                {payload.warning}
              </div>
            ) : null}
            <div
              className="grid gap-1 text-[10px] text-[var(--text-muted)]"
              style={{ gridTemplateColumns: `${compactCells ? '72px' : '64px'} repeat(${columns.length}, minmax(0, 1fr))` }}
            >
              <div />
              {columns.map((column) => (
                <div key={column} className="text-center uppercase tracking-widest">
                  <span title={formatColumnTitle(column, granularity)}>{formatColumnLabel(column, granularity)}</span>
                </div>
              ))}
            </div>

            {visibleRows.map((rowKey) => (
              <div
                key={rowKey}
                className="grid gap-1 text-[10px]"
                style={{ gridTemplateColumns: `${compactCells ? '72px' : '64px'} repeat(${columns.length}, minmax(0, 1fr))` }}
              >
                <div className="flex items-center truncate font-medium text-[var(--text-secondary)]" title={rowKey}>
                  {rowKey}
                </div>
                {columns.map((column) => {
                  const value = matrix.get(rowKey)?.get(column) ?? null
                  return (
                    <div
                      key={`${rowKey}-${column}`}
                      className={`flex ${compactCells ? 'h-4 min-w-4' : 'h-7'} items-center justify-center rounded border border-[var(--border-subtle)] font-mono ${getCellClass(value)}`}
                      title={buildCellTooltip(rowKey, column, granularity, startDateMap, value)}
                    >
                      {compactCells ? '' : value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}`}
                    </div>
                  )
                })}
              </div>
            ))}

            <div
              className="grid gap-1 text-[10px]"
              style={{ gridTemplateColumns: `${compactCells ? '72px' : '64px'} repeat(${columns.length}, minmax(0, 1fr))` }}
            >
              <div className="flex items-center font-semibold text-cyan-300">Avg</div>
              {columns.map((column) => {
                const value = payload?.averages?.[column] ?? null
                return (
                  <div
                    key={`avg-${column}`}
                    className={`flex ${compactCells ? 'h-4 min-w-4' : 'h-7'} items-center justify-center rounded border border-cyan-500/20 font-mono ${getCellClass(value)}`}
                    title={`Average ${formatColumnTitle(column, granularity)}: ${formatPct(value)}`}
                  >
                    {compactCells ? '' : value === null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}`}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SeasonalityHeatmapWidget
