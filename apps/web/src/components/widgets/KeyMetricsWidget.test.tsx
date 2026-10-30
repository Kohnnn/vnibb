import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { MetricsHistoryResponse, QuantResponse } from '@/lib/api';
import {
  useFinancialRatios,
  useMetricsHistory,
  useProfile,
  useQuantMetrics,
  useScreenerData,
  useStockQuote,
  type StockQuoteView,
} from '@/lib/queries';
import type { EquityProfileResponse, FinancialRatiosResponse } from '@/types/equity';
import type { ScreenerResponse } from '@/types/screener';
import { KeyMetricsWidget } from './KeyMetricsWidget';

jest.mock('@/lib/queries', () => ({
  useScreenerData: jest.fn(),
  useMetricsHistory: jest.fn(),
  useFinancialRatios: jest.fn(),
  useProfile: jest.fn(),
  useStockQuote: jest.fn(),
  useQuantMetrics: jest.fn(),
}));

jest.mock('@/contexts/UnitContext', () => ({
  useUnit: () => ({ config: { unit: 'raw', currency: 'VND' } }),
}));

jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}));

jest.mock('@/lib/widgetRuntime', () => ({
  buildWidgetRuntime: (payload: Record<string, unknown>) => payload,
}));

jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/components/ui/widget-skeleton', () => ({
  TableSkeleton: () => <div data-testid="table-skeleton" />,
}));

jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { readonly message: string }) => <div>{message}</div>,
  WidgetError: ({ error }: { readonly error: Error }) => <div>{error.message}</div>,
}));

jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => <div data-testid="widget-meta" />,
}));

jest.mock('@/components/ui/RateLimitAlert', () => ({
  RateLimitAlert: () => <div data-testid="rate-limit-alert" />,
}));

jest.mock('@/components/ui/Sparkline', () => ({
  Sparkline: () => <svg data-testid="sparkline" />,
}));

jest.mock('@/components/ui/QuantWarningBanner', () => ({
  QuantWarningBanner: ({ warning }: { readonly warning?: string | null }) => (warning ? <div>{warning}</div> : null),
}));

const mockUseScreenerData = jest.mocked(useScreenerData);
const mockUseMetricsHistory = jest.mocked(useMetricsHistory);
const mockUseFinancialRatios = jest.mocked(useFinancialRatios);
const mockUseProfile = jest.mocked(useProfile);
const mockUseStockQuote = jest.mocked(useStockQuote);
const mockUseQuantMetrics = jest.mocked(useQuantMetrics);

function makeQueryResult<TData>(data: TData): UseQueryResult<TData, Error> {
  let result: UseQueryResult<TData, Error>;
  const refetch: UseQueryResult<TData, Error>['refetch'] = async () => result;
  result = {
    data,
    dataUpdatedAt: 1_782_432_000_000,
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isPending: false,
    isLoadingError: false,
    isInitialLoading: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    isEnabled: true,
    refetch,
    status: 'success',
    fetchStatus: 'idle',
    promise: Promise.resolve(data),
  } satisfies UseQueryResult<TData, Error>;
  return result;
}

const screenerData: ScreenerResponse = {
  data: [
    {
      ticker: 'VCB',
      pe: 12.3,
      pb: 1.4,
      ps: 2.1,
      ev_ebitda: 8.7,
      roe: 0.18,
      roa: 0.09,
      net_margin: 0.21,
      gross_margin: 0.42,
      debt_to_equity: 0.5,
      current_ratio: 1.8,
      market_cap: 123_000,
      dividend_yield: 0.03,
      ratio_units: { dividend_yield: 'percent' },
      beta: 1.1,
    },
  ],
};

const emptyMetricsHistory: MetricsHistoryResponse = {
  symbol: 'VCB',
  roe: [],
  roa: [],
  pe_ratio: [],
  pb_ratio: [],
  periods: [],
};

const emptyRatiosData: FinancialRatiosResponse = { symbol: 'VCB', count: 0, data: [] };
const emptyProfileData: EquityProfileResponse = { symbol: 'VCB', data: null };
const emptyQuoteData: StockQuoteView = {
  symbol: 'VCB',
  price: null,
  change: null,
  changePct: null,
  prevClose: null,
  volume: null,
  value: null,
  high: null,
  low: null,
  open: null,
  updatedAt: null,
  cached: false,
};
const emptyQuantData: QuantResponse = {
  data: {
    symbol: 'VCB',
    period: '5Y',
    adjustment_mode: 'adjusted',
    computed_at: '2026-06-24T00:00:00Z',
    metrics: {},
  },
  meta: { count: 0 },
};

describe('KeyMetricsWidget', () => {
  beforeEach(() => {
    mockUseScreenerData.mockReturnValue(makeQueryResult(screenerData));
    mockUseMetricsHistory.mockReturnValue(makeQueryResult(emptyMetricsHistory));
    mockUseFinancialRatios.mockReturnValue(makeQueryResult(emptyRatiosData));
    mockUseProfile.mockReturnValue(makeQueryResult(emptyProfileData));
    mockUseStockQuote.mockReturnValue(makeQueryResult(emptyQuoteData));
    mockUseQuantMetrics.mockReturnValue(makeQueryResult(emptyQuantData));
  });

  it('renders canonical low ratio percentages in cards and metric rows', () => {
    mockUseFinancialRatios.mockImplementation((_symbol, options) => makeQueryResult<FinancialRatiosResponse>({
      symbol: 'VCB', count: 1,
      data: [{ symbol: 'VCB', period: options?.period === 'TTM' ? 'TTM' : '2025', roe: 0.25, roa: -0.25 }],
    }));

    render(<KeyMetricsWidget id="metrics" symbol="VCB" />);
    fireEvent.click(screen.getByRole('button', { name: 'Profitability' }));
    expect(screen.getAllByText('+0.25%')).toHaveLength(2);
    expect(screen.getAllByText('-0.25%')).toHaveLength(2);
    expect(screen.queryByText('+25.00%')).not.toBeInTheDocument();
  });

  it.each([
    ['certified ratio takes precedence', 'percent', 0.25, 'percent', '0.25%', 'Ratios'],
    ['certified zero remains zero', 'percent', 0, 'percent', '0.00%', 'Ratios'],
    ['unknown ratio falls back to certified screener', 'unknown', 0.25, 'percent', '0.75%', 'Screener'],
    ['missing ratio units fall back to certified screener', undefined, 0.25, 'percent', '0.75%', 'Screener'],
    ['unknown units are unavailable', 'unknown', 0.25, 'unknown', '-', undefined],
    ['missing units are unavailable', undefined, 0.25, undefined, '-', undefined],
  ] as const)('renders dividend yield when %s', (_name, ratioUnit, ratioYield, screenerUnit, expected, source) => {
    mockUseFinancialRatios.mockReturnValue(makeQueryResult<FinancialRatiosResponse>({
      symbol: 'VCB', count: 1,
      data: [{ symbol: 'VCB', period: '2025', dividend_yield: ratioYield,
        ratio_units: ratioUnit === undefined ? undefined : { dividend_yield: ratioUnit } }],
    }));
    mockUseScreenerData.mockReturnValue(makeQueryResult<ScreenerResponse>({
      data: [{ ...screenerData.data[0], dividend_yield: 0.75,
        ratio_units: screenerUnit === undefined ? undefined : { dividend_yield: screenerUnit } }],
    }));

    render(<KeyMetricsWidget id="metrics" symbol="VCB" />);
    fireEvent.click(screen.getByRole('button', { name: 'Market' }));

    const yieldRow = screen.getAllByText('Dividend Yield')[1].parentElement!.parentElement!;
    expect(within(yieldRow).getByText(expected)).toBeInTheDocument();
    if (source) {
      expect(within(yieldRow).getByText(source)).toBeInTheDocument();
      expect(screen.getAllByText(expected)).toHaveLength(2);
    }
    expect(screen.queryByText('25.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('75.00%')).not.toBeInTheDocument();
  });

  it('renders canonical low screener percentages when ratios are unavailable', () => {
    render(<KeyMetricsWidget id="metrics" symbol="VCB" />);
    fireEvent.click(screen.getByRole('button', { name: 'Profitability' }));
    expect(screen.getAllByText('+0.18%')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Market' }));
    expect(screen.getAllByText('0.03%')).toHaveLength(2);
  });

  it('does not emit repeated runtime payloads when parent rerenders with unchanged metric values', async () => {
    const onDataChange = jest.fn();
    const { rerender } = render(<KeyMetricsWidget id="metrics" symbol="VCB" onDataChange={onDataChange} />);

    await waitFor(() => {
      expect(onDataChange).toHaveBeenCalledTimes(1);
    });

    rerender(<KeyMetricsWidget id="metrics" symbol="VCB" onDataChange={onDataChange} />);

    await waitFor(() => {
      expect(onDataChange).toHaveBeenCalledTimes(1);
    });
    expect(onDataChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({
          metrics: expect.objectContaining({ pe: 12.3, market_cap: null }),
          marketCap: expect.objectContaining({ status: 'unavailable' }),
        }),
      }),
    );
  });

  it('withholds cap for undated unknown-unit profile shares and retains raw inputs', () => {
    const onDataChange = jest.fn();
    mockUseScreenerData.mockReturnValue(makeQueryResult<ScreenerResponse>({ data: [{ ticker: 'VCB', pe: 12.3 }] }));
    mockUseProfile.mockReturnValue(makeQueryResult<EquityProfileResponse>({ symbol: 'VCB', data: { symbol: 'VCB', outstanding_shares: 850.1 } }));
    mockUseStockQuote.mockReturnValue(makeQueryResult<StockQuoteView>({ ...emptyQuoteData, price: 19150, price_unit: 'VND' }));
    render(<KeyMetricsWidget id="metrics" symbol="VCB" onDataChange={onDataChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Market' }));
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByText(/lacks certified VND unit/)).toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({ extra: expect.objectContaining({
      profile: expect.objectContaining({ outstanding_shares: 850.1 }),
      quote: expect.objectContaining({ price: 19150 }),
      marketCap: expect.objectContaining({ status: 'unavailable', value: null }),
    }) }));
  });

  it('withholds captured VCI uncertified caps and exposes their values', () => {
    mockUseScreenerData.mockReturnValue(makeQueryResult<ScreenerResponse>({ data: [{ ticker: 'VCI', pe: 12.3, market_cap: 22410910941.25 }] }));
    mockUseProfile.mockReturnValue(makeQueryResult<EquityProfileResponse>({ symbol: 'VCI', data: { symbol: 'VCI', outstanding_shares: 1152231925, market_cap: 22065241363750 } }));
    render(<KeyMetricsWidget id="metrics" symbol="VCI" />);
    fireEvent.click(screen.getByRole('button', { name: 'Market' }));
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByText(/22410910941.25/)).toBeInTheDocument();
    expect(screen.getByText(/22065241363750/)).toBeInTheDocument();
  });

  it.each([
    [123_000.0001, 'available'],
    [123_100, 'conflict'],
  ] as const)('reconciles certified profile and screener caps: %s', (screenerCap, status) => {
    const observation = { value: 123_000, source: 'certified', unit: 'VND', currency: 'VND', as_of: '2026-10-26', shares: 1, shares_unit: 'shares', shares_as_of: '2026-10-26', share_basis: 'outstanding', price: null, price_unit: null, price_as_of: null, calculation: null };
    const provenance = { status: 'available' as const, value: 123_000, reason: null, source: 'certified', unit: 'VND' as const, currency: 'VND' as const, as_of: '2026-10-26', share_basis: 'outstanding' as const, observations: [observation] };
    mockUseProfile.mockReturnValue(makeQueryResult<EquityProfileResponse>({ symbol: 'VCB', data: { symbol: 'VCB', market_cap: provenance.value, market_cap_provenance: provenance } }));
    mockUseScreenerData.mockReturnValue(makeQueryResult<ScreenerResponse>({ data: [{ ticker: 'VCB', pe: 12.3, market_cap: screenerCap, market_cap_provenance: { ...provenance, value: screenerCap } }] }));
    const onDataChange = jest.fn();
    render(<KeyMetricsWidget id="metrics" symbol="VCB" onDataChange={onDataChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Market' }));
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({ extra: expect.objectContaining({ marketCap: expect.objectContaining({ status }) }) }));
    if (status === 'conflict') expect(screen.getAllByText('Conflict')).toHaveLength(2);
    else expect(screen.queryByText('Conflict')).not.toBeInTheDocument();
  });
});
