import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { compareStocks, getComparisonPerformance, getFinancialRatios, getPeerCompanies } from '@/lib/api'
import { EMPTY_VALUE } from '@/lib/units'
import { ComparisonAnalysisWidget } from './ComparisonAnalysisWidget'

jest.mock('@/lib/api', () => ({
  compareStocks: jest.fn(),
  getComparisonPerformance: jest.fn(),
  getFinancialRatios: jest.fn(),
  getPeerCompanies: jest.fn(),
}))

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@/components/ui/CompanyLogo', () => ({ CompanyLogo: () => null }))
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }))
jest.mock('@/components/ui/Sparkline', () => ({ Sparkline: () => null }))

const mockCompareStocks = compareStocks as jest.Mock
const mockGetFinancialRatios = getFinancialRatios as jest.Mock
const mockGetComparisonPerformance = getComparisonPerformance as jest.Mock
const mockGetPeerCompanies = getPeerCompanies as jest.Mock

function renderComparison() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ComparisonAnalysisWidget id="comparison-1" initialSymbols={['MSR', 'VNM']} />
    </QueryClientProvider>
  )
}

function mockCanonicalData(roe: number | null) {
  mockCompareStocks.mockResolvedValue({
    metrics: [
      { id: 'pe_ratio', name: 'P/E', format: 'ratio' },
      { id: 'roe', name: 'ROE', format: 'percent' },
      { id: 'debt_equity', name: 'D/E', format: 'ratio' },
    ],
    stocks: [
      { symbol: 'MSR', metrics: { pe_ratio: 12.5, roe, debt_equity: 0.25 } },
      { symbol: 'VNM', metrics: { pe_ratio: 15, roe: 25, debt_equity: 2 } },
    ],
  })
  mockGetFinancialRatios.mockImplementation(async (symbol: string) => ({
    data: [{ symbol, pe: symbol === 'MSR' ? 12.5 : 15, roe: symbol === 'MSR' ? roe : 25, debt_equity: symbol === 'MSR' ? 0.25 : 2 }],
  }))
}

async function expectBothRows(label: string, expectedCells: string[]) {
  await waitFor(() => {
    const rows = screen.getAllByText(label).map((cell) => cell.closest('tr') as HTMLElement)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(expectedCells)
    }
  })
}

describe('ComparisonAnalysisWidget canonical percent basis (issue #106)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetComparisonPerformance.mockResolvedValue([])
    mockGetPeerCompanies.mockResolvedValue({ peers: [] })
  })

  test.each([
    [0.25, '0.25%'],
    [0, '0.00%'],
    [-0.25, '-0.25%'],
    [25, '25.00%'],
    [null, EMPTY_VALUE],
  ])('renders canonical ROE %s without rescaling in both grids', async (value, expected) => {
    mockCanonicalData(value as number | null)
    renderComparison()

    fireEvent.click(screen.getByRole('button', { name: 'Profitability' }))

    await expectBothRows('ROE', ['ROE', expected as string, '25.00%'])
  })

  test('keeps P/E and debt-to-equity values as ratios in both grids', async () => {
    mockCanonicalData(0.25)
    renderComparison()

    await expectBothRows('P/E', ['P/E', '12.50', '15.00'])
    fireEvent.click(screen.getByRole('button', { name: 'Leverage' }))
    await expectBothRows('D/E', ['D/E', '0.25', '2.00'])
  })
})

describe('ComparisonAnalysisWidget primary ticker synchronization', () => {
  test('replaces the primary on a same-id symbol change without resetting manual peers or controls', async () => {
    jest.clearAllMocks()
    mockGetPeerCompanies.mockResolvedValue({ peers: [] })
    mockGetComparisonPerformance.mockResolvedValue([])
    const roeBySymbol: Record<string, number> = { MSR: 11, VNM: 22, TCB: 33, VCI: 44 }
    mockCompareStocks.mockImplementation(async (symbols: string[], period: string) => ({
      metrics: [
        { id: 'pe_ratio', name: 'P/E', format: 'ratio' },
        { id: 'roe', name: 'ROE', format: 'percent' },
      ],
      stocks: symbols.map((symbol) => ({
        symbol,
        metrics: { pe_ratio: 10, roe: period === 'Q2' ? roeBySymbol[symbol] : 1 },
      })),
    }))
    mockGetFinancialRatios.mockImplementation(async (symbol: string, { period }: { period: string }) => ({
      data: [{ symbol, pe: 10, roe: period === 'Q2' ? roeBySymbol[symbol] : 1 }],
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ComparisonAnalysisWidget id="comparison-1" symbol="MSR" initialSymbols={[]} />
      </QueryClientProvider>
    )

    for (const ticker of ['VNM', 'TCB']) {
      fireEvent.change(screen.getByRole('textbox', { name: 'Add ticker' }), { target: { value: ticker } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm add ticker' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Profitability' }))
    fireEvent.click(screen.getByRole('button', { name: 'Q2' }))
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    await expectBothRows('ROE', ['ROE', '11.00%', '22.00%', '33.00%'])

    rerender(
      <QueryClientProvider client={client}>
        <ComparisonAnalysisWidget id="comparison-1" symbol="VCI" initialSymbols={[]} />
      </QueryClientProvider>
    )

    await waitFor(() => {
      const tables = screen.getAllByRole('table')
      expect(tables).toHaveLength(2)
      for (const table of tables) {
        expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
          'Metric', 'VCI', 'VNM', 'TCB',
        ])
      }
    })
    await expectBothRows('ROE', ['ROE', '44.00%', '22.00%', '33.00%'])
    expect(screen.queryByText('MSR')).not.toBeInTheDocument()
    expect(screen.queryByText('P/E')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Q2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Period: Q2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3M' })).toHaveClass('bg-blue-600')
  })

  test('promotes an existing peer without duplicates and preserves peers for equivalent normalized symbols', async () => {
    jest.clearAllMocks()
    mockGetPeerCompanies.mockResolvedValue({ peers: [] })
    mockGetComparisonPerformance.mockResolvedValue([])
    const peBySymbol: Record<string, number> = { MSR: 11, VCI: 22, VNM: 33 }
    mockCompareStocks.mockImplementation(async (symbols: string[]) => ({
      metrics: [{ id: 'pe_ratio', name: 'P/E', format: 'ratio' }],
      stocks: symbols.map((symbol) => ({ symbol, metrics: { pe_ratio: peBySymbol[symbol] } })),
    }))
    mockGetFinancialRatios.mockImplementation(async (symbol: string) => ({
      data: [{ symbol, pe: peBySymbol[symbol] }],
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ComparisonAnalysisWidget id="comparison-1" symbol="MSR" initialSymbols={[]} />
      </QueryClientProvider>
    )
    for (const ticker of ['VCI', 'VNM']) {
      fireEvent.change(screen.getByRole('textbox', { name: 'Add ticker' }), { target: { value: ticker } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm add ticker' }))
    }
    await expectBothRows('P/E', ['P/E', '11.00', '22.00', '33.00'])

    for (const { symbol, headers, cells } of [
      { symbol: ' msr ', headers: ['Metric', 'MSR', 'VCI', 'VNM'], cells: ['P/E', '11.00', '22.00', '33.00'] },
      { symbol: 'VCI', headers: ['Metric', 'VCI', 'VNM'], cells: ['P/E', '22.00', '33.00'] },
    ]) {
      rerender(
        <QueryClientProvider client={client}>
          <ComparisonAnalysisWidget id="comparison-1" symbol={symbol} initialSymbols={[]} />
        </QueryClientProvider>
      )
      await waitFor(() => {
        const tables = screen.getAllByRole('table')
        expect(tables).toHaveLength(2)
        for (const table of tables) {
          expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(headers)
        }
      })
      await expectBothRows('P/E', cells)
    }
    expect(screen.queryByText('MSR')).not.toBeInTheDocument()
  })

  test('keeps a manually selected fallback peer when the new primary returns sector peers', async () => {
    jest.clearAllMocks()
    mockGetPeerCompanies.mockImplementation(async (symbol: string) => ({
      peers: symbol === 'VCI' ? [{ symbol: 'VIX' }] : [],
    }))
    mockGetComparisonPerformance.mockResolvedValue([])
    const peBySymbol: Record<string, number> = { MSR: 11, VCI: 22, FPT: 33, VIX: 44 }
    mockCompareStocks.mockImplementation(async (symbols: string[]) => ({
      metrics: [{ id: 'pe_ratio', name: 'P/E', format: 'ratio' }],
      stocks: symbols.map((symbol) => ({ symbol, metrics: { pe_ratio: peBySymbol[symbol] } })),
    }))
    mockGetFinancialRatios.mockImplementation(async (symbol: string) => ({
      data: [{ symbol, pe: peBySymbol[symbol] }],
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ComparisonAnalysisWidget id="comparison-1" symbol="MSR" initialSymbols={[]} />
      </QueryClientProvider>
    )
    for (const ticker of ['VCI', 'FPT']) {
      fireEvent.change(screen.getByRole('textbox', { name: 'Add ticker' }), { target: { value: ticker } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm add ticker' }))
    }
    await expectBothRows('P/E', ['P/E', '11.00', '22.00', '33.00'])

    rerender(
      <QueryClientProvider client={client}>
        <ComparisonAnalysisWidget id="comparison-1" symbol="VCI" initialSymbols={[]} />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('button', { name: '+ VIX' })).toBeInTheDocument()
    await expectBothRows('P/E', ['P/E', '22.00', '33.00'])
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(2)
    for (const table of tables) {
      expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
        'Metric', 'VCI', 'FPT',
      ])
    }
    expect(screen.queryByText('MSR')).not.toBeInTheDocument()
  })

  test('still replaces an untouched startup fallback with backend sector peers', async () => {
    jest.clearAllMocks()
    mockGetPeerCompanies.mockResolvedValue({ peers: [{ symbol: 'VIX' }] })
    mockGetComparisonPerformance.mockResolvedValue([])
    const peBySymbol: Record<string, number> = { VCI: 22, FPT: 33, VIX: 44 }
    mockCompareStocks.mockImplementation(async (symbols: string[]) => ({
      metrics: [{ id: 'pe_ratio', name: 'P/E', format: 'ratio' }],
      stocks: symbols.map((symbol) => ({ symbol, metrics: { pe_ratio: peBySymbol[symbol] } })),
    }))
    mockGetFinancialRatios.mockImplementation(async (symbol: string) => ({
      data: [{ symbol, pe: peBySymbol[symbol] }],
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ComparisonAnalysisWidget id="comparison-1" symbol="VCI" initialSymbols={['FPT']} />
      </QueryClientProvider>
    )

    await waitFor(() => {
      const tables = screen.getAllByRole('table')
      expect(tables).toHaveLength(2)
      for (const table of tables) {
        expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
          'Metric', 'VCI', 'VIX',
        ])
      }
    })
    await expectBothRows('P/E', ['P/E', '22.00', '44.00'])
    expect(screen.queryByText('FPT')).not.toBeInTheDocument()
  })
})
