import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useMarketOverview } from '@/lib/queries'
import type { MarketOverviewResponse } from '@/types/equity'
import { MarketOverviewWidget } from './MarketOverviewWidget'

jest.mock('@/lib/queries', () => ({ useMarketOverview: jest.fn() }))
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))

const query = jest.mocked(useMarketOverview)

describe('MarketOverviewWidget index dates', () => {
  it('reports each index against its own source date, never a shared latest date', () => {
    // #205: HNX observed 2026-10-30 while VNINDEX observed 2026-11-02. One
    // latest-across-rows date would imply the older observation is current.
    query.mockReturnValue({
      data: {
        count: 2,
        source: 'db_fallback',
        updated_at: '2026-11-02T00:00:00',
        data: [
          { index_name: 'VNINDEX', current_value: 1829.04, change: 12.04, change_pct: 0.66, time: '2026-11-02' },
          { index_name: 'HNX', current_value: 252.74, change: -3.87, change_pct: -1.51, time: '2026-10-30' },
        ],
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<MarketOverviewResponse, Error>)

    render(<MarketOverviewWidget />)

    expect(screen.getByText('As of: 02 Nov 2026')).toBeInTheDocument()
    expect(screen.getByText('As of: 30 Oct 2026')).toBeInTheDocument()
  })
})
