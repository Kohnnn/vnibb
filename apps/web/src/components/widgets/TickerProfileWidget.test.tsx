import { render, screen } from '@testing-library/react'

import { TickerProfileWidget } from '@/components/widgets/TickerProfileWidget'

jest.mock('@/lib/queries', () => ({
  useProfile: jest.fn(),
  useDividends: jest.fn(),
  useInsiderDeals: jest.fn(),
  useScreenerData: jest.fn(),
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

jest.mock('@/components/ui/CompanyLogo', () => ({
  CompanyLogo: () => null,
}))

jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}))

import {
  useProfile,
  useDividends,
  useInsiderDeals,
  useScreenerData,
} from '@/lib/queries'

const mockProfile = useProfile as jest.MockedFunction<typeof useProfile>
const mockDividends = useDividends as jest.MockedFunction<typeof useDividends>
const mockInsider = useInsiderDeals as jest.MockedFunction<typeof useInsiderDeals>
const mockScreener = useScreenerData as jest.MockedFunction<typeof useScreenerData>

function setupReturns() {
  mockProfile.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as any)
  mockDividends.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as any)
  mockInsider.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as any)
  mockScreener.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as any)
}

describe('TickerProfileWidget', () => {
  beforeEach(() => {
    mockProfile.mockReset()
    mockDividends.mockReset()
    mockInsider.mockReset()
    mockScreener.mockReset()
    setupReturns()
  })

  test('shows loading skeleton while initial profile loads', () => {
    mockProfile.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
      isFetching: true,
      dataUpdatedAt: 0,
    } as any)

    render(<TickerProfileWidget symbol="VNM" />)

    expect(screen.getByTestId('widget-skeleton')).toBeInTheDocument()
  })

  test('shows empty state when no symbol', () => {
    render(<TickerProfileWidget symbol="" />)

    expect(screen.getByTestId('widget-empty')).toBeInTheDocument()
  })

  test('shows error widget when profile API errors with no cached data', () => {
    mockProfile.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('profile fetch failed'),
      refetch: jest.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
    } as any)

    render(<TickerProfileWidget symbol="VNM" />)

    expect(screen.getByTestId('widget-error')).toHaveTextContent(/profile fetch failed/i)
  })
})