import { render, screen } from '@testing-library/react'

import { useHistoricalPrices } from '@/lib/queries'
import { DrawdownDeepDiveWidget } from './DrawdownDeepDiveWidget'
import { HurstMarketStructureWidget } from './HurstMarketStructureWidget'
import { OBVDivergenceWidget } from './OBVDivergenceWidget'

jest.mock('@/lib/queries', () => ({
  useHistoricalPrices: jest.fn(),
}))

jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}))

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => null,
}))

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { readonly message: string }) => <div>{message}</div>,
  WidgetError: () => null,
}))

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}))

const mockUseHistoricalPrices = jest.mocked(useHistoricalPrices)

function mockEmptyHistory() {
  mockUseHistoricalPrices.mockReturnValue({
    data: { data: [] },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as unknown as ReturnType<typeof useHistoricalPrices>)
}

function mockPartiallyAdjustedHistory() {
  const data = Array.from({ length: 130 }, (_, index) => ({
    symbol: 'FPT',
    time: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000 + index,
  }))
  mockUseHistoricalPrices.mockReturnValue({
    data: {
      data,
      meta: {
        count: data.length,
        adjustment_mode: 'adjusted',
        adjustment_requested_count: data.length,
        adjustment_applied_count: data.length - 1,
        adjustment_coverage_pct: 99.23,
        adjustment_warning: 'Adjusted mode contains 1 raw row(s) (129/130 adjusted).',
      },
    },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as unknown as ReturnType<typeof useHistoricalPrices>)
}

describe('adjustment-aware historical widgets', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmptyHistory()
  })

  test('requests adjusted history for drawdown analysis', () => {
    render(<DrawdownDeepDiveWidget symbol="fpt" />)

    expect(mockUseHistoricalPrices).toHaveBeenCalledWith(
      'FPT',
      expect.objectContaining({ adjustmentMode: 'adjusted', enabled: true }),
    )
  })

  test('requests adjusted history for Hurst analysis', () => {
    render(<HurstMarketStructureWidget symbol="fpt" />)

    expect(mockUseHistoricalPrices).toHaveBeenCalledWith(
      'FPT',
      expect.objectContaining({ adjustmentMode: 'adjusted', enabled: true }),
    )
  })

  test('uses adjusted prices and observed volume for OBV analysis', () => {
    render(<OBVDivergenceWidget symbol="fpt" />)

    expect(mockUseHistoricalPrices).toHaveBeenCalledWith(
      'FPT',
      expect.objectContaining({ adjustmentMode: 'adjusted', enabled: true }),
    )
  })

  test.each([
    ['drawdown', <DrawdownDeepDiveWidget key="drawdown" symbol="fpt" />],
    ['Hurst', <HurstMarketStructureWidget key="hurst" symbol="fpt" />],
    ['OBV', <OBVDivergenceWidget key="obv" symbol="fpt" />],
  ])('surfaces partial adjustment coverage in %s analysis', (_name, widget) => {
    mockPartiallyAdjustedHistory()

    render(widget)

    expect(screen.getByText('Adjusted mode contains 1 raw row(s) (129/130 adjusted).')).toBeInTheDocument()
  })
})
