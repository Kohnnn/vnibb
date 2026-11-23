import type { UseQueryResult } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'

import type { InsiderTrade } from '@/types/insider'
import type { DividendsResponse } from '@/lib/api'
import type { CompanyNewsResponse } from '@/types/equity'
import { useCompanyNews, useDividends, useInsiderDeals } from '@/lib/queries'
import { NewsCorporateActionsWidget } from './NewsCorporateActionsWidget'
import { cashTerms, qualifiedDividendHistory, stockTerms } from './__fixtures__/dividendHistory'

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

test('shows the HPG coverage gap instead of implying a current yield from an old record', () => {
  mockUseCompanyNews.mockReturnValue(queryResult({ symbol: 'HPG', count: 0, data: [] }))
  mockUseInsiderDeals.mockReturnValue(queryResult([]))
  mockUseDividends.mockReturnValue(queryResult(qualifiedDividendHistory([{
    ...cashTerms, cash_dividend: 500, dividend_type: 'cash', observation_basis: 'retained_dividend_record',
    ex_date: '2022-06-17', payment_date: '2022-07-06',
  }], {
    latest_covered_date: '2022-07-06', latest_covered_date_type: 'payment_date', discrepancy_count: 1,
    discrepancies: [{
      code: 'unverified_event', dataset: 'company_events', observation_id: 10,
      observed_date: '2026-05-11', observed_date_type: 'ex_date', distribution_type: 'cash', fiscal_year: 2025,
    }],
  })))

  render(<NewsCorporateActionsWidget id="news-corporate-actions" symbol="HPG" />)

  expect(screen.getByText('Corporate Actions')).toBeInTheDocument()
  expect(screen.getByText('VND500/share')).toBeInTheDocument()
  expect(screen.getByText('Partial dividend coverage. Latest covered payment date: 2022-07-06.')).toBeInTheDocument()
  const summary = screen.getByText('1 dividend discrepancy')
  expect(summary.closest('details')).not.toHaveAttribute('open')
  expect(summary).toBeInTheDocument()
  expect(screen.getByText('Reported ex date 2026-05-11: Calendar cash (FY 2025) — event not verified.')).toBeInTheDocument()
  expect(screen.getByText(/Annual DPS and yield unavailable/)).toBeInTheDocument()
  expect(screen.queryByText(/2\.35%/)).not.toBeInTheDocument()
})

test.each([
  [0, 'stock', '10% stock'],
  [1000, 'mixed', 'VND1,000/share + 10% stock'],
] as const)('renders reported stock payout with %s cash (%s)', (cashDividend, type, payout) => {
  mockUseCompanyNews.mockReturnValue(queryResult({ symbol: 'VNM', count: 0, data: [] }))
  mockUseInsiderDeals.mockReturnValue(queryResult([]))
  mockUseDividends.mockReturnValue(queryResult(qualifiedDividendHistory([
    { ...cashTerms, ...stockTerms, cash_dividend: cashDividend, stock_dividend: 10, type },
  ])))

  render(<NewsCorporateActionsWidget id="news-corporate-actions" symbol="VNM" />)

  expect(screen.getByText(payout)).toBeInTheDocument()
  expect(screen.queryByText('VND0/share')).not.toBeInTheDocument()
})

test('shows no ranking number for a sector overlap but keeps direct-company rank', () => {
  mockUseCompanyNews.mockReturnValue(queryResult<CompanyNewsResponse>({
    symbol: 'HPG',
    count: 2,
    data: [
      {
        symbol: 'HPG',
        title: 'Giá thép xây dựng tăng trong quý này',
        source: 'cafef',
        match_reason: 'sector_keyword',
        association_class: 'verified_sector',
        relevance_score: null,
      },
      {
        symbol: 'HPG',
        title: 'HPG công bố kết quả kinh doanh',
        source: 'cafef',
        match_reason: 'exact_symbol_title',
        association_class: 'direct_company',
        relevance_score: 1,
      },
    ],
  }))
  mockUseInsiderDeals.mockReturnValue(queryResult([]))
  mockUseDividends.mockReturnValue(queryResult<DividendsResponse>({ data: [] }))

  render(<NewsCorporateActionsWidget id="news-corporate-actions" symbol="HPG" />)

  expect(screen.getByText('industry overlap · no company evidence')).toBeInTheDocument()
  expect(screen.getByText(/exact symbol title · rank 100\/100/)).toBeInTheDocument()
  expect(screen.queryByText(/industry overlap · no company evidence · rank/)).not.toBeInTheDocument()
})

test('states where a news sentiment label came from instead of implying impact', () => {
  mockUseCompanyNews.mockReturnValue(queryResult<CompanyNewsResponse>({
    symbol: 'HPG',
    count: 3,
    data: [
      { symbol: 'HPG', title: 'HPG local estimate', source: 'cafef', sentiment: 'bullish', sentiment_score: 0, sentiment_source: 'heuristic' },
      { symbol: 'HPG', title: 'HPG provider class', source: 'issuer', sentiment: 'positive', sentiment_source: 'provider' },
      { symbol: 'HPG', title: 'HPG no label', source: 'cafef', sentiment_source: 'unavailable' },
    ],
  }))
  mockUseInsiderDeals.mockReturnValue(queryResult([]))
  mockUseDividends.mockReturnValue(queryResult<DividendsResponse>({ data: [] }))

  render(<NewsCorporateActionsWidget id="news-corporate-actions" symbol="HPG" />)

  const heuristicBadge = screen.getByLabelText(/Article sentiment: bullish \(heuristic\)/)
  // A reported zero confidence survives; it is not treated as absent.
  expect(heuristicBadge).toHaveTextContent(/bullish 0/)
  expect(screen.getByLabelText(/Article sentiment: positive \(provider\)/)).toBeInTheDocument()
  // No recorded label: no direction word, never a fabricated "neutral".
  expect(screen.getByText('Sentiment unavailable')).toBeInTheDocument()
  expect(screen.queryByText(/stock impact/i)).not.toBeInTheDocument()
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
    return queryResult(qualifiedDividendHistory(failedSection === 'dividend'
      ? [{ ...cashTerms, cash_dividend: 1000, dividend_type: 'cash' }] : [],
    ), { refetch: refetchDividends })
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

  expect(screen.getByText(failedSection === 'dividend' ? 'VND1,000/share' : 'Nguyen Van A')).toBeInTheDocument()
  expect(refetchNews).toHaveBeenCalledTimes(1)
  expect(refetchDividends).toHaveBeenCalledTimes(1)
  expect(refetchInsider).toHaveBeenCalledTimes(1)
})
