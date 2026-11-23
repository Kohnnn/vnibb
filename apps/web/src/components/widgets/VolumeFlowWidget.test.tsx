import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@/contexts/ThemeContext'
import type { QuantResponse } from '@/lib/api'
import { rowsToCSV } from '@/lib/exportWidget'
import { useQuantMetrics } from '@/lib/queries'
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime'
import { VolumeFlowWidget } from './VolumeFlowWidget'

jest.mock('@/lib/queries', () => ({ useQuantMetrics: jest.fn() }))
jest.mock('@/components/ui/ChartMountGuard', () => ({
  ChartMountGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
jest.mock('recharts', () => ({
  Bar: () => null,
  BarChart: ({ data }: { data: unknown }) => <pre data-testid="monthly-chart">{JSON.stringify(data)}</pre>,
  CartesianGrid: () => null,
  Cell: () => null,
  Line: ({ dataKey, connectNulls }: { dataKey: string; connectNulls?: boolean }) => (
    <span data-testid={`${dataKey}-line`} data-connect-nulls={String(connectNulls)} />
  ),
  LineChart: ({ data, children }: { data: unknown; children: ReactNode }) => (
    <div><pre data-testid="cumulative-chart">{JSON.stringify(data)}</pre>{children}</div>
  ),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

function show(metric: Record<string, unknown>, meta: QuantResponse['meta'] = { unit_status: 'confirmed_vnd' }) {
  jest.mocked(useQuantMetrics).mockReturnValue({
    data: {
      data: {
        symbol: 'FPT', period: '5Y', computed_at: '2026-11-05T00:00:00Z',
        metrics: { volume_delta: metric },
      },
      meta,
    },
    error: null,
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  } as unknown as UseQueryResult<QuantResponse, Error>)
  const publish = jest.fn<void, [WidgetDataPayload]>()
  render(<ThemeProvider><VolumeFlowWidget symbol="FPT" onDataChange={publish} /></ThemeProvider>)
  const payload = publish.mock.lastCall?.[0]
  return { payload, exported: getWidgetExportData(payload) }
}

function field(label: string) {
  return within(screen.getByText(label).parentElement!)
}

test('renders and exports missing flow as gaps beside measured zero and signed observations', () => {
  const basis = {
    cumulative: 'observed_subtotal', monthly_avg: 'observed_sample',
    observed_delta_bars: 3, returned_price_bars: 4,
  }
  const cumulative = [
    { date: '2026-11-02', delta: 2500, cumulative_delta: 2500, close: 100 },
    { date: '2026-11-03', delta: null, cumulative_delta: null, close: 101 },
    { date: '2026-11-04', delta: -2500, cumulative_delta: 0, close: null },
    { date: '2026-11-05', delta: -1000, cumulative_delta: -1000, close: 99 },
  ]
  const { payload, exported } = show({
    monthly_avg: { Jan: 2500, Feb: null, Mar: 0, Apr: -2500 },
    current_20d_cumulative_delta: null,
    divergence_months: null,
    cumulative,
    basis,
  })

  expect(field('20D Cumulative').getByText('n/a')).toBeVisible()
  expect(field('Divergence Months').getByText('n/a')).toBeVisible()
  expect(field('Jan').getByText('2.50K')).toBeVisible()
  expect(field('Feb').getByText('n/a')).toBeVisible()
  expect(field('Mar').getByText('0.00')).toBeVisible()
  expect(field('Apr').getByText('-2.50K')).toBeVisible()
  expect(screen.getByText(/observed subtotal/i)).toHaveTextContent('3 of 4 returned bars observed')
  expect(JSON.parse(screen.getByTestId('monthly-chart').textContent!).slice(0, 5)).toEqual([
    { month: 'Jan', value: 2500 }, { month: 'Feb', value: null }, { month: 'Mar', value: 0 },
    { month: 'Apr', value: -2500 }, { month: 'May', value: null },
  ])
  expect(JSON.parse(screen.getByTestId('cumulative-chart').textContent!)).toEqual(cumulative)
  expect(screen.getByTestId('cumulative_delta-line')).toHaveAttribute('data-connect-nulls', 'false')
  expect(screen.getByTestId('close-line')).toHaveAttribute('data-connect-nulls', 'false')
  expect(payload?.__widgetRuntime?.provenance?.basis).toMatch(/observed subtotal/i)
  expect(exported).toEqual(expect.arrayContaining([
    expect.objectContaining({ section: 'summary', current_20d_cumulative_delta: null, divergence_months: null, basis }),
    expect.objectContaining({ section: 'monthly', month: 'Feb', avg_delta: null }),
    expect.objectContaining({ section: 'monthly', month: 'Mar', avg_delta: 0 }),
    ...cumulative.map((row) => expect.objectContaining({ section: 'daily', ...row })),
  ]))
  if (!Array.isArray(exported)) throw new Error('Expected volume flow export rows')
  const [header, ...rows] = rowsToCSV(exported).split('\n')
  const columns = header.split(',')
  const dailyColumns = ['delta', 'cumulative_delta', 'close'].map((column) => columns.indexOf(column))
  const dailyRows = rows.filter((row) => row.startsWith('daily,')).map((row) => row.split(','))
  expect(dailyRows.map((row) => dailyColumns.map((index) => row[index]))).toEqual([
    ['2500', '2500', '100'], ['', '', '101'], ['-2500', '0', ''], ['-1000', '-1000', '99'],
  ])
})

test('keeps a zero-only flow response populated', () => {
  const cumulative = Array.from({ length: 20 }, (_, index) => ({
    date: `2026-${index < 10 ? '10' : '11'}-${String(index % 10 + 1).padStart(2, '0')}`,
    delta: 0, cumulative_delta: 0, close: 100,
  }))
  const { payload, exported } = show({
    monthly_avg: { Oct: 0, Nov: 0 }, cumulative, current_20d_cumulative_delta: 0, divergence_months: 0,
    basis: { cumulative: 'full_returned_window', monthly_avg: 'observed_sample', observed_delta_bars: 20, returned_price_bars: 20 },
  })

  expect(field('20D Cumulative').getByText('0.00')).toBeVisible()
  expect(field('Divergence Months').getByText('0')).toBeVisible()
  expect(field('Nov').getByText('0.00')).toBeVisible()
  expect(JSON.parse(screen.getByTestId('cumulative-chart').textContent!)).toEqual(cumulative)
  expect(payload?.__widgetRuntime?.layoutHint?.empty).toBe(false)
  expect(exported).toEqual(expect.arrayContaining([
    expect.objectContaining({ section: 'summary', current_20d_cumulative_delta: 0, divergence_months: 0 }),
    expect.objectContaining({ section: 'daily', ...cumulative[0] }),
  ]))
})

test('does not present or export a flow observation when every delta is unavailable', () => {
  const { payload, exported } = show({
    monthly_avg: { Nov: null },
    cumulative: [{ date: '2026-11-03', delta: null, cumulative_delta: null, close: 100 }],
    current_20d_cumulative_delta: null,
    divergence_months: null,
  })

  expect(screen.getByText(/volume flow data is unavailable/i)).toBeVisible()
  expect(screen.queryByTestId('monthly-chart')).not.toBeInTheDocument()
  expect(screen.queryByTestId('cumulative-chart')).not.toBeInTheDocument()
  expect(payload?.__widgetRuntime?.layoutHint?.empty).toBe(true)
  expect(exported).toBeUndefined()
})

test('does not chart or export flow before the price units are certified', () => {
  const { payload, exported } = show({ monthly_avg: { Nov: -2500 } }, { unit_status: 'mixed' })

  expect(screen.getByText(/historical price units were not certified/i)).toBeVisible()
  expect(screen.queryByTestId('monthly-chart')).not.toBeInTheDocument()
  expect(payload?.__widgetRuntime?.layoutHint?.empty).toBe(true)
  expect(exported).toBeUndefined()
})
