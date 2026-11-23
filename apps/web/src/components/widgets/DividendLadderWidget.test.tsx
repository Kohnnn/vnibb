import type { UseQueryResult } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { render, screen } from '@testing-library/react'

import type { DividendsResponse } from '@/lib/api'
import { useDividends } from '@/lib/queries'
import type { WidgetDataPayload } from '@/lib/widgetRuntime'
import { DividendLadderWidget } from './DividendLadderWidget'
import { cashTerms, qualifiedDividendHistory, stockTerms } from './__fixtures__/dividendHistory'

jest.mock('@/lib/queries', () => ({ useDividends: jest.fn() }))

const mockUseDividends = jest.mocked(useDividends)

function mockDividends(data: DividendsResponse | undefined, error: Error | null = null) {
  mockUseDividends.mockReturnValue({
    data,
    isLoading: !data && !error,
    error,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as unknown as UseQueryResult<DividendsResponse, Error>)
}

test('publishes bounded runtime updates through cold, error, empty, and changed dividend data', () => {
  const publications: WidgetDataPayload[] = []

  function Parent() {
    const [runtime, setRuntime] = useState<WidgetDataPayload | null>(null)
    const handleDataChange = useCallback((next: WidgetDataPayload) => {
      publications.push(next)
      if (publications.length > 8) throw new Error('Dividend runtime publication loop')
      setRuntime(next)
    }, [])

    return (
      <>
        <DividendLadderWidget id="dividend-ladder" symbol="FPT" onDataChange={handleDataChange} />
        <output data-testid="runtime-events">{String(runtime?.events ?? -1)}</output>
      </>
    )
  }

  mockDividends(undefined)
  const { rerender } = render(<Parent />)
  expect(publications).toHaveLength(1)
  expect(publications[0]).toMatchObject({ __widgetRuntime: { layoutHint: { empty: true } }, events: 0 })
  expect(screen.getByText('Dividend Ladder')).toBeInTheDocument()
  expect(screen.getByTestId('runtime-events')).toHaveTextContent('0')

  mockDividends(undefined, new Error('Network unavailable'))
  rerender(<Parent />)
  expect(publications).toHaveLength(2)
  expect(screen.getByText('Network unavailable')).toBeInTheDocument()
  rerender(<Parent />)
  expect(publications).toHaveLength(2)

  mockDividends(qualifiedDividendHistory([]))
  rerender(<Parent />)
  expect(publications).toHaveLength(3)
  expect(screen.getByText('No dividend events available yet')).toBeInTheDocument()
  rerender(<Parent />)
  expect(publications).toHaveLength(3)

  mockDividends(qualifiedDividendHistory([{
    ...cashTerms, ex_date: '2099-01-01', payment_date: '2099-01-03', cash_dividend: 1000, dividend_type: 'cash',
  }]))
  rerender(<Parent />)
  expect(publications).toHaveLength(4)
  expect(publications[3]).toMatchObject({ events: 2 })
  expect(screen.getByText('Dividend Ladder')).toBeInTheDocument()
  expect(screen.getByText('Ex-Date')).toBeInTheDocument()
  expect(screen.getByText('Payment')).toBeInTheDocument()
  expect(screen.getAllByText('Cash · Retained observation')).toHaveLength(2)
  expect(screen.getByTestId('runtime-events')).toHaveTextContent('2')
  rerender(<Parent />)
  expect(publications).toHaveLength(4)

  mockDividends(qualifiedDividendHistory([{
    ...stockTerms, record_date: '2099-02-01', stock_dividend: 10, dividend_type: 'stock',
  }]))
  rerender(<Parent />)
  expect(publications).toHaveLength(5)
  expect(publications[4]).toMatchObject({ events: 1 })
  expect(screen.queryByText('Ex-Date')).not.toBeInTheDocument()
  expect(screen.getByText('Record Date')).toBeInTheDocument()
  expect(screen.getByText('Stock · Retained observation')).toBeInTheDocument()
  expect(screen.getByTestId('runtime-events')).toHaveTextContent('1')
  rerender(<Parent />)
  expect(publications).toHaveLength(5)
})

test('uses typed action dates and keeps a qualified cash observation separate from yield', () => {
  const onDataChange = jest.fn()
  mockDividends(qualifiedDividendHistory([{
    ...cashTerms, fiscal_year: 2025, type: 'cash', cash_dividend: 500,
    published_at: '2026-05-04', record_date: '2026-05-12', payment_date: '2026-06-03',
    observation_basis: 'verified_event', status: 'announced',
  }], { latest_covered_date: '2026-06-03', latest_covered_date_type: 'payment_date' }))

  render(<DividendLadderWidget id="dividend-ladder" symbol="HPG" onDataChange={onDataChange} />)

  expect(screen.getAllByText('VND500/share')).toHaveLength(2)
  expect(screen.getByText('Payment')).toBeInTheDocument()
  expect(screen.getByText('Record Date')).toBeInTheDocument()
  expect(screen.queryByText('Ex-Date')).not.toBeInTheDocument()
  expect(screen.getByText(/Annual DPS and yield unavailable/)).toBeInTheDocument()
  expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
    __widgetRuntime: expect.objectContaining({ exportData: expect.objectContaining({
      dividend_coverage: expect.objectContaining({ payout_window_certified: false }),
      dividends: expect.arrayContaining([
        expect.objectContaining({ action_day: '2026-06-03', published_at: '2026-05-04' }),
        expect.objectContaining({ action_day: '2026-05-12', cash_unit: 'VND/share' }),
      ]),
    }) }),
  }))
})

test.each([
  [0, 'stock', '10% stock'],
  [1000, 'mixed', 'VND1,000/share + 10% stock'],
] as const)('renders reported stock payout with %s cash (%s)', (cashDividend, type, payout) => {
  mockDividends(qualifiedDividendHistory([{
    ...cashTerms, ...stockTerms, ex_date: '2099-01-01', cash_dividend: cashDividend, stock_dividend: 10, type,
  }]))

  render(<DividendLadderWidget id="dividend-ladder" symbol="VNM" />)

  expect(screen.getByText(payout)).toBeInTheDocument()
  expect(screen.queryByText('VND0/share')).not.toBeInTheDocument()
})
