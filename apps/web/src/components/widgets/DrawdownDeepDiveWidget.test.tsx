import type { UseQueryResult } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { render, screen } from '@testing-library/react'

import { useHistoricalPrices } from '@/lib/queries'
import type { EquityHistoricalResponse } from '@/types/equity'
import type { WidgetDataPayload } from '@/lib/widgetRuntime'
import { DrawdownDeepDiveWidget } from './DrawdownDeepDiveWidget'

jest.mock('@/lib/queries', () => ({
  useHistoricalPrices: jest.fn(),
}))

jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}))

const mockUseHistoricalPrices = jest.mocked(useHistoricalPrices)

// Canonical fixture: the widget certifies each row by its own `price_unit`
// marker, so the fixture states VND per row plus the matching response-level
// status (QA #98).
const candles = Array.from({ length: 35 }, (_, index) => ({
  time: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: index === 5 ? 80 : 100 + index,
  volume: 1_000,
  price_unit: 'VND',
})).reverse()

function mockHistory(rows: typeof candles) {
  mockUseHistoricalPrices.mockReturnValue({
    data: { data: rows, meta: { count: rows.length, unit_status: 'confirmed_vnd' } },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>)
}
test('publishes only changed runtime across empty and loaded parent rerenders', () => {
  const onUpdate = jest.fn()

  function Parent() {
    const [runtime, setRuntime] = useState<WidgetDataPayload | null>(null)
    const handleDataChange = useCallback((next: WidgetDataPayload) => {
      onUpdate(next)
      setRuntime(next)
    }, [])

    return (
      <>
        <output data-testid="runtime">{String(runtime?.points ?? 0)}</output>
        <DrawdownDeepDiveWidget symbol="FPT" onDataChange={handleDataChange} />
      </>
    )
  }

  mockHistory([])
  const { rerender } = render(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('runtime')).toHaveTextContent('0')

  mockHistory(candles)
  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(2)
  expect(screen.getByTestId('runtime')).toHaveTextContent('35')
  expect(onUpdate.mock.lastCall?.[0]).toMatchObject({
    __widgetRuntime: { layoutHint: { empty: false } },
    points: 35,
    episodes: 1,
  })

  mockHistory([...candles])
  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(2)

  mockHistory([])
  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(3)
  expect(onUpdate.mock.lastCall?.[0]).toMatchObject({
    __widgetRuntime: { layoutHint: { empty: true } },
    points: 0,
  })

  mockHistory([])
  rerender(<Parent />)
  expect(onUpdate).toHaveBeenCalledTimes(3)
})
