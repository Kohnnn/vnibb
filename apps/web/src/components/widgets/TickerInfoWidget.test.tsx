import { render, screen, within } from '@testing-library/react';
import { useHistoricalPrices, useProfile, useScreenerData, useStockQuote, useTradingStats } from '@/lib/queries';
import { useUnit } from '@/contexts/UnitContext';
import { TickerInfoWidget } from './TickerInfoWidget';

jest.mock('@/lib/queries', () => ({
  useHistoricalPrices: jest.fn(), useProfile: jest.fn(), useScreenerData: jest.fn(),
  useStockQuote: jest.fn(), useTradingStats: jest.fn(),
}));
jest.mock('@/contexts/UnitContext', () => ({
  useUnit: jest.fn(),
}));
jest.mock('@/hooks/useQuantRegime', () => ({
  useQuantRegime: () => ({ hasData: false }),
}));
jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut: false, resetTimeout: jest.fn() }),
}));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const mockStockQuote = useStockQuote as jest.Mock;
const mockProfile = useProfile as jest.Mock;
const mockScreener = useScreenerData as jest.Mock;
const mockHistory = useHistoricalPrices as jest.Mock;
const mockTradingStats = useTradingStats as jest.Mock;
const mockUnit = useUnit as jest.Mock;

function marketCapCell() {
  return within(screen.getByText('Mkt Cap').parentElement!);
}

describe('TickerInfoWidget confirmed-unit market cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnit.mockReturnValue({ config: { display: 'auto', decimalPlaces: 2, currency: 'VND', locale: 'en-US' } });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND' },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    mockProfile.mockReturnValue({
      data: { data: { company_name: 'FPT', outstanding_shares: 1_000_000 } },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    mockScreener.mockReturnValue({ data: { data: [] }, refetch: jest.fn() });
    mockHistory.mockReturnValue({ data: { data: [] } });
    mockTradingStats.mockReturnValue({ data: undefined });
  });

  test('derives full VND market cap from confirmed 57300 VND price without thousand-VND conversion', () => {
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(marketCapCell().getByText('57.30B')).toBeInTheDocument();
    expect(marketCapCell().getByText('Derived')).toBeInTheDocument();
  });

  test('preserves an explicitly low VND price when deriving market cap', () => {
    mockStockQuote.mockReturnValue({ data: { symbol: 'FPT', price: 57.3, price_unit: 'VND' } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(marketCapCell().getByText('57.30M')).toBeInTheDocument();
    expect(marketCapCell().getByText('Derived')).toBeInTheDocument();
  });

  test.each(['unknown', 'index_points', undefined])('does not infer market cap from a %s quote unit', (price_unit) => {
    mockStockQuote.mockReturnValue({ data: { symbol: 'FPT', price: 57.3, price_unit } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(marketCapCell().getByText('Unavailable')).toBeInTheDocument();
    expect(marketCapCell().queryByText('Derived')).not.toBeInTheDocument();
  });

  test('retains reported screener market cap precedence over derived value', () => {
    mockScreener.mockReturnValue({ data: { data: [{ market_cap: 60_000_000_000 }] }, refetch: jest.fn() });
    mockProfile.mockReturnValue({ data: { data: { outstanding_shares: 1_000_000, market_cap: 59_000_000_000 } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(marketCapCell().getByText('60.00B')).toBeInTheDocument();
    expect(marketCapCell().getByText('Screener')).toBeInTheDocument();
  });

  test('retains reported profile market cap even when the quote unit is unknown', () => {
    mockStockQuote.mockReturnValue({ data: { symbol: 'FPT', price: 57.3, price_unit: 'unknown' } });
    mockProfile.mockReturnValue({ data: { data: { outstanding_shares: 1_000_000, market_cap: 59_000_000_000 } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(marketCapCell().getByText('59.00B')).toBeInTheDocument();
    expect(marketCapCell().getByText('Profile')).toBeInTheDocument();
  });
  test.each([
    ['unknown', 'Price unit unconfirmed'],
    ['index_points', 'Index points'],
  ])('keeps a %s quote raw rather than applying VND-to-USD FX', (price_unit, label) => {
    mockUnit.mockReturnValue({ config: { display: 'USD', decimalPlaces: 2, currency: 'USD', locale: 'en-US' } });
    mockStockQuote.mockReturnValue({ data: { symbol: 'FPT', price: 57.3, price_unit } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.getByText('57.30')).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });
  test('does not compare a VND quote with an unconfirmed historical 52-week range', () => {
    mockHistory.mockReturnValue({ data: { data: [{ high: 60, low: 40, price_unit: 'unknown' }] } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.queryByText('52W Range')).not.toBeInTheDocument();
  });

  test('uses confirmed VND history for the 52-week range', () => {
    mockHistory.mockReturnValue({ data: { data: [{ high: 60000, low: 40000, price_unit: 'VND' }] } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.getByText('52W Range')).toBeInTheDocument();
  });
});
