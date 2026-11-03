import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  // Brand §22: a pending first request must not present 0 as a measured total.
  it('shows no placeholder zeros while the first request is pending', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: undefined, isLoading: true, error: null, isFetching: true, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(await screen.findByText('Loading prints ≥ 10B…')).toBeInTheDocument()
    for (const label of ['Buy', 'Sell', 'Net']) {
      const card = screen.getByText(label).parentElement!;
      expect(card.textContent).toContain('n/a');
      expect(card.textContent).not.toMatch(/\b0(\.0+)?B?\b/);
    }
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
  it('excludes trades whose value is unavailable from threshold, totals, and rows', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [
        { id: 1, symbol: 'VCB', side: 'BUY', value: undefined, quantity: 1000, price: 80000, trade_time: '2025-06-01', is_foreign: false, is_proprietary: false },
        { id: 2, symbol: 'FPT', side: 'SELL', value: 20e9, quantity: 1000, price: 80000, trade_time: '2025-06-02', is_foreign: false, is_proprietary: false },
      ],
      isLoading: false, error: null, isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    // The header states the coverage gap rather than implying the tape is complete.
    expect(await screen.findByText(/1 prints ≥ 10B · 1 without a reported value/)).toBeInTheDocument()
    expect(screen.queryByText('VCB')).not.toBeInTheDocument()
    // Total and row both show the surviving value.
    expect(screen.getAllByText('20.0B').length).toBeGreaterThan(0)
    // No fabricated n/a row is rendered for the excluded trade.
    expect(screen.queryByText('n/a')).not.toBeInTheDocument()
  })

  it('does not claim an empty tape when every scoped print lacks a finite value', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [
        { id: 1, symbol: 'VCB', side: 'BUY', value: undefined, quantity: 1000, price: 80000, trade_time: '2025-06-01', is_foreign: false, is_proprietary: false },
      ],
      isLoading: false, error: null, isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(await screen.findByText(/No classified block trades/)).toBeInTheDocument()
    expect(screen.queryByText('No block trades above this threshold')).not.toBeInTheDocument()
  })

  it('keeps known below-threshold trades separate from unclassified trades', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [
        { id: 1, symbol: 'VCB', side: 'BUY', value: 5e9, price: 0, trade_time: '2025-06-01', is_foreign: false, is_proprietary: false },
        { id: 2, symbol: 'FPT', side: 'SELL', value: Number.NaN, price: null, trade_time: '2025-06-02', is_foreign: false, is_proprietary: false },
      ],
      isLoading: false, error: null, isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(await screen.findByText(/0 prints ≥ 10B · 1 without a reported value/)).toBeInTheDocument()
    expect(screen.getByText(/No classified block trades/)).toBeInTheDocument()
    expect(screen.queryByText(/No block trades above/)).not.toBeInTheDocument()
  })

  it('preserves zero prices as measured values', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [{ id: 1, symbol: 'VCB', side: 'BUY', value: 20e9, price: 0, trade_time: '2025-06-01', is_foreign: false, is_proprietary: false }],
      isLoading: false, error: null, isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(await screen.findByText('VCB')).toBeInTheDocument()
    expect(screen.getByText('0', { selector: 'td' })).toBeInTheDocument()
  })

  it('applies scope before counting unknown values', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [
        { id: 1, symbol: 'VCB', side: 'BUY', value: undefined, price: 0, trade_time: '2025-06-01', is_foreign: true, is_proprietary: false },
        { id: 2, symbol: 'FPT', side: 'SELL', value: undefined, price: null, trade_time: '2025-06-02', is_foreign: false, is_proprietary: false },
      ],
      isLoading: false, error: null, isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()
    fireEvent.click(screen.getByRole('button', { name: 'Foreign' }))
    expect(await screen.findByText(/No classified block trades/)).toBeInTheDocument()
    expect(screen.getByText(/1 print had no finite/)).toBeInTheDocument()
  })

  it('marks totals partial when a valued print has no usable side', async () => {
    // `BlockTrade.side` is nullable: a print can carry a reported value that
    // belongs to neither leg. Buy/Sell/Net must not read as exhaustive.
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [
        { id: 1, symbol: 'VCB', side: 'BUY', value: 20e9, price: 80000, trade_time: '2025-06-01', is_foreign: false, is_proprietary: false },
        { id: 2, symbol: 'FPT', side: null, value: 30e9, price: 80000, trade_time: '2025-06-02', is_foreign: false, is_proprietary: false },
      ],
      isLoading: false, error: null, isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(await screen.findByText('FPT')).toBeInTheDocument()
    expect(screen.getAllByText(/· partial$/)).toHaveLength(3)
    // The unclassifiable print is excluded from every leg rather than guessed.
    expect(screen.getAllByText('20.0B').length).toBeGreaterThan(0)
  })

  it('leaves totals unqualified when every valued print has a side', async () => {
    jest.mocked(useBlockTrades).mockReturnValue({
      data: [
        { id: 1, symbol: 'VCB', side: 'BUY', value: 20e9, price: 80000, trade_time: '2025-06-01', is_foreign: false, is_proprietary: false },
      ],
      isLoading: false, error: null, isFetching: false, refetch, dataUpdatedAt: 0,
    } as never)

    await showBigFlow()

    expect(await screen.findByText('VCB')).toBeInTheDocument()
    expect(screen.queryByText(/· partial/)).not.toBeInTheDocument()
  })
})
