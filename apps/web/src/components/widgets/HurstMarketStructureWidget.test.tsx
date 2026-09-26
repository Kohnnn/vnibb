import { useCallback, useState } from 'react'
import { render, screen } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'

import { useHistoricalPrices } from '@/lib/queries'
import type { EquityHistoricalResponse } from '@/types/equity'
import type { WidgetDataPayload } from '@/lib/widgetRuntime'
import { HurstMarketStructureWidget } from './HurstMarketStructureWidget'

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn() }))
jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}))
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))

const mockUseHistoricalPrices = jest.mocked(useHistoricalPrices)

function history(count: number) {
  return {
    data: {
      data: Array.from({ length: count }, (_, index) => ({
        time: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
        open: 100 + index,
        high: 102 + index,
        low: 99 + index,
        close: 101 + index + Math.sin(index / 3),
        volume: 1_000,
      })),
    },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>
}

function readRuntime(): WidgetDataPayload {
  return JSON.parse(screen.getByTestId('parent-runtime').textContent || 'null') as WidgetDataPayload
}

describe('HurstMarketStructureWidget runtime publishing', () => {
  let publications: number

  function Parent({ symbol }: { symbol: string }) {
    const [payload, setPayload] = useState<WidgetDataPayload | null>(null)
    const handleDataChange = useCallback((next: WidgetDataPayload) => {
      publications += 1
      if (publications > 4) throw new Error('Hurst runtime publication loop')
      setPayload(next)
    }, [])

    return (
      <>
        <HurstMarketStructureWidget symbol={symbol} onDataChange={handleDataChange} />
        <output data-testid="parent-runtime">{JSON.stringify(payload)}</output>
      </>
    )
  }

  beforeEach(() => {
    publications = 0
    mockUseHistoricalPrices.mockReset()
  })

  it('publishes empty history once despite the parent state update and rerender', () => {
    mockUseHistoricalPrices.mockReturnValue(history(0))

    const { rerender } = render(<Parent symbol="FPT" />)
    expect((readRuntime().__widgetRuntime as { layoutHint: { empty: boolean } }).layoutHint.empty).toBe(true)
    expect(publications).toBe(1)

    rerender(<Parent symbol="FPT" />)
    expect(publications).toBe(1)
  })

  it('publishes loaded history without looping and updates provenance on a symbol change', () => {
    const fpt = history(130)
    const vcb = history(140)
    mockUseHistoricalPrices.mockImplementation((symbol) => symbol === 'FPT' ? fpt : vcb)

    const { rerender } = render(<Parent symbol="FPT" />)
    expect((readRuntime().__widgetRuntime as { layoutHint: { empty: boolean } }).layoutHint.empty).toBe(false)
    expect(readRuntime().candles).toBe(130)
    expect(publications).toBe(1)

    rerender(<Parent symbol="FPT" />)
    expect(publications).toBe(1)

    rerender(<Parent symbol="VCB" />)
    expect(readRuntime().candles).toBe(140)
    expect((readRuntime().__widgetRuntime as { provenance: { endpoint: string } }).provenance.endpoint).toContain('symbol=VCB')
    expect(publications).toBe(2)
  })
})
