import { render, screen, within } from '@testing-library/react';
import { useFinancialRatios, useProfile, useScreenerData, useStockQuote } from '@/lib/queries';
import { ShareStatisticsWidget } from './ShareStatisticsWidget';

jest.mock('@/lib/queries', () => ({
  useFinancialRatios: jest.fn(), useProfile: jest.fn(), useScreenerData: jest.fn(), useStockQuote: jest.fn(),
}));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/widget-skeleton', () => ({ WidgetSkeleton: () => <div /> }));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
  WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const mockStockQuote = useStockQuote as jest.Mock;
const mockProfile = useProfile as jest.Mock;
const mockScreener = useScreenerData as jest.Mock;
const mockRatios = useFinancialRatios as jest.Mock;

describe('ShareStatisticsWidget confirmed-unit market cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `pe` keeps the widget out of its empty state so the Market Cap row renders.
    mockScreener.mockReturnValue({
      data: { data: [{ ticker: 'FPT', pe: 12.3 }] },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });
    mockProfile.mockReturnValue({
      data: { data: { outstanding_shares: 1_000_000 } },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });
    mockRatios.mockReturnValue({ data: { data: [] }, isLoading: false, error: null, refetch: jest.fn() });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, price_unit: 'VND' },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });
  });

  test.each(['index_points', 'unknown', undefined])(
    'does not derive market cap from a %s quote unit',
    (price_unit) => {
      mockStockQuote.mockReturnValue({
        data: { symbol: 'FPT', price: 57.3, price_unit },
        isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
      });
      render(<ShareStatisticsWidget id="share-1" symbol="FPT" />);
      expect(within(screen.getByText('Market Cap').parentElement!).getByText('-')).toBeInTheDocument();
      expect(screen.queryByText('MCap derived')).not.toBeInTheDocument();
    },
  );

  test('derives market cap from an explicitly low VND price without rescaling', () => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, price_unit: 'VND' },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });
    render(<ShareStatisticsWidget id="share-1" symbol="FPT" />);
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('VND57.3mn')).toBeInTheDocument();
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('Profile+Quote')).toBeInTheDocument();
    expect(screen.getByText('MCap derived')).toBeInTheDocument();
  });

  test('retains the reported screener market cap even when the quote unit is unknown', () => {
    mockScreener.mockReturnValue({
      data: { data: [{ ticker: 'FPT', pe: 12.3, market_cap: 60_000_000_000 }] },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, price_unit: 'unknown' },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });
    render(<ShareStatisticsWidget id="share-1" symbol="FPT" />);
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('VND60.0bn')).toBeInTheDocument();
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('Screener')).toBeInTheDocument();
    expect(screen.queryByText('MCap derived')).not.toBeInTheDocument();
  });

  test.each([
    ['null', { pe: null, pb: null }],
    ['blank string', { pe: '', pb: ' ' }],
  ])(
    'uses the ratios source for P/E and P/B when the screener value is %s (issue #106)',
    (_label, metrics) => {
      mockScreener.mockReturnValue({
        data: { data: [{ ticker: 'MSR', ...metrics }] },
        isLoading:false, isFetching:false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
      });
      mockRatios.mockReturnValue({
        // Canonical API period (`2024`), not `FY-2024`: the ratios endpoint only
        // emits `YYYY` / `Qn-YYYY` / `TTM`, and an unrecognised period is dropped
        // by latestByFinancialPeriod so the fallback would never be reached.
        data: { data: [{ period: '2024', pe: 2394.64, pb: 2.22 }] },
        isLoading:false, isFetching:false, error: null, refetch: jest.fn(),
      });
      render(<ShareStatisticsWidget id="share-1" symbol="MSR" />);
      const peRow = within(screen.getByText('P/E Ratio').parentElement!);
      expect(peRow.getByText('2394.64')).toBeInTheDocument();
      expect(peRow.getByText('Ratios')).toBeInTheDocument();
      expect(within(screen.getByText('P/B Ratio').parentElement!).getByText('2.22')).toBeInTheDocument();
      expect(peRow.queryByText('0.00')).not.toBeInTheDocument();
    },
  );

  test('shows P/E as unavailable when no source reports a value', () => {
    mockScreener.mockReturnValue({
      data: { data: [{ ticker: 'MSR', pe: null, pb: null }] },
      isLoading:false, isFetching:false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });
    render(<ShareStatisticsWidget id="share-1" symbol="MSR" />);
    expect(within(screen.getByText('P/E Ratio').parentElement!).getByText('-')).toBeInTheDocument();
    expect(within(screen.getByText('P/B Ratio').parentElement!).getByText('-')).toBeInTheDocument();
  });
});
