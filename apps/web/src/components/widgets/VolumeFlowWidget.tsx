'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Waves } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useQuantMetrics } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, type QuantPeriodOption } from '@/lib/quantPeriods'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'
import { QuantWarningBanner } from '@/components/ui/QuantWarningBanner'
import { extractQuantWarning } from '@/lib/quantWidgetHelpers'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import { signedToneClass } from '@/lib/priceColor'
import { useDirectionColors } from '@/hooks/useDirectionColors'
import { describeCumulativeFlowBasis, type VolumeDeltaBasis } from '@/lib/quantRegime'
import { EMPTY_VALUE, toFiniteNumber } from '@/lib/units'
import { buildWidgetRuntime } from '@/lib/widgetRuntime'

interface VolumeFlowWidgetProps {
  symbol: string
  onDataChange?: (data: WidgetDataPayload) => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface CumulativePoint {
  date: string
  delta: number | null
  cumulative_delta: number | null
  close: number | null
}

function observedValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatCompact(value: number | null): string {
  if (value === null) return EMPTY_VALUE
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  return value.toFixed(2)
}

export function VolumeFlowWidget({ symbol, onDataChange }: VolumeFlowWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const dirColors = useDirectionColors()
  const [period, setPeriod] = useState<QuantPeriodOption>('5Y')
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuantMetrics(upperSymbol, {
    period,
    metrics: ['volume_delta'],
    enabled: Boolean(upperSymbol),
  })

  const quality = data?.meta
  // Only a certified unit status admits the derived delta series; an absent or
  // mixed/unconfirmed status must not render ordinary-looking flow values
  // (QA #98).
  const derivedWithheld = Boolean(data) && (!['confirmed_vnd', 'index_points', 'not_applicable'].includes(quality?.unit_status ?? '')
    || Boolean(quality?.unresolved_excluded_dates?.length))
  const metric = derivedWithheld
    ? undefined
    : data?.data?.metrics?.volume_delta as
      | {
          monthly_avg?: Record<string, number | null>
          cumulative?: CumulativePoint[]
          current_20d_cumulative_delta?: number | null
          strongest_buy_month?: string | null
          strongest_sell_month?: string | null
          divergence_months?: number | null
          basis?: VolumeDeltaBasis | null
        }
      | undefined
  const backendError = typeof data?.error === 'string' ? data.error : ''

  const monthlyAvg = metric?.monthly_avg
  const monthRows = useMemo(
    () => MONTHS.map((month) => ({ month, value: observedValue(monthlyAvg?.[month]) })),
    [monthlyAvg],
  )
  const cumulative = metric?.cumulative
  const cumulativeRows = useMemo(() => (cumulative ?? [])
    .filter((row) => Boolean(row?.date))
    .map((row) => ({
      date: row.date,
      delta: observedValue(row.delta),
      cumulative_delta: observedValue(row.cumulative_delta),
      close: observedValue(row.close),
    })), [cumulative])
  const current20 = observedValue(metric?.current_20d_cumulative_delta)
  const divergenceMonths = observedValue(metric?.divergence_months)
  const maxAbs = monthRows.reduce((max, { value }) => value === null ? max : Math.max(max, Math.abs(value)), 1)
  const hasCumulativeDelta = cumulativeRows.some((row) => row.cumulative_delta !== null)
  const hasCumulativeChart = hasCumulativeDelta || cumulativeRows.some((row) => row.close !== null)
  const hasData = Boolean(upperSymbol) && (current20 !== null || divergenceMonths !== null || hasCumulativeDelta
    || monthRows.some((row) => row.value !== null) || cumulativeRows.some((row) => row.delta !== null))
  const basis = metric?.basis ?? null
  const cumulativeNote = hasCumulativeDelta ? describeCumulativeFlowBasis(basis) : 'Cumulative delta unavailable'
  const quantWarning = extractQuantWarning(data, 'volume_delta')
  const { timedOut, resetTimeout } = useLoadingTimeout(isLoading && !hasData, { timeoutMs: 8_000 })

  useEffect(() => {
    const canExport = hasData && !error
    onDataChange?.(buildWidgetRuntime({
      empty: !canExport,
      compactHeight: 4,
      apiGroup: '/quant',
      endpoint: `/quant/${upperSymbol}?period=${period}&metrics=volume_delta`,
      sourceLabel: 'Volume flow',
      period,
      lastDataDate: data?.data?.last_data_date,
      fetchedAt: dataUpdatedAt,
      adjustmentMode: data?.data?.adjustment_mode,
      basis: canExport ? cumulativeNote ?? undefined : undefined,
      exportData: canExport ? [
        { section: 'summary', symbol: upperSymbol, period, current_20d_cumulative_delta: current20, divergence_months: divergenceMonths, basis },
        ...monthRows.map(({ month, value }) => ({ section: 'monthly', month, avg_delta: value })),
        ...cumulativeRows.map((row) => ({ section: 'daily', ...row })),
      ] : undefined,
    }))
  }, [basis, cumulativeNote, cumulativeRows, current20, data?.data?.adjustment_mode, data?.data?.last_data_date,
    dataUpdatedAt, divergenceMonths, error, hasData, monthRows, onDataChange, period, upperSymbol])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view volume flow" icon={<Waves size={18} />} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 py-1 mb-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Waves size={12} className="text-[var(--color-accent-primary)]" />
          <span>Volume Flow (Order Flow Proxy)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta updatedAt={data?.data?.last_data_date} fetchedAt={dataUpdatedAt} isFetching={isFetching && hasData} note={`${period} delta`} align="right" />
        </div>
      </div>

      {timedOut && isLoading && !hasData ? (
        <WidgetError
          title="Loading timed out"
          error={new Error('Volume flow data took too long to load.')}
          onRetry={() => {
            resetTimeout()
            refetch()
          }}
        />
      ) : isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty
          message={derivedWithheld
            ? 'Volume flow unavailable: historical price units were not certified.'
            : backendError || 'Volume flow data is unavailable for the returned sessions.'}
          icon={<Waves size={18} />}
          size="compact"
        />
      ) : (
        <>
          <QuantWarningBanner warning={quantWarning} className="mb-2" />
          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">20D Cumulative</div>
              <div className={`font-mono ${signedToneClass(current20)}`}>
                {formatCompact(current20)}
              </div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Divergence Months</div>
              <div className={`font-mono ${divergenceMonths === null ? 'text-[var(--text-muted)]' : 'text-[var(--color-warning)]'}`}>
                {divergenceMonths ?? EMPTY_VALUE}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Strongest Buy</div>
              <div className="text-[var(--color-positive)] font-semibold">{metric?.strongest_buy_month || '-'}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Strongest Sell</div>
              <div className="text-[var(--color-negative)] font-semibold">{metric?.strongest_sell_month || '-'}</div>
            </div>
          </div>

          <div className="flex-1 overflow-auto space-y-2 pr-1">
            <div className="flex min-h-[150px] flex-col rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Monthly Avg Delta</div>
                <div className="text-[10px] text-[var(--text-secondary)]">
                  {basis?.monthly_avg === 'observed_sample' && 'Observed sample · '}Green buying / Red selling
                </div>
              </div>
              <ChartMountGuard className="flex-1 min-h-[110px]" minHeight={110}>
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart data={monthRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      domain={[-maxAbs, maxAbs]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      formatter={(value) => formatCompact(toFiniteNumber(value))}
                    />
                    <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                      {monthRows.map((entry) => (
                        <Cell key={`month-bar-${entry.month}`} fill={dirColors.forValue(entry.value)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartMountGuard>
            </div>

            <div className="flex min-h-[170px] flex-col rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Cumulative Delta vs Price</div>
                <div className="text-[10px] text-[var(--text-secondary)]">Last {cumulativeRows.length} returned sessions</div>
              </div>
              {cumulativeNote && <div className="mb-1 text-[10px] text-[var(--text-secondary)]">{cumulativeNote}</div>}
              {!hasCumulativeChart ? (
                <div className="py-6 text-center text-[11px] text-[var(--text-muted)]">No chart observations</div>
              ) : (
                <ChartMountGuard className="flex-1 min-h-[120px]" minHeight={120}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <LineChart data={cumulativeRows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="delta" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          fontSize: '11px',
                        }}
                      />
                      <Line
                        yAxisId="delta" type="monotone" dataKey="cumulative_delta" stroke="var(--chart-blue)"
                        strokeWidth={2} connectNulls={false} name="Cumulative Delta"
                        dot={cumulativeRows.length === 1 || cumulativeRows.some((row) => row.cumulative_delta === null) ? { r: 2 } : false}
                      />
                      <Line
                        yAxisId="price" type="monotone" dataKey="close" stroke="var(--chart-slate)"
                        strokeWidth={1.5} strokeDasharray="5 3" connectNulls={false} name="Close"
                        dot={cumulativeRows.length === 1 || cumulativeRows.some((row) => row.close === null) ? { r: 2 } : false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartMountGuard>
              )}
            </div>

            <div className="space-y-1">
              {monthRows.map((row) => {
                const { value } = row
                const width = value === null || value === 0 ? 0 : Math.max(2, (Math.abs(value) / maxAbs) * 100)
                return (
                  <div key={row.month} className="flex items-center gap-2">
                    <div className="w-8 text-[10px] text-[var(--text-muted)]">{row.month}</div>
                    <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                      {width > 0 && (
                        <div className={`h-full ${value !== null && value > 0 ? 'bg-[var(--color-positive)]' : 'bg-[var(--color-negative)]'}`} style={{ width: `${width}%` }} />
                      )}
                    </div>
                    <div className={`w-16 text-[10px] text-right font-mono ${signedToneClass(value)}`}>
                      {formatCompact(value)}
                    </div>
                    <span className="w-2.5 shrink-0" aria-hidden="true">
                      {value !== null && value > 0 && <ArrowUpRight size={10} className="price-up" />}
                      {value !== null && value < 0 && <ArrowDownRight size={10} className="price-down" />}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default VolumeFlowWidget
