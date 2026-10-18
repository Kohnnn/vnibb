import type { UseQueryResult } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

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

function queryResult<T>(data: T): UseQueryResult<T, Error> {
  return {
    data,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
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
