import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';

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
        extra: {
          metrics: expect.objectContaining({ pe: 12.3, market_cap: 123_000 }),
        },
      }),
    );
  });
});
