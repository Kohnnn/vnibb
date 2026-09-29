import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBlockTrades, useScreenerData, useSymbolsByGroup } from '@/lib/queries'
import { widgetRegistry } from './WidgetRegistry'

const setGlobalSymbol = jest.fn()
const setGroupSymbol = jest.fn()
let detached = false
let persistedOverride = false

jest.mock('@/lib/queries', () => ({
  useBlockTrades: jest.fn(),
  useScreenerData: jest.fn(),
  useSymbolsByGroup: jest.fn(),
}))
jest.mock('@/contexts/SymbolLinkContext', () => ({
  useSymbolLink: () => ({ setGlobalSymbol }),
}))
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({ setGroupSymbol, tickerOverrideFor: () => detached ? 'FPT' : null }),
}))
jest.mock('@/hooks/useDashboardWidget', () => ({
  useDashboardWidget: () => ({ widget: { config: persistedOverride ? { tickerScope: 'override', symbol: 'FPT' } : {} } }),
}))
jest.mock('./QuantRunHistoryPanel', () => ({ QuantRunHistoryPanel: () => null }))

const cases = [
  ['big_flow_monitor', 'Big Flow'],
  ['signal_robustness_lab', 'Signal Robustness'],
] as const

function showRegisteredWidget(type: typeof cases[number][0], group: 'global' | 'A' = 'A', onSymbolClick?: (symbol: string) => void) {
  const Widget = widgetRegistry.get(type)!.component
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['transactionFlow', 'VCB', 5], { data: { data: [{ date: '2025-06-01', foreign_net_value: 1 }] } })
  return render(
    <QueryClientProvider client={client}>
      <React.Suspense fallback={<span>Loading widget</span>}>
        <Widget id={`saved-${type}`} symbol="FPT" widgetGroup={group} onSymbolClick={onSymbolClick} />
      </React.Suspense>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  detached = false
  persistedOverride = false
  setGlobalSymbol.mockClear()
  setGroupSymbol.mockClear()
  jest.mocked(useBlockTrades).mockReturnValue({
    data: [{ id: 1, symbol: 'VCB', value: 20e9, side: 'BUY', price: 80000, trade_time: '2025-06-01' }],
    isLoading: false, error: null, isFetching: false, refetch: jest.fn(), dataUpdatedAt: 0,
  } as never)
  jest.mocked(useSymbolsByGroup).mockReturnValue({
    data: { data: [{ symbol: 'VCB' }] }, isLoading: false, error: null, refetch: jest.fn(),
  } as never)
  jest.mocked(useScreenerData).mockReturnValue({
    data: { data: [{ ticker: 'VCB', pe: 10, perf_1m: 2 }], meta: {} },
    isLoading: false, error: null, isFetching: false, refetch: jest.fn(),
  } as never)
})

describe.each(cases)('%s registered dashboard ticker', (type) => {
  it('links a row click only within its assigned group when no callback is passed', async () => {
    showRegisteredWidget(type)
    fireEvent.click(await screen.findByRole('button', { name: 'VCB' }))
    expect(setGroupSymbol).toHaveBeenCalledWith('A', 'VCB')
    expect(setGlobalSymbol).not.toHaveBeenCalled()
  })

  it('updates the global ticker when assigned to the global group', async () => {
    showRegisteredWidget(type, 'global')
    fireEvent.click(await screen.findByRole('button', { name: 'VCB' }))
    expect(setGlobalSymbol).toHaveBeenCalledWith('VCB')
    expect(setGroupSymbol).toHaveBeenCalledWith('global', 'VCB')
  })

  it('does not expose an unusable ticker control for a detached widget', async () => {
    persistedOverride = true
    showRegisteredWidget(type)
    expect(await screen.findByText('VCB')).toHaveAttribute('title', expect.stringContaining('Ticker local'))
    expect(screen.queryByRole('button', { name: 'VCB' })).not.toBeInTheDocument()
    expect(setGroupSymbol).not.toHaveBeenCalled()
    expect(setGlobalSymbol).not.toHaveBeenCalled()
  })

  it('honors a supplied widget-only callback for a detached widget', async () => {
    detached = true
    const onSymbolClick = jest.fn()
    showRegisteredWidget(type, 'A', onSymbolClick)
    fireEvent.click(await screen.findByRole('button', { name: 'VCB' }))
    expect(onSymbolClick).toHaveBeenCalledWith('VCB')
    expect(setGroupSymbol).not.toHaveBeenCalled()
    expect(setGlobalSymbol).not.toHaveBeenCalled()
  })

  it('does not link an in-memory detached ticker into its group', async () => {
    detached = true
    showRegisteredWidget(type)
    expect(await screen.findByText('VCB')).toHaveAttribute('title', expect.stringContaining('Ticker local'))
    expect(screen.queryByRole('button', { name: 'VCB' })).not.toBeInTheDocument()
    expect(setGroupSymbol).not.toHaveBeenCalled()
    expect(setGlobalSymbol).not.toHaveBeenCalled()
  })
})
