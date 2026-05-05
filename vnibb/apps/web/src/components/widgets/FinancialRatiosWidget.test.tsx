import { render, screen } from '@testing-library/react'

import { FinancialRatiosWidget } from '@/components/widgets/FinancialRatiosWidget'
import { useFinancialRatios, useIncomeStatement } from '@/lib/queries'
import { usePeriodState } from '@/hooks/usePeriodState'

jest.mock('@/lib/queries', () => ({
  useFinancialRatios: jest.fn(),
  useIncomeStatement: jest.fn(),
}))

jest.mock('@/hooks/usePeriodState', () => ({
  usePeriodState: jest.fn(),
}))

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: any }) => <div>{children}</div>,
}))

jest.mock('@/components/ui/PeriodToggle', () => ({
  PeriodToggle: () => <div data-testid="period-toggle" />,
}))

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}))

jest.mock('@/components/ui/Sparkline', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}))

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}))

const mockUseFinancialRatios = useFinancialRatios as jest.MockedFunction<typeof useFinancialRatios>
const mockUseIncomeStatement = useIncomeStatement as jest.MockedFunction<typeof useIncomeStatement>
const mockUsePeriodState = usePeriodState as jest.MockedFunction<typeof usePeriodState>

describe('FinancialRatiosWidget', () => {
  beforeEach(() => {
    mockUseIncomeStatement.mockReturnValue({ data: { data: [] } } as any)
    mockUsePeriodState.mockReturnValue({ period: 'FY', setPeriod: jest.fn() } as any)
  })

  test('shows loading skeleton while fetching', () => {
    mockUseFinancialRatios.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)

    render(<FinancialRatiosWidget id="ratios" symbol="VNM" />)
    expect(screen.getByTestId('widget-skeleton')).toBeInTheDocument()
  })

  test('shows standardized error state when request fails', () => {
    mockUseFinancialRatios.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: new Error('NetworkError: fetch failed'),
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)

    render(<FinancialRatiosWidget id="ratios" symbol="VNM" />)
    expect(screen.getByText('Connection Failed')).toBeInTheDocument()
  })

  test('renders ratio values and formatted period headers', () => {
    mockUseFinancialRatios.mockReturnValue({
      data: {
        data: [
          { symbol: 'VNM', period: '2024', pe: 15, pb: 2.5, roe: 18.2, roa: 9.4 },
          { symbol: 'VNM', period: '2023', pe: 13.8, pb: 2.2, roe: 17.1, roa: 8.9 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)

    render(<FinancialRatiosWidget id="ratios" symbol="VNM" />)

    expect(screen.getByText('P/E')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('15.00')).toBeInTheDocument()
    expect(screen.getAllByText('Chart').length).toBeGreaterThan(0)
  })

  test('quarter mode ignores annual reference periods', () => {
    mockUsePeriodState.mockReturnValue({ period: 'Q', setPeriod: jest.fn() } as any)
    mockUseFinancialRatios.mockReturnValue({
      data: {
        data: [
          { symbol: 'VNM', period: '2024-Q1', pe: 14.2, pb: 2.1 },
          { symbol: 'VNM', period: '2024-Q2', pe: 15.1, pb: 2.2 },
        ],
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)
    mockUseIncomeStatement.mockReturnValue({
      data: {
        data: [
          { period: '2024' },
          { period: '2024-Q1' },
          { period: '2024-Q2' },
        ],
      },
    } as any)

    render(<FinancialRatiosWidget id="ratios" symbol="VNM" />)

    expect(screen.getByText('Q1 2024')).toBeInTheDocument()
    expect(screen.getByText('Q2 2024')).toBeInTheDocument()
    expect(screen.queryByText('2024')).not.toBeInTheDocument()
  })
})
