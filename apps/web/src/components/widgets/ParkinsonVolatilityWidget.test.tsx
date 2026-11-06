import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useQuantMetrics } from '@/lib/queries'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import type { QuantResponse } from '@/lib/api'
import { ParkinsonVolatilityWidget } from './ParkinsonVolatilityWidget'

jest.mock('@/lib/queries', () => ({ useQuantMetrics: jest.fn() }))
jest.mock('@/hooks/useLoadingTimeout', () => ({ useLoadingTimeout: jest.fn() }))
jest.mock('@/components/ui/ChartMountGuard', () => ({ ChartMountGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))
jest.mock('recharts', () => ({
  Area: () => null,
  CartesianGrid: () => null,
  ComposedChart: ({ data }: { data: unknown[] }) => <output data-testid="series">{JSON.stringify(data)}</output>,
  Line: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

const query = jest.mocked(useQuantMetrics)
const loadingTimeout = jest.mocked(useLoadingTimeout)

describe('ParkinsonVolatilityWidget unavailable values', () => {
  it('keeps missing metrics and series points unavailable while preserving measured zero', () => {
    loadingTimeout.mockReturnValue({ timedOut: false, resetTimeout: jest.fn() })
    query.mockReturnValue({
      data: {
        meta: { unit_status: 'confirmed_vnd' },
        data: { metrics: { parkinson_volatility: {
          current_parkinson_vol_30d_pct: null,
          current_close_close_vol_30d_pct: 0,
          close_to_park_ratio: null,
          current_regime: 'normal',
          current_regime_z_score: null,
          series: Array.from({ length: 31 }, (_, index) => ({
            date: `2026-10-${String(index + 1).padStart(2, '0')}`,
            parkinson_vol_pct: index === 30 ? null : 0,
            close_close_vol_pct: 0,
            z_score: null,
            regime: null,
          })),
        } } },
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<QuantResponse, Error>)

    render(<ParkinsonVolatilityWidget symbol="MSR" />)

    expect(screen.getAllByText('n/a')).toHaveLength(2)
    expect(screen.getByText('Z-score n/a')).toBeInTheDocument()
    expect(screen.getAllByText('0.00%').length).toBeGreaterThan(0)
    const series = JSON.parse(screen.getByTestId('series').textContent ?? '[]')
    expect(series.at(-1)).toMatchObject({ parkinson: null, closeVol: 0, z: null })
  })
})
