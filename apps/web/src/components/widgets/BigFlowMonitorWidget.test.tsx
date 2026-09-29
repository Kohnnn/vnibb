import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { widgetRegistry } from './WidgetRegistry'
import { useBlockTrades } from '@/lib/queries'

jest.mock('@/lib/queries', () => ({ useBlockTrades: jest.fn() }))
jest.mock('@/hooks/useWidgetSymbolLink', () => ({ useWidgetSymbolLink: () => ({ setLinkedSymbol: jest.fn() }) }))
jest.mock('@/hooks/useDashboardWidget', () => ({ useDashboardWidget: () => null }))
jest.mock('@/contexts/WidgetGroupContext', () => ({ useWidgetGroups: () => ({ tickerOverrideFor: () => null }) }))

const BigFlow = widgetRegistry.get('big_flow_monitor')!.component
const refetch = jest.fn()
const onDataChange = jest.fn()

async function showBigFlow(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <React.Suspense fallback={<span>Loading widget</span>}>
        <BigFlow id="saved-big-flow" symbol="FPT" onDataChange={onDataChange} />
      </React.Suspense>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  refetch.mockClear()
  onDataChange.mockClear()
})

describe('big_flow_monitor provider outcome', () => {
  it('reports the provider failure instead of rendering a fabricated empty tape', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Block-trade data unavailable'),
      isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(await screen.findByText('Block-trade data unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/prints ≥/)).not.toBeInTheDocument()
    expect(onDataChange).not.toHaveBeenCalled()
  })

  it('renders a legitimate empty tape as received prints, not a failure', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [], isLoading: false, error: null, isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(await screen.findByText('0 prints ≥ 10B')).toBeInTheDocument()
    expect(screen.getByText('No block trades above this threshold')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps already received trades visible while naming the failed refresh', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [{ id: 1, symbol: 'VCB', side: 'BUY', value: 20e9, quantity: 1000, price: 80000, trade_time: '2025-06-01', is_foreign: false, is_proprietary: false }],
      isLoading: false, error: new Error('Block-trade data unavailable'), isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(screen.getByRole('alert')).toHaveTextContent('Latest block-trade tape unavailable')
    expect(await screen.findByText('VCB')).toBeInTheDocument()
    expect(onDataChange).not.toHaveBeenCalled()
  })
})
