import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { render, screen } from '@testing-library/react'

import { useQuantRegime } from '@/hooks/useQuantRegime'
import { useQuantMetrics } from '@/lib/queries'
import { buildQuantRegimeSummary } from '@/lib/quantRegime'
import type { WidgetDataPayload } from '@/lib/widgetRuntime'
import { QuantSummaryWidget } from './QuantSummaryWidget'

jest.mock('@/lib/queries', () => ({ useQuantMetrics: jest.fn() }))
jest.mock('@/hooks/useQuantRegime', () => ({ useQuantRegime: jest.fn() }))
jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}))
jest.mock('@/components/ui/ChartMountGuard', () => ({
  ChartMountGuard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('recharts', () => ({
  PolarAngleAxis: () => null,
  PolarGrid: () => null,
  PolarRadiusAxis: () => null,
  Radar: () => null,
  RadarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
}))

const mockUseQuantMetrics = useQuantMetrics as unknown as jest.Mock
const mockUseQuantRegime = useQuantRegime as unknown as jest.Mock

const summary = buildQuantRegimeSummary({ hurst: null })

function setQuantResponse(metrics?: Record<string, unknown>, error: Error | null = null) {
  mockUseQuantMetrics.mockReturnValue({
    data: metrics ? {
      data: {
        symbol: 'FPT',
        period: '5Y',
        computed_at: '2026-09-01T00:00:00Z',
        metrics,
      },
      meta: { unit_status: 'confirmed_vnd', unresolved_excluded_dates: [] },
    } : undefined,
    error,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
  })
}

test('reports quant data transitions once despite parent state updates on cold and error renders', () => {
  mockUseQuantRegime.mockReturnValue({
    ...summary,
    hasData: false,
    derivedWithheld: false,
    isLoading: false,
    isFetching: false,
    error: null,
    updatedAt: undefined,
    refetch: jest.fn(),
  })
  const onUpdate = jest.fn()

  function Parent() {
    const [runtime, setRuntime] = useState<WidgetDataPayload | null>(null)
    const handleDataChange = useCallback((next: WidgetDataPayload) => {
      onUpdate(next)
      setRuntime(next)
    }, [])

    return (
      <>
        <output data-testid="metrics-count">{String(runtime?.metrics ?? -1)}</output>
        <QuantSummaryWidget id="quant-summary" symbol="FPT" onDataChange={handleDataChange} />
      </>
    )
  }

  setQuantResponse()
  const { rerender } = render(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('metrics-count')).toHaveTextContent('0')

  setQuantResponse(undefined, new Error('Network unavailable'))
  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(1)

  const metrics = {
    seasonality: { hit_rate_pct: 72, best_month: 'January', worst_month: 'March' },
    benchmark_risk: { benchmark: 'VNINDEX', current_tracking_error_30d_pct: 2.5 },
  }
  setQuantResponse(metrics)
  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(2)
  expect(screen.getByTestId('metrics-count')).toHaveTextContent('2')
  expect(onUpdate.mock.lastCall?.[0]).toMatchObject({
    metrics: 2,
    __widgetRuntime: {
      provenance: { updatedAt: null, fetchedAt: '2026-09-01T00:00:00Z' },
    },
  })
  expect(screen.getByText('January')).toBeInTheDocument()
  expect(screen.getByText('March')).toBeInTheDocument()

  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(2)

  setQuantResponse()
  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(3)
  expect(screen.getByTestId('metrics-count')).toHaveTextContent('0')

  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(3)
})


test.each([
  undefined,
  { unit_status: 'mixed' },
  { unit_status: 'confirmed_vnd', unresolved_excluded_dates: ['2026-10-08'] },
])('withholds legacy or unresolved quant summary %j', (meta) => {
  mockUseQuantRegime.mockReturnValue({ ...summary, hasData: true, derivedWithheld: false, isLoading: false, refetch: jest.fn() })
  setQuantResponse({ drawdown_recovery: { max_drawdown_from_52w_high_pct: -99.9 } })
  mockUseQuantMetrics.mockReturnValue({ ...mockUseQuantMetrics(), data: { ...mockUseQuantMetrics().data, meta } })
  const onDataChange = jest.fn()
  render(<QuantSummaryWidget id="quant-summary" symbol="MSR" onDataChange={onDataChange} />)

  expect(screen.getByText(/Quant summary unavailable:/)).toBeInTheDocument()
  expect(screen.queryByText('Risk Score')).not.toBeInTheDocument()
  expect(onDataChange.mock.lastCall?.[0]).not.toHaveProperty('compositeRiskScore')
  expect(onDataChange.mock.lastCall?.[0]).not.toHaveProperty('regime')
})

test('preserves certified genuine extreme metrics and benign warnings', () => {
  mockUseQuantRegime.mockReturnValue({ ...summary, hasData: true, derivedWithheld: false, isLoading: false, refetch: jest.fn() })
  setQuantResponse({ calmar: { annualized_return_pct: -69.2 }, benchmark_risk: { current_tracking_error_30d_pct: 161.35 } })
  mockUseQuantMetrics.mockReturnValue({ ...mockUseQuantMetrics(), data: {
    ...mockUseQuantMetrics().data,
    data: { ...mockUseQuantMetrics().data.data, warning: 'Latest history is stale.' },
  } })
  render(<QuantSummaryWidget id="quant-summary" symbol="MSR" />)

  expect(screen.getByText('Risk Score')).toBeInTheDocument()
  expect(screen.getByText('-69.20%')).toBeInTheDocument()
  expect(screen.getByText('+161.35%')).toBeInTheDocument()
  expect(screen.getByText('Latest history is stale.')).toBeInTheDocument()
})
