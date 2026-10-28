import type { UseQueryResult } from '@tanstack/react-query'
import type { QuantResponse } from '@/lib/api'
import { render, screen } from '@testing-library/react'
import { useQuantMetrics } from '@/lib/queries'
import { useLoadingTimeout } from '@/hooks/useLoadingTimeout'
import { GapAnalysisWidget } from './GapAnalysisWidget'

jest.mock('@/lib/queries', () => ({ useQuantMetrics: jest.fn() }))
jest.mock('@/hooks/useLoadingTimeout', () => ({ useLoadingTimeout: jest.fn() }))
jest.mock('@/hooks/useDirectionColors', () => ({ useDirectionColors: () => ({ positive: 'green', negative: 'red' }) }))
jest.mock('@/components/ui/ChartMountGuard', () => ({ ChartMountGuard: () => null }))
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))

const query = jest.mocked(useQuantMetrics)
const loadingTimeout = jest.mocked(useLoadingTimeout)

function showGap(meta: Record<string, unknown> = { unit_status: 'confirmed_vnd' }) {
  loadingTimeout.mockReturnValue({ timedOut: false, resetTimeout: jest.fn() })
  query.mockReturnValue({
    data: {
      meta,
      data: { metrics: { gap_stats: {
        gap_up_frequency_pct: null,
        gap_down_frequency_pct: 0,
        gap_fill_rate_pct: null,
        monthly_avg_gap_pct: { Jan: null },
        top_gaps: [{ date: '2026-10-07', type: 'gap_up', gap_pct: null, next_day_return_pct: null, filled: false }],
      } } },
    },
    isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
  } as unknown as UseQueryResult<QuantResponse, Error>)
  render(<GapAnalysisWidget symbol="MSR" />)
}

describe('GapAnalysisWidget unavailable values', () => {
  it('renders missing values as unavailable while preserving genuine zero', () => {
    showGap()
    expect(screen.getAllByText('N/A')).toHaveLength(4)
    expect(screen.getAllByText('0.00%')).toHaveLength(1)
  })

  it.each([
    {},
    { unit_status: 'mixed' },
    { unit_status: 'confirmed_vnd', unresolved_excluded_dates: ['2026-09-21'] },
  ])('withholds derived gaps without resolved certified quality: %j', (meta) => {
    showGap(meta)
    expect(screen.getByText(/historical price units or source quality were not certified/)).toBeInTheDocument()
    expect(screen.queryByText('Fill Rate')).not.toBeInTheDocument()
  })
})
