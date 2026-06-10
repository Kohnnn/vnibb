'use client'

import { useEffect, useMemo, useState } from 'react'
import { TrendingDown } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useHistoricalPrices } from '@/lib/queries'
import { QUANT_PERIOD_OPTIONS, getQuantPeriodStartDate, type QuantPeriodOption } from '@/lib/quantPeriods'
import { computeRollingSharpe, toDatedCloses } from '@/lib/quantLabMath'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'
import { ChartMountGuard } from '@/components/ui/ChartMountGuard'
import { QuantRunHistoryPanel } from '@/components/widgets/QuantRunHistoryPanel'

interface EdgeHalfLifeWidgetProps {
  symbol: string
  onDataChange?: (data: unknown) => void
}

const WINDOW_OPTIONS = [21, 63, 126] as const
type SharpeWindow = (typeof WINDOW_OPTIONS)[number]

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function EdgeHalfLifeWidget({ symbol, onDataChange }: EdgeHalfLifeWidgetProps) {
  const upperSymbol = symbol?.toUpperCase() || ''
  const [period, setPeriod] = useState<QuantPeriodOption>('3Y')
  const [window, setWindow] = useState<SharpeWindow>(63)

  const startDate = useMemo(() => getQuantPeriodStartDate(period), [period])
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useHistoricalPrices(upperSymbol, {
    startDate,
    interval: '1D',
    adjustmentMode: 'adjusted',
    enabled: Boolean(upperSymbol),
  })

  const stats = useMemo(() => {
    const bars = toDatedCloses(data?.data || [])
    return computeRollingSharpe(bars, window)
  }, [data, window])

  const hasData = stats.series.length > 0
  const chartData = useMemo(
    () => stats.series.map((point) => ({ date: point.date.slice(0, 10), sharpe: Number(point.sharpe.toFixed(3)) })),
    [stats.series],
  )

  useEffect(() => {
    onDataChange?.({
      __widgetRuntime: {
        layoutHint: { empty: !hasData, compactHeight: 5 },
        provenance: {
          sourceLabel: 'Edge Half-Life (derived)',
          apiGroup: '/equity',
          endpoint: `/equity/historical?symbol=${upperSymbol}`,
          adjustmentMode: 'adjusted',
          updatedAt: data?.meta?.last_data_date ?? (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined),
        },
      },
      rows: hasData
        ? [{
            symbol: upperSymbol,
            window_days: window,
            current_rolling_sharpe: stats.current,
            peak_rolling_sharpe: stats.peak,
            peak_date: stats.peakDate,
            decay_from_peak_pct: stats.decayFromPeakPct,
            days_since_peak: stats.daysSincePeak,
          }]
        : [],
    })
  }, [hasData, onDataChange, upperSymbol, window, stats, data?.meta?.last_data_date, dataUpdatedAt])

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to inspect edge decay" icon={<TrendingDown size={18} />} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <TrendingDown size={12} className="text-cyan-400" />
          <span>Edge Half-Life</span>
          <span className="text-[10px] text-[var(--text-muted)]">rolling Sharpe, descriptive</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {WINDOW_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setWindow(value)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${window === value ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
              >
                {value}D
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {QUANT_PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${period === option ? 'bg-violet-600/30 text-violet-200' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty
          message="Not enough history for rolling Sharpe"
          icon={<TrendingDown size={18} />}
          detail={`Needs at least ${window + 2} adjusted daily bars in the selected period.`}
        />
      ) : (
        <>
          <div className="mb-2 grid grid-cols-4 gap-2 px-1 text-[10px]">
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Current</div>
              <div className={`font-mono ${Number(stats.current) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmt(stats.current)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Peak</div>
              <div className="font-mono text-cyan-300">{fmt(stats.peak)}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Decay</div>
              <div className="font-mono text-amber-300">{stats.decayFromPeakPct === null ? '—' : `${fmt(stats.decayFromPeakPct, 1)}%`}</div>
            </div>
            <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1">
              <div className="text-[var(--text-muted)] uppercase tracking-widest">Since Peak</div>
              <div className="font-mono text-[var(--text-primary)]">{stats.daysSincePeak === null ? '—' : `${stats.daysSincePeak}d`}</div>
            </div>
          </div>

          <div className="flex min-h-[180px] flex-1 flex-col rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 mx-1">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Rolling {window}D Sharpe</div>
              <div className="text-[10px] text-[var(--text-secondary)]">past window stats, not a forecast</div>
            </div>
            <ChartMountGuard className="flex-1 min-h-[140px]" minHeight={140}>
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} minTickGap={48} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={0} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value) => [Number(value).toFixed(2), 'Sharpe'] as [string, string]}
                  />
                  <Line type="monotone" dataKey="sharpe" stroke="#38bdf8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartMountGuard>
          </div>

          <WidgetMeta
            className="px-1 pt-1"
            updatedAt={data?.meta?.last_data_date ?? dataUpdatedAt}
            isFetching={isFetching && hasData}
            note={`${period} adjusted history`}
            align="right"
          />

          <QuantRunHistoryPanel
            widget="edge_half_life"
            headlineKey="current_rolling_sharpe"
            headlineLabel="Current rolling Sharpe"
            buildRun={() =>
              hasData
                ? {
                    name: `${upperSymbol} ${window}D ${period} · ${new Date().toLocaleDateString()}`,
                    config: { symbol: upperSymbol, period, window },
                    summary: {
                      current_rolling_sharpe: stats.current,
                      peak_rolling_sharpe: stats.peak,
                      decay_from_peak_pct: stats.decayFromPeakPct,
                      days_since_peak: stats.daysSincePeak,
                    },
                  }
                : null
            }
            onApply={(config) => {
              if (typeof config.period === 'string') setPeriod(config.period as QuantPeriodOption)
              if (typeof config.window === 'number' && WINDOW_OPTIONS.includes(config.window as SharpeWindow)) {
                setWindow(config.window as SharpeWindow)
              }
            }}
          />
        </>
      )}
    </div>
  )
}

export default EdgeHalfLifeWidget
