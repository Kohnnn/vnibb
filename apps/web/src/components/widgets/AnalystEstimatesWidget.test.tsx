import { render, screen } from '@testing-library/react'

import { AnalystEstimatesWidget } from '@/components/widgets/AnalystEstimatesWidget'

jest.mock('@/lib/queries', () => ({
  useAnalystEstimates: jest.fn(),
}))

jest.mock('@/lib/widgetRuntime', () => ({
  buildWidgetRuntime: jest.fn((payload: unknown) => payload),
}))

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}))

jest.mock('@/components/ui/widget-skeleton', () => ({
  WidgetSkeleton: () => <div data-testid="widget-skeleton" />,
}))

jest.mock('@/components/ui/widget-states', () => ({
  WidgetError: ({ error }: { error: Error }) => <div data-testid="widget-error">{error.message}</div>,
  WidgetEmpty: ({ message }: { message: string }) => <div data-testid="widget-empty">{message}</div>,
}))

import { useAnalystEstimates } from '@/lib/queries'
const mockUseAnalystEstimates = useAnalystEstimates as jest.MockedFunction<typeof useAnalystEstimates>

describe('AnalystEstimatesWidget', () => {
  beforeEach(() => {
    mockUseAnalystEstimates.mockReset()
  })

  test('shows empty hint when no symbol is provided', () => {
    mockUseAnalystEstimates.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)

    render(<AnalystEstimatesWidget symbol="" />)

    expect(screen.getByTestId('widget-empty')).toHaveTextContent(/select a symbol/i)
  })

  test('renders rows when API returns estimates', () => {
    mockUseAnalystEstimates.mockReturnValue({
      data: {
        data: {
          data: [
            { period: 'FY+1', eps_estimate: 5234, revenue_estimate: 182_345_000_000 },
            { period: 'FY+2', eps_estimate: 6100, revenue_estimate: 199_000_000_000 },
          ],
          source: 'vnstock',
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 1700000000000,
    } as any)

    render(<AnalystEstimatesWidget symbol="VNM" />)

    expect(screen.getAllByText('FY+1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('FY+2').length).toBeGreaterThan(0)
    expect(screen.getByText('5,234.00')).toBeInTheDocument()
    expect(screen.getByText(/182,345,000,000/)).toBeInTheDocument()
    // No "Coming Soon" placeholder should leak through.
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument()
  })

  test('shows friendly empty state when API returns no rows', () => {
    mockUseAnalystEstimates.mockReturnValue({
      data: { data: { data: [], source: 'vnstock' } },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)

    render(<AnalystEstimatesWidget symbol="VNM" />)

    expect(screen.getByText(/no analyst coverage available/i)).toBeInTheDocument()
    // No fake "Coming Soon" rows should be rendered.
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument()
  })

  test('shows loading skeleton on initial load', () => {
    mockUseAnalystEstimates.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
      isFetching: true,
      dataUpdatedAt: 0,
    } as any)

    render(<AnalystEstimatesWidget symbol="VNM" />)

    expect(screen.getByTestId('widget-skeleton')).toBeInTheDocument()
  })

  test('shows error widget when the API errors and no cached data', () => {
    mockUseAnalystEstimates.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('estimates feed unavailable'),
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)

    render(<AnalystEstimatesWidget symbol="VNM" />)

    expect(screen.getByTestId('widget-error')).toHaveTextContent(/estimates feed unavailable/i)
  })
})