'use client'

import { useMemo, useState } from 'react'
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
import { Route } from 'lucide-react'
import { useFibonacciRetracement } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

const PERIOD_OPTIONS = [
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
  { label: '3Y', days: 756 },
  { label: '5Y', days: 1260 },
] as const

export function FibonacciWidget({ symbol }: { symbol?: string }) {
  const [lookbackDays, setLookbackDays] = useState<number>(252)
  const upperSymbol = symbol?.toUpperCase() || ''
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useFibonacciRetracement(upperSymbol, {
    lookbackDays,
    direction: 'auto',
    enabled: Boolean(upperSymbol),
  })

  const chartData = useMemo(
    () =>
      (data?.price_data || []).map((point) => ({
        ...point,
        label: point.date,
      })),
    [data?.price_data]
  )
  const hasData = chartData.length > 0 && Boolean(data)
  const isFallback = Boolean(error && hasData)

  const orderedLevels = useMemo(() => {
    return Object.entries(data?.levels || {}).sort((left, right) => right[1] - left[1])
  }, [data?.levels])

  const activePeriod = PERIOD_OPTIONS.find((option) => option.days === lookbackDays)?.label || '1Y'

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view Fibonacci levels" icon={<Route size={18} />} />
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Route size={13} className="text-amber-400" />
          <span>Fibonacci Retracement</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setLookbackDays(option.days)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  lookbackDays === option.days
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={activePeriod}
            align="right"
          />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData || !data ? (
        <WidgetEmpty message="No Fibonacci data available." icon={<Route size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Nearest Level</div>
              <div className="mt-1 text-sm font-semibold text-amber-300">{data.nearest_level.level}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Current Price</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{data.current_price.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Distance</div>
              <div className={`mt-1 text-sm font-semibold ${data.nearest_level.distance_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {data.nearest_level.distance_pct >= 0 ? '+' : ''}
                {data.nearest_level.distance_pct.toFixed(2)}%
              </div>
            </div>
          </div>

          <div className="min-h-[260px] flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} minTickGap={32} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={52} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: '0.75rem',
                    fontSize: '11px',
                  }}
                />
                {orderedLevels.map(([label, level]) => (
                  <ReferenceLine
                    key={label}
                    y={level}
                    stroke={label === data.nearest_level.level ? '#f59e0b' : label === '61.8%' ? '#ef4444' : label === '38.2%' ? '#22c55e' : '#64748b'}
                    strokeDasharray={label === data.nearest_level.level ? '0' : '4 4'}
                    strokeOpacity={label === data.nearest_level.level ? 0.95 : 0.55}
                    label={{ value: label, position: 'insideTopRight', fontSize: 10, fill: '#cbd5e1' }}
                  />
                ))}
                <Line type="monotone" dataKey="close" stroke="#f8fafc" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Swing High</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                {data.swing_high.price.toLocaleString()} <span className="text-[10px] text-[var(--text-muted)]">on {data.swing_high.date}</span>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Swing Low</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                {data.swing_low.price.toLocaleString()} <span className="text-[10px] text-[var(--text-muted)]">on {data.swing_low.date}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default FibonacciWidget
