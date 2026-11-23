import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { render, screen, within } from '@testing-library/react'

import { useQuantRegime } from '@/hooks/useQuantRegime'
import { rowsToCSV } from '@/lib/exportWidget'
import { useQuantMetrics } from '@/lib/queries'
import { buildQuantRegimeSummary } from '@/lib/quantRegime'
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime'
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
  RadarChart: ({ children, data }: { children: ReactNode; data: unknown }) => (
    <div><pre data-testid="quant-radar-data">{JSON.stringify(data)}</pre>{children}</div>
  ),
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

test.each([
  { delta: null, label: 'Unavailable', displayDelta: 'n/a', score: null, composite: 89, factors: 9, coverage: 'Flow excluded (unavailable)' },
  { delta: 0, label: 'Balanced', displayDelta: '0.00', score: 50, composite: 85, factors: 10, coverage: 'Flow included' },
  { delta: 10, label: 'Accumulating', displayDelta: '+10.00', score: 75, composite: 88, factors: 10, coverage: 'Flow included' },
  { delta: -20, label: 'Distributing', displayDelta: '-20.00', score: 0, composite: 80, factors: 10, coverage: 'Flow included' },
])('renders and exports $label flow using $factors composite factors', ({ delta, label, displayDelta, score, composite, factors, coverage }) => {
  mockUseQuantRegime.mockReturnValue({
    ...buildQuantRegimeSummary({ hurst: 0.62, momentumScore: 4, volatilityRegime: 'low' }),
    hasData: true, derivedWithheld: false, isLoading: false, refetch: jest.fn(),
  })
  setQuantResponse({
    volume_delta: {
      current_20d_cumulative_delta: delta,
      cumulative: Array.from({ length: 21 }, (_, i) => ({
        cumulative_delta: i === (delta === null ? 20 : 0) ? null : i === 1 ? -20 : i === 20 ? delta : 0,
      })),
      basis: { cumulative: 'observed_subtotal', monthly_avg: 'observed_sample', observed_delta_bars: 20, returned_price_bars: 21 },
    },
    seasonality: { hit_rate_pct: 100 },
    sortino: { monthly_sortino: { Nov: 3 } },
    drawdown_recovery: { max_drawdown_from_52w_high_pct: -20, avg_days_to_recovery: 30 },
    ema_respect: { ema_levels: [{ support_bounce_rate_pct: 100, support_strength: 'strong' }] },
    benchmark_risk: { current_tracking_error_30d_pct: 0, downside_deviation_30d_pct: 0 },
  })
  const publish = jest.fn<void, [WidgetDataPayload]>()
  render(<QuantSummaryWidget id="quant-summary" symbol="FPT" onDataChange={publish} />)

  const flow = within(screen.getByText('Flow', { exact: true }).parentElement!)
  expect(flow.getByText(label)).toBeVisible()
  expect(flow.getByText(`20D delta ${displayDelta}`)).toBeVisible()
  expect(flow.getByText(/observed subtotal/i)).toHaveTextContent('20 of 21 returned bars observed')
  expect(screen.getByText(`${composite}/100`)).toBeVisible()
  const composition = `${factors} equally weighted factors · ${coverage}`
  expect(screen.getByText(composition)).toBeVisible()
  const radar = JSON.parse(screen.getByTestId('quant-radar-data').textContent!) as Array<{ metric: string; value: number }>
  expect(radar).toHaveLength(factors)
  expect(radar.filter(({ metric }) => metric === 'Flow')).toEqual(
    score === null ? [] : [{ metric: 'Flow', value: score, fullMark: 100 }],
  )
  const payload = publish.mock.lastCall?.[0]
  expect(payload).toMatchObject({ compositeRiskScore: composite, __widgetRuntime: { provenance: { basis: composition } } })
  const exported = getWidgetExportData(payload)
  expect(exported).toEqual([expect.objectContaining({
    flow_score: score,
    current_20d_cumulative_delta: delta,
    flow_cumulative_basis: 'Observed subtotal · 20 of 21 returned bars observed',
    composite_risk_score: composite,
    composite_factor_count: factors,
    composite_basis: composition,
  })])
  if (!Array.isArray(exported)) throw new Error('Expected quant summary export rows')
  const [headers, row] = rowsToCSV(exported).split('\n')
  expect(row.split(',')[headers.split(',').indexOf('flow_score')]).toBe(score === null ? '' : String(score))
})

test('does not show or export a composite when only partial flow history is available', () => {
  mockUseQuantRegime.mockReturnValue({ ...summary, hasData: false, derivedWithheld: false, isLoading: false, refetch: jest.fn() })
  setQuantResponse({
    volume_delta: { current_20d_cumulative_delta: null, cumulative: [{ cumulative_delta: -20 }, { cumulative_delta: null }] },
    seasonality: { hit_rate_pct: null },
    sortino: { monthly_sortino: { Nov: null } },
  })
  const publish = jest.fn<void, [WidgetDataPayload]>()
  render(<QuantSummaryWidget id="quant-summary" symbol="FPT" onDataChange={publish} />)

  expect(screen.getByText('Quant summary is not available yet')).toBeVisible()
  expect(screen.queryByText('Risk Score')).not.toBeInTheDocument()
  expect(screen.queryByTestId('quant-radar-data')).not.toBeInTheDocument()
  const payload = publish.mock.lastCall?.[0]
  expect(payload).not.toHaveProperty('compositeRiskScore')
  expect(payload?.__widgetRuntime?.layoutHint?.empty).toBe(true)
  expect(payload?.__widgetRuntime?.exportData).toBeUndefined()
})

test('keeps measured details visible without treating them as weighted inputs', () => {
  mockUseQuantRegime.mockReturnValue({ ...summary, hasData: false, derivedWithheld: false, isLoading: false, refetch: jest.fn() })
  setQuantResponse({
    volume_delta: { current_20d_cumulative_delta: null },
    calmar: { calmar_ratio: 1.25 },
  })
  const publish = jest.fn<void, [WidgetDataPayload]>()
  render(<QuantSummaryWidget id="quant-summary" symbol="FPT" onDataChange={publish} />)

  expect(screen.getByText('+1.25')).toBeVisible()
  expect(screen.getByText('No composite inputs available')).toBeVisible()
  expect(within(screen.getByText('Risk Score').parentElement!).getByText('n/a')).toBeVisible()
  expect(screen.queryByTestId('quant-radar-data')).not.toBeInTheDocument()
  expect(getWidgetExportData(publish.mock.lastCall?.[0])).toEqual([expect.objectContaining({
    flow_score: null,
    composite_risk_score: null,
    composite_factor_count: 0,
    calmar_ratio: 1.25,
  })])
})
