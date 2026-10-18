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

import type { UseQueryResult } from '@tanstack/react-query'
import type { EquityProfileResponse } from '@/types/equity'
import type { ScreenerResponse } from '@/types/screener'
import type { DividendsResponse } from '@/lib/api'

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

// The widget reads only these fields; the caller names the response type the
// stub stands in for, so a missing field surfaces at the mock site.
function queryResult<T>(data: T): UseQueryResult<T, Error> {
  return {
    data,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  } as unknown as UseQueryResult<T, Error>
}

// The label and its value sit in sibling divs inside one info card.
function marketCapCard() {
  return screen.getByText('Market Cap').closest('div.rounded-xl') as HTMLElement
}

describe('TickerProfileWidget', () => {
  beforeEach(() => {
    mockProfile.mockReset()
    mockDividends.mockReset()
    mockInsider.mockReset()
    mockScreener.mockReset()
    setupReturns()
  })

  test.each([0.25, 0, 388])('renders endpoint-computed dividend percent %s without scaling', dividendYield => {
    mockProfile.mockReturnValue(queryResult<EquityProfileResponse>({
      symbol: 'VNM', data: { symbol: 'VNM', company_name: 'Vietnam Dairy Products' },
    }))
    mockDividends.mockReturnValue(queryResult<DividendsResponse>({
      data: [{ symbol: 'VNM', dividend_type: 'cash', cash_dividend: 1000, dividend_yield: dividendYield }],
    }))

    render(<TickerProfileWidget symbol="VNM" />)

    expect(screen.getByText(`Cash • ${dividendYield.toFixed(2)}%`)).toBeInTheDocument()
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

  test('withholds market cap when no source declares its unit', () => {
    mockProfile.mockReturnValue(queryResult<EquityProfileResponse>({ symbol: 'VNM', data: { symbol: 'VNM', company_name: 'Vietnam Dairy Products' } }))
    mockScreener.mockReturnValue(queryResult<ScreenerResponse>({ data: [{ ticker: 'VNM', market_cap: 126_024_313_333.5 }] }))
    render(<TickerProfileWidget symbol="VNM" />)

    expect(marketCapCard()).toHaveTextContent('Not disclosed')
    expect(screen.queryByText(/VND 126/)).not.toBeInTheDocument()
  })

  test('renders the screener magnitude once it declares a VND market-cap unit', () => {
    mockProfile.mockReturnValue(queryResult<EquityProfileResponse>({ symbol: 'VNM', data: { symbol: 'VNM', company_name: 'Vietnam Dairy Products' } }))
    mockScreener.mockReturnValue(queryResult<ScreenerResponse>({
      data: [{ ticker: 'VNM', market_cap: 126_024_313_333.5, market_cap_unit: 'VND' }],
    }))
    render(<TickerProfileWidget symbol="VNM" />)

    expect(marketCapCard()).toHaveTextContent('VND 126.02B')
  })
})