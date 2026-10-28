import type { UseQueryResult } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'

import type { InsiderTrade } from '@/types/insider'
import type { DividendsResponse } from '@/lib/api'
import { useCompanyNews, useDividends, useInsiderDeals } from '@/lib/queries'
import { NewsCorporateActionsWidget } from './NewsCorporateActionsWidget'

jest.mock('@/lib/queries', () => ({
  useCompanyNews: jest.fn(),
  useDividends: jest.fn(),
  useInsiderDeals: jest.fn(),
}))

const mockUseCompanyNews = jest.mocked(useCompanyNews)
const mockUseDividends = jest.mocked(useDividends)
const mockUseInsiderDeals = jest.mocked(useInsiderDeals)

function queryResult<T>(
  data: T,
  overrides: { error?: Error | null; refetch?: () => unknown } = {},
): UseQueryResult<T, Error> {
  return {
    data,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
    ...overrides,
  } as unknown as UseQueryResult<T, Error>
}

test.each<[number | null | undefined, string]>([
  [0.25, 'Cash • 0.25%'],
  [0, 'Cash • 0.00%'],
  [1, 'Cash • 1.00%'],
  [null, 'Cash'],
  [undefined, 'Cash'],
])('renders canonical dividend yield %s without scaling or inventing missing values', (dividendYield, label) => {
  mockUseCompanyNews.mockReturnValue(queryResult({ symbol: 'VNM', count: 0, data: [] }))
  mockUseInsiderDeals.mockReturnValue(queryResult([]))
  mockUseDividends.mockReturnValue(queryResult<DividendsResponse>({
    data: [{ cash_dividend: 1000, dividend_type: 'cash', dividend_yield: dividendYield }],
  }))

  render(<NewsCorporateActionsWidget id="news-corporate-actions" symbol="VNM" />)

  expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.getByText('VND1,000')).toBeInTheDocument()
  expect(screen.getByText('Corporate Actions')).toBeInTheDocument()
})

test.each([
  [0, 'stock', '10.00% stock'],
  [1000, 'mixed', 'VND1,000 + 10.00% stock'],
] as const)('renders reported stock payout with %s cash (%s)', (cashDividend, type, payout) => {
  mockUseCompanyNews.mockReturnValue(queryResult({ symbol: 'VNM', count: 0, data: [] }))
  mockUseInsiderDeals.mockReturnValue(queryResult([]))
  mockUseDividends.mockReturnValue(queryResult<DividendsResponse>({
    data: [{ cash_dividend: cashDividend, stock_dividend: 10, type }],
  }))

  render(<NewsCorporateActionsWidget id="news-corporate-actions" symbol="VNM" />)

  expect(screen.getByText(payout)).toBeInTheDocument()
  expect(screen.queryByText('VND0')).not.toBeInTheDocument()
})
test.each(['dividend', 'insider'] as const)('top-level retry recovers terminal %s errors', (failedSection) => {
  const refetchNews = jest.fn()
  const terminalError = new Error('Request failed')
  let dividendsRecovered = false
  let insiderRecovered = false
  const refetchDividends = jest.fn(async () => { dividendsRecovered = true })
  const refetchInsider = jest.fn(async () => { insiderRecovered = true })
  mockUseCompanyNews.mockReturnValue({
    ...queryResult({ symbol: 'VNM', count: 0, data: [] }),
    refetch: refetchNews,
  })
  mockUseDividends.mockImplementation(() => {
    if (failedSection === 'dividend' && !dividendsRecovered) {
      return queryResult<DividendsResponse>({ data: [] }, {
        error: terminalError,
        refetch: refetchDividends,
      })
    }
    return queryResult<DividendsResponse>({
      data: failedSection === 'dividend' ? [{ cash_dividend: 1000, dividend_type: 'cash' }] : [],
    }, { refetch: refetchDividends })
  })
  mockUseInsiderDeals.mockImplementation(() => {
    if (failedSection === 'insider' && !insiderRecovered) {
      return queryResult([], {
        error: terminalError,
        refetch: refetchInsider,
      })
    }
    const recoveredInsiderDeals: InsiderTrade[] = failedSection === 'insider' ? [{
      id: 7,
      symbol: 'VNM',
      deal_action: 'BUY',
      deal_price: 1000,
      deal_quantity: 100,
      deal_value: 100000,
      price_unit: 'VND',
      value_unit: 'VND',
      insider_name: 'Nguyen Van A',
      insider_position: 'Director',
      announce_date: '2025-01-15',
    }] : []
    return queryResult(recoveredInsiderDeals, { refetch: refetchInsider })
  })

  const { rerender } = render(<NewsCorporateActionsWidget id="news-corporate-actions" symbol="VNM" />)
  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
  rerender(<NewsCorporateActionsWidget id="news-corporate-actions" symbol="VNM" />)

  expect(screen.getByText(failedSection === 'dividend' ? 'VND1,000' : 'Nguyen Van A')).toBeInTheDocument()
  expect(refetchNews).toHaveBeenCalledTimes(1)
  expect(refetchDividends).toHaveBeenCalledTimes(1)
  expect(refetchInsider).toHaveBeenCalledTimes(1)
})
