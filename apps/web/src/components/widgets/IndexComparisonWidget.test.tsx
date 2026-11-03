import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useMarketOverview } from '@/lib/queries'
import type { MarketOverviewResponse } from '@/types/equity'
import { IndexComparisonWidget } from './IndexComparisonWidget'

jest.mock('@/lib/queries', () => ({ useMarketOverview: jest.fn() }))
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))

const query = jest.mocked(useMarketOverview)

describe('IndexComparisonWidget movement', () => {
  it('renders unavailable, zero, positive, and negative changes with the right direction', () => {
    query.mockReturnValue({
      data: { data: [
        { index_name: 'VNINDEX', current_value: 1000, change_pct: null },
        { index_name: 'VN30', current_value: 1200, change_pct: 0 },
        { index_name: 'HNX', current_value: 300, change_pct: 1.25 },
        { index_name: 'UPCOM', current_value: 90, change_pct: -0.5 },
      ] },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    } as unknown as UseQueryResult<MarketOverviewResponse, Error>)

    render(<IndexComparisonWidget />)
    expect(screen.getByText('n/a')).toBeInTheDocument()
    expect(screen.getByText('0.00%')).toHaveClass('text-[var(--text-muted)]')
    expect(screen.getByText('+1.25%')).toHaveClass('text-[var(--color-positive)]')
    expect(screen.getByText('-0.50%')).toHaveClass('text-[var(--color-negative)]')
    expect(screen.getByText('1,000.00')).toBeInTheDocument()
    // A measured flat session has no direction, so its badge carries no glyph —
    // an ArrowDown on `0.00%` reads as a loss.
    const flat = screen.getByText('0.00%').parentElement!
    expect(flat.querySelector('svg')).toBeNull()
    const gain = screen.getByText('+1.25%').parentElement!
    expect(gain.querySelector('svg')).not.toBeNull()
  })
})
