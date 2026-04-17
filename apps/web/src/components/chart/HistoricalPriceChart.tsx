'use client'

import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { useCompanyEvents, useHistoricalPrices } from '@/lib/queries'
import { ChartSizeBox } from '@/components/ui/ChartSizeBox'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetEmpty } from '@/components/ui/widget-states'
import { buildChartEventMarkers } from '@/lib/chartEventMarkers'
import { cn } from '@/lib/utils'

const TIMEFRAME_DAYS: Record<string, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '2Y': 365 * 2
}

function formatShortDate(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}/${String(date.getFullYear()).slice(-2)}`
}

interface HistoricalPriceChartProps {
  symbol: string
  timeframe?: keyof typeof TIMEFRAME_DAYS
}

export function HistoricalPriceChart({ symbol, timeframe = '1Y' }: HistoricalPriceChartProps) {
  const [adjustmentMode, setAdjustmentMode] = useState<'raw' | 'adjusted'>('adjusted')
  const dateRange = useMemo(() => {
    const days = TIMEFRAME_DAYS[timeframe] ?? TIMEFRAME_DAYS['1Y']
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - days)
    const toDate = (value: Date) => value.toISOString().split('T')[0]
    return { startDate: toDate(start), endDate: toDate(end) }
  }, [timeframe])

  const historyQuery = useHistoricalPrices(symbol, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    interval: '1D',
    adjustmentMode,
    enabled: Boolean(symbol)
  })

  const rows = historyQuery.data?.data || []
  const hasData = rows.length > 0
  const companyEventsQuery = useCompanyEvents(symbol, { enabled: Boolean(symbol), limit: 80 })

  const chartData = useMemo(
    () =>
      rows.map((point) => ({
        date: point.time,
        close: point.close
      })),
    [rows]
  )
  const eventMarkers = useMemo(
    () => buildChartEventMarkers(companyEventsQuery.data?.data || [], rows, timeframe === '5Y' ? 12 : 8),
    [companyEventsQuery.data?.data, rows, timeframe]
  )

  if (historyQuery.isLoading && !hasData) {
    return <WidgetSkeleton variant="chart" />
  }

  if (historyQuery.error && !hasData) {
    return <WidgetEmpty message="Historical price data unavailable." />
  }

  if (!hasData) {
    return <WidgetEmpty message="No historical price data available." />
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-end gap-1">
        {(['adjusted', 'raw'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setAdjustmentMode(mode)}
            className={cn(
              'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors',
              adjustmentMode === mode
                ? 'bg-blue-600 text-white'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            )}
          >
            {mode}
          </button>
        ))}
      </div>

      {eventMarkers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
          <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1">D Dividend</span>
          <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1">S Split</span>
          <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1">R Rights</span>
        </div>
      ) : null}

      <ChartSizeBox className="h-full" minHeight={220}>
        {({ width, height }) => (
          <LineChart
            width={width}
            height={height}
            data={chartData}
            margin={{ top: 8, right: 16, left: 12, bottom: 8 }}
          >
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              tickFormatter={formatShortDate}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              domain={['auto', 'auto']}
              label={{ value: adjustmentMode === 'adjusted' ? 'Adj. VND' : 'VND', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ background: 'var(--bg-tooltip)', border: '1px solid var(--border-default)', fontSize: '11px' }}
              labelStyle={{ color: 'var(--text-muted)' }}
            />
            {eventMarkers.map((marker) => (
              <ReferenceLine
                key={`${marker.date}-${marker.shortLabel}`}
                x={marker.date}
                stroke={marker.color}
                strokeDasharray="3 4"
                label={{ value: marker.shortLabel, fill: marker.color, fontSize: 10, position: 'insideTopRight' }}
              />
            ))}
            <Line type="monotone" dataKey="close" stroke="#38bdf8" strokeWidth={2} dot={false} />
          </LineChart>
        )}
      </ChartSizeBox>
    </div>
  )
}

export default HistoricalPriceChart
