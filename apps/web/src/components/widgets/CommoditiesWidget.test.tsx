import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useCommodities } from '@/lib/queries'
import type { CommoditiesResponse } from '@/lib/api'
import { CommoditiesWidget } from './CommoditiesWidget'

jest.mock('@/lib/queries', () => ({ useCommodities: jest.fn() }))
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))

const query = jest.mocked(useCommodities)

describe('CommoditiesWidget spreads', () => {
  it('shows unavailable quotes, preserves measured zero, and retains fractional precision without negative zero', () => {
    query.mockReturnValue({
      data: {
        source: 'test',
        count: 6,
        data: [
          { source: 'test', symbol: 'MISS-BUY', buy_price: null, sell_price: 12 },
          { source: 'test', symbol: 'MISS-SELL', buy_price: 12, sell_price: null },
          { source: 'test', symbol: 'ZERO', buy_price: 12, sell_price: 12 },
          { source: 'test', symbol: 'FRACTION', buy_price: 12.4, sell_price: 12.6 },
          // A genuinely negative spread smaller than the display precision.
          { source: 'test', symbol: 'SMALL-NEGATIVE', buy_price: 12.401, sell_price: 12.4 },
          { source: 'test', symbol: 'FRACTIONAL-THREE', buy_price: 12.4, sell_price: 12.401 },
        ],
      },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<CommoditiesResponse, Error>)

    render(<CommoditiesWidget />)

    expect(screen.getAllByText('Spread n/a')).toHaveLength(2)
    // Brand §19: a measured zero spread is `0`, not `+0`; 12.401 - 12.4 is
    // 0.001 in either direction and rounds to the same unsigned zero.
    expect(screen.getAllByText('Spread 0')).toHaveLength(3)
    expect(screen.queryByText('-0')).not.toBeInTheDocument()
    // A fractional spread keeps its decimals instead of rounding to `-0`.
    expect(screen.getByText('Spread +0.2')).toBeInTheDocument()
    // Regression: quotes were rounded to whole units, so 12.4/12.6 rendered as
    // Buy 12, Sell 13 beside a +0.2 spread. Quotes keep the meaningful digits.
    expect(screen.getAllByText('Buy 12.4').length).toBeGreaterThan(0)
    expect(screen.getByText('Sell 12.6')).toBeInTheDocument()
  })
})
