import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import type { DividendsResponse } from '@/lib/api'
import { useDividends } from '@/lib/queries'
import { DividendPaymentWidget } from './DividendPaymentWidget'

jest.mock('@/lib/queries', () => ({ useDividends: jest.fn() }))

const mockUseDividends = jest.mocked(useDividends)

test.each([
  [0, 'stock', '10.00% stock'],
  [1000, 'mixed', 'VND1,000 + 10.00% stock'],
] as const)('renders reported stock payout with %s cash (%s)', (cashDividend, type, payout) => {
  mockUseDividends.mockReturnValue({
    data: { data: [{ cash_dividend: cashDividend, stock_dividend: 10, type }] },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as unknown as UseQueryResult<DividendsResponse, Error>)

  render(<DividendPaymentWidget symbol="VNM" />)

  expect(screen.getByText(payout)).toBeInTheDocument()
  expect(screen.queryByText('VND0')).not.toBeInTheDocument()
})
