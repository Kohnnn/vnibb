import type { UseQueryResult } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { render, screen } from '@testing-library/react'

import type { DividendsResponse } from '@/lib/api'
import { useDividends } from '@/lib/queries'
import type { WidgetDataPayload } from '@/lib/widgetRuntime'
import { DividendLadderWidget } from './DividendLadderWidget'

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

  mockDividends({ data: [] })
  rerender(<Parent />)
  expect(publications).toHaveLength(3)
  expect(screen.getByText('No dividend events available yet')).toBeInTheDocument()
  rerender(<Parent />)
  expect(publications).toHaveLength(3)

  mockDividends({ data: [{ ex_date: '2099-01-01', payment_date: '2099-01-03', cash_dividend: 1000, dividend_type: 'cash' }] })
  rerender(<Parent />)
  expect(publications).toHaveLength(4)
  expect(publications[3]).toMatchObject({ events: 2 })
  expect(screen.getByText('Dividend Ladder')).toBeInTheDocument()
  expect(screen.getByText('Ex-Date')).toBeInTheDocument()
  expect(screen.getByText('Payment')).toBeInTheDocument()
  expect(screen.getAllByText('Cash')).toHaveLength(2)
  expect(screen.getByTestId('runtime-events')).toHaveTextContent('2')
  rerender(<Parent />)
  expect(publications).toHaveLength(4)

  mockDividends({ data: [{ record_date: '2099-02-01', stock_dividend: 10, dividend_type: 'stock' }] })
  rerender(<Parent />)
  expect(publications).toHaveLength(5)
  expect(publications[4]).toMatchObject({ events: 1 })
  expect(screen.queryByText('Ex-Date')).not.toBeInTheDocument()
  expect(screen.getByText('Record Date')).toBeInTheDocument()
  expect(screen.getByText('Stock')).toBeInTheDocument()
  expect(screen.getByTestId('runtime-events')).toHaveTextContent('1')
  rerender(<Parent />)
  expect(publications).toHaveLength(5)
})
