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
