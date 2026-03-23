'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { CloudSun } from 'lucide-react'
import { useIchimokuSeries } from '@/lib/queries'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetError, WidgetEmpty } from '@/components/ui/widget-states'
import { WidgetMeta } from '@/components/ui/WidgetMeta'

const PERIOD_OPTIONS = ['6M', '1Y', '3Y', '5Y'] as const
type PeriodOption = (typeof PERIOD_OPTIONS)[number]

interface IchimokuWidgetProps {
  symbol?: string
}

function labelTone(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes('bull')) return 'text-emerald-300'
  if (normalized.includes('bear')) return 'text-rose-300'
  if (normalized.includes('strong')) return 'text-sky-300'
  return 'text-[var(--text-secondary)]'
}

export function IchimokuWidget({ symbol }: IchimokuWidgetProps) {
  const [period, setPeriod] = useState<PeriodOption>('1Y')
  const upperSymbol = symbol?.toUpperCase() || ''
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useIchimokuSeries(upperSymbol, {
    period,
    enabled: Boolean(upperSymbol),
  })

  const chartData = useMemo(
    () =>
      (data?.data || []).map((point) => {
        const lowerCandidates = [point.senkou_span_a, point.senkou_span_b].filter(
          (value): value is number => typeof value === 'number'
        )
        const cloudLower = lowerCandidates.length ? Math.min(...lowerCandidates) : null
        const cloudUpper = lowerCandidates.length ? Math.max(...lowerCandidates) : null
        const cloudBand =
          cloudLower !== null && cloudUpper !== null ? Number((cloudUpper - cloudLower).toFixed(2)) : null
        const bullishBand =
          cloudBand !== null && point.senkou_span_a !== null && point.senkou_span_b !== null && point.senkou_span_a >= point.senkou_span_b
            ? cloudBand
            : null
        const bearishBand =
          cloudBand !== null && point.senkou_span_a !== null && point.senkou_span_b !== null && point.senkou_span_a < point.senkou_span_b
            ? cloudBand
            : null

        return {
          ...point,
          label: point.date,
          cloudBase: cloudLower,
          bullishBand,
          bearishBand,
        }
      }),
    [data?.data]
  )

  const latest = chartData[chartData.length - 1]
  const hasData = chartData.length > 0
  const isFallback = Boolean(error && hasData)

  if (!upperSymbol) {
    return <WidgetEmpty message="Select a symbol to view Ichimoku cloud" icon={<CloudSun size={18} />} />
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <CloudSun size={13} className="text-sky-400" />
          <span>Ichimoku Cloud</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] p-0.5">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  period === option
                    ? 'bg-sky-500/20 text-sky-200'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <WidgetMeta
            updatedAt={dataUpdatedAt}
            isFetching={isFetching && hasData}
            isCached={isFallback}
            note={period}
            align="right"
          />
        </div>
      </div>

      {isLoading && !hasData ? (
        <WidgetSkeleton lines={8} />
      ) : error && !hasData ? (
        <WidgetError error={error as Error} onRetry={() => refetch()} />
      ) : !hasData ? (
        <WidgetEmpty message="No Ichimoku data available." icon={<CloudSun size={18} />} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Cloud Trend</div>
              <div className={`mt-1 text-sm font-semibold capitalize ${labelTone(data?.signal.cloud_trend || '')}`}>
                {data?.signal.cloud_trend.replace(/_/g, ' ')}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">TK Cross</div>
              <div className={`mt-1 text-sm font-semibold capitalize ${labelTone(data?.signal.tk_cross || '')}`}>
                {data?.signal.tk_cross.replace(/_/g, ' ')}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Strength</div>
              <div className={`mt-1 text-sm font-semibold capitalize ${labelTone(data?.signal.strength || '')}`}>
                {data?.signal.strength.replace(/_/g, ' ')}
              </div>
            </div>
          </div>

          <div className="min-h-[260px] flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} minTickGap={32} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} width={52} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: '0.75rem',
                    fontSize: '11px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cloudBase"
                  stackId="cloud"
                  stroke="none"
                  fill="transparent"
                  connectNulls
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="bullishBand"
                  stackId="cloud"
                  stroke="none"
                  fill="rgba(16,185,129,0.24)"
                  connectNulls
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="bearishBand"
                  stackId="cloud"
                  stroke="none"
                  fill="rgba(244,63,94,0.22)"
                  connectNulls
                  isAnimationActive={false}
                />
                <Line type="monotone" dataKey="close" stroke="#f8fafc" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="tenkan_sen" stroke="#38bdf8" strokeWidth={1.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="kijun_sen" stroke="#f97316" strokeWidth={1.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Latest Close</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{latest?.close?.toLocaleString() || '--'}</div>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="uppercase tracking-widest text-[var(--text-muted)]">Last Cloud Twist</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{data?.signal.cloud_twist || '--'}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default IchimokuWidget
