'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { useHistoricalPrices } from '@/lib/queries'
import { ChartSizeBox } from '@/components/ui/ChartSizeBox'
import { WidgetSkeleton } from '@/components/ui/widget-skeleton'
import { WidgetEmpty } from '@/components/ui/widget-states'

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
    enabled: Boolean(symbol)
  })

  const rows = historyQuery.data?.data || []
  const hasData = rows.length > 0

  const chartData = useMemo(
    () =>
      rows.map((point) => ({
        date: point.time,
        close: point.close
      })),
    [rows]
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
            label={{ value: 'VND', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ background: 'var(--bg-tooltip)', border: '1px solid var(--border-default)', fontSize: '11px' }}
            labelStyle={{ color: 'var(--text-muted)' }}
          />
          <Line type="monotone" dataKey="close" stroke="#38bdf8" strokeWidth={2} dot={false} />
        </LineChart>
      )}
    </ChartSizeBox>
  )
}

export default HistoricalPriceChart
