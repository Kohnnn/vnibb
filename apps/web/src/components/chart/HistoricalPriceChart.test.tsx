import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { useCompanyEvents, useHistoricalPrices } from '@/lib/queries'
import { HistoricalPriceChart } from './HistoricalPriceChart'

const mockLineChartData = jest.fn()

jest.mock('@/lib/queries', () => ({
  useCompanyEvents: jest.fn(),
  useHistoricalPrices: jest.fn()
}))

jest.mock('@/components/ui/ChartSizeBox', () => ({
  ChartSizeBox: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) => (
    <div>{children({ width: 640, height: 360 })}</div>
  )
}))

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div data-testid="widget-skeleton" />
}))

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>
}))

// Keep the real chart component and assert the axis label rendered by Recharts.
jest.mock('recharts', () => ({
  CartesianGrid: () => null,
  Line: () => null,
  LineChart: ({ children, data }: { children: ReactNode; data: unknown }) => {
    mockLineChartData(data)
    return <div>{children}</div>
  },
  ReferenceLine: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: ({ label }: { label?: { value?: string } }) => (
    <div data-testid="price-axis-label">{label?.value}</div>
  )
}))

const mockUseHistoricalPrices = useHistoricalPrices as jest.Mock
const mockUseCompanyEvents = useCompanyEvents as jest.Mock

function historyQuery(rows: Array<Record<string, unknown>>, unitStatus?: string | null) {
  return {
    data: { data: rows, meta: { count: rows.length, unit_status: unitStatus ?? null } },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return { time: '2026-10-02', open: 57000, high: 57500, low: 56000, close: 57000, volume: 100, ...overrides }
}

function renderChart() {
  render(<HistoricalPriceChart symbol="FPT" timeframe="1M" />)
  return screen.getByTestId('price-axis-label').textContent
}

describe('HistoricalPriceChart axis price unit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseCompanyEvents.mockReturnValue({ data: { data: [] } })
  })

  test('labels confirmed VND history as adjusted VND without touching values', () => {
    mockUseHistoricalPrices.mockReturnValue(historyQuery([row({ price_unit: 'VND' })], 'confirmed_vnd'))
    expect(renderChart()).toBe('Adj. VND')
    expect(mockLineChartData).toHaveBeenLastCalledWith([{ date: '2026-10-02', close: 57000 }])
  })

  test('uses the raw VND label when the raw adjustment mode is selected', () => {
    mockUseHistoricalPrices.mockReturnValue(historyQuery([row({ price_unit: 'VND' })], 'confirmed_vnd'))
    render(<HistoricalPriceChart symbol="FPT" timeframe="1M" />)
    fireEvent.click(screen.getByRole('button', { name: 'raw' }))
    expect(screen.getByTestId('price-axis-label').textContent).toBe('VND')
  })

  test('uses confirmed_vnd metadata only when the row marker is missing', () => {
    mockUseHistoricalPrices.mockReturnValue(historyQuery([row({ price_unit: undefined })], 'confirmed_vnd'))
    expect(renderChart()).toBe('Adj. VND')
  })

  test('does not label an explicit unknown row marker as VND even with confirmed_vnd metadata', () => {
    mockUseHistoricalPrices.mockReturnValue(historyQuery([row({ price_unit: 'unknown' })], 'confirmed_vnd'))
    expect(renderChart()).toBe('Price unit unconfirmed')
  })

  test('keeps genuinely unconfirmed history off the VND label', () => {
    mockUseHistoricalPrices.mockReturnValue(historyQuery([row({ price_unit: undefined })], 'unconfirmed'))
    expect(renderChart()).toBe('Price unit unconfirmed')
  })

  test('preserves index point units and adjusted semantics', () => {
    mockUseHistoricalPrices.mockReturnValue(
      historyQuery([row({ price_unit: 'index_points', close: 1210 })], 'not_applicable')
    )
    expect(renderChart()).toBe('Adj. Index points')
    expect(mockLineChartData).toHaveBeenLastCalledWith([{ date: '2026-10-02', close: 1210 }])
  })

  test('keeps a mixed-unit series unconfirmed rather than defaulting to VND', () => {
    mockUseHistoricalPrices.mockReturnValue(
      historyQuery(
        [row({ time: '2026-10-01', price_unit: 'VND' }), row({ time: '2026-10-02', price_unit: 'unknown' })],
        'mixed'
      )
    )
    expect(renderChart()).toBe('Price unit unconfirmed')
  })
})
