import { render, screen, within } from '@testing-library/react';
import { useHistoricalPrices, useProfile, useScreenerData, useStockQuote } from '@/lib/queries';
import { useUnit } from '@/contexts/UnitContext';
import { TickerInfoWidget } from './TickerInfoWidget';

jest.mock('@/lib/queries', () => ({
  useHistoricalPrices: jest.fn(), useProfile: jest.fn(), useScreenerData: jest.fn(),
  useStockQuote: jest.fn(),
}));
jest.mock('@/contexts/UnitContext', () => ({
  useUnit: jest.fn(),
}));
jest.mock('@/hooks/useQuantRegime', () => ({
  useQuantRegime: () => ({ hasData:false }),
}));
jest.mock('@/hooks/useLoadingTimeout', () => ({
  useLoadingTimeout: () => ({ timedOut:false, resetTimeout: jest.fn() }),
}));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));

const mockStockQuote = useStockQuote as jest.Mock;
const mockProfile = useProfile as jest.Mock;
const mockScreener = useScreenerData as jest.Mock;
const mockHistory = useHistoricalPrices as jest.Mock;
const mockUnit = useUnit as jest.Mock;

const QUOTE_RECEIPT = 1_759_831_200_000; // 2026-10-07T10:00:00Z, TanStack retrieval time
const QUOTE_OBSERVED_AT = '2026-10-02T09:15:00Z'; // source quote timestamp
const AUTO_UNIT = { display: 'auto', decimalPlaces: 2, currency: 'VND', locale: 'en-US' };
const USD_UNIT = { display: 'USD', decimalPlaces: 2, currency: 'USD', locale: 'en-US' };

describe('TickerInfoWidget confirmed-unit market cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnit.mockReturnValue({ config: AUTO_UNIT });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND', updatedAt: QUOTE_OBSERVED_AT },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    mockProfile.mockReturnValue({
      data: { data: { company_name: 'FPT', outstanding_shares: 1_000_000 } },
      isLoading:false, isFetching:false, refetch: jest.fn(),
    });
    mockScreener.mockReturnValue({ data: { data:[] }, refetch: jest.fn() });
    mockHistory.mockReturnValue({ data: { data:[] } });
  });

  test('derives full VND market cap from confirmed 57300 VND price without thousand-VND conversion', () => {
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    const cell = within(screen.getByText('Mkt Cap').parentElement!);
    expect(cell.getByText('57.30B')).toBeInTheDocument();
    expect(cell.getByText('Derived')).toBeInTheDocument();
  });

  test('preserves an explicitly low VND price when deriving market cap', () => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, price_unit: 'VND' },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    const cell = within(screen.getByText('Mkt Cap').parentElement!);
    expect(cell.getByText('57.30M')).toBeInTheDocument();
    expect(cell.getByText('Derived')).toBeInTheDocument();
  });

  test.each(['unknown', 'index_points', undefined])('does not infer market cap from a %s quote unit', (price_unit) => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, price_unit },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    const cell = within(screen.getByText('Mkt Cap').parentElement!);
    expect(cell.getByText('Unavailable')).toBeInTheDocument();
    expect(cell.queryByText('Derived')).not.toBeInTheDocument();
  });

  test('retains reported screener market cap precedence over derived value', () => {
    mockScreener.mockReturnValue({ data: { data: [{ market_cap: 60_000_000_000 }] }, refetch: jest.fn() });
    mockProfile.mockReturnValue({ data: { data: { outstanding_shares: 1_000_000, market_cap: 59_000_000_000 } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    const cell = within(screen.getByText('Mkt Cap').parentElement!);
    expect(cell.getByText('60.00B')).toBeInTheDocument();
    expect(cell.getByText('Screener')).toBeInTheDocument();
  });

  test('retains reported profile market cap even when the quote unit is unknown', () => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, price_unit: 'unknown' },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    mockProfile.mockReturnValue({ data: { data: { outstanding_shares: 1_000_000, market_cap: 59_000_000_000 } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    const cell = within(screen.getByText('Mkt Cap').parentElement!);
    expect(cell.getByText('59.00B')).toBeInTheDocument();
    expect(cell.getByText('Profile')).toBeInTheDocument();
  });
});

describe('TickerInfoWidget daily delta units', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnit.mockReturnValue({ config: AUTO_UNIT });
    mockProfile.mockReturnValue({ data: { data: { company_name: 'FPT' } }, isLoading:false, isFetching:false, refetch: jest.fn() });
    mockScreener.mockReturnValue({ data: { data:[] }, refetch: jest.fn() });
    mockHistory.mockReturnValue({ data: { data:[] } });
  });

  test('prints a confirmed-VND delta with the same precision as the price', () => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, change: 2100, changePct: 3.81, price_unit: 'VND' },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.getByText('Up +2,100.00 (+3.81%)')).toBeInTheDocument();
  });

  test('keeps a genuine large confirmed-VND move intact rather than flattening it', () => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 125000, change: 12500, changePct: 11.11, price_unit: 'VND' },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.getByText('Up +12,500.00 (+11.11%)')).toBeInTheDocument();
  });

  test('converts a confirmed-VND delta to USD exactly once through the same rate as the price', () => {
    mockUnit.mockReturnValue({ config: USD_UNIT });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, change: 2500, changePct: 4.56, price_unit: 'VND' },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.getByText('2.29')).toBeInTheDocument();
    expect(screen.getByText('Up +0.10 (+4.56%)')).toBeInTheDocument();
    expect(screen.queryByText(/2,500\.00/)).not.toBeInTheDocument();
  });

  test.each([
    ['unknown', 'Price unit unconfirmed'],
    ['index_points', 'Index points'],
  ])('keeps a %s quote delta raw and disclosed rather than applying VND-to-USD FX', (price_unit, label) => {
    mockUnit.mockReturnValue({ config: USD_UNIT });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, change: 0.4, changePct: 0.7, price_unit },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.getByText('57.30')).toBeInTheDocument();
    expect(screen.getByText('Up +0.40 (+0.70%)')).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('TickerInfoWidget 52W range unit certification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnit.mockReturnValue({ config: AUTO_UNIT });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND', updatedAt: QUOTE_OBSERVED_AT },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    mockProfile.mockReturnValue({ data: { data: { company_name: 'FPT' } }, isLoading:false, isFetching:false, refetch: jest.fn() });
    mockScreener.mockReturnValue({ data: { data:[] }, refetch: jest.fn() });
    mockHistory.mockReturnValue({ data: { data:[] } });
  });

  test('publishes the range only from rows that each carry an explicit VND marker', () => {
    mockHistory.mockReturnValue({ data: { data: [
      { high: 60000, low: 40000, price_unit: 'VND' },
      { high: 58000, low: 42000, price_unit: 'VND' },
    ] } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.getByText('52W Range')).toBeInTheDocument();
    expect(within(screen.getByText('52W Low').parentElement!).getByText('40,000.00')).toBeInTheDocument();
    expect(within(screen.getByText('52W High').parentElement!).getByText('60,000.00')).toBeInTheDocument();
    // The range bar is the second consumer of the same certified bounds.
    const rangeBar = within(screen.getByText('52W Range').closest('div.rounded-xl') as HTMLElement);
    expect(rangeBar.getByText('40,000.00')).toBeInTheDocument();
    expect(rangeBar.getByText('60,000.00')).toBeInTheDocument();
  });

  test('publishes the range from explicit VND rows regardless of the aggregate status', () => {
    mockHistory.mockReturnValue({ data: { data: [{ high: 60000, low: 40000, price_unit: 'VND' }], meta: { unit_status: 'unconfirmed' } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.getByText('52W Range')).toBeInTheDocument();
  });

  test('refuses a response whose rows mix units instead of publishing a partial range', () => {
    mockHistory.mockReturnValue({ data: { data: [
      { high: 60000, low: 40000, price_unit: 'VND' },
      { high: 900, low: 800, price_unit: 'index_points' },
      { high: 70, low: 60, price_unit: 'unknown' },
    ], meta: { unit_status: 'mixed' } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.queryByText('52W Range')).not.toBeInTheDocument();
    expect(screen.queryByText('900.00')).not.toBeInTheDocument();
    expect(screen.queryByText('70.00')).not.toBeInTheDocument();
  });

  test('refuses metadata certification when rows carry no explicit marker', () => {
    mockHistory.mockReturnValue({ data: { data: [
      { high: 60000, low: 40000 },
      { high: 58, low: 42 },
    ], meta: { unit_status: 'confirmed_vnd' } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.queryByText('52W Range')).not.toBeInTheDocument();
    expect(screen.queryByText('40,000.00')).not.toBeInTheDocument();
  });

  test('refuses a partly marked response that metadata would otherwise certify', () => {
    mockHistory.mockReturnValue({ data: { data: [
      { high: 60000, low: 40000, price_unit: 'VND' },
      { high: 58, low: 42 },
    ], meta: { unit_status: 'confirmed_vnd' } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.queryByText('52W Range')).not.toBeInTheDocument();
  });

  test('shows no range numbers when the history carries no VND marker', () => {
    mockHistory.mockReturnValue({ data: { data: [{ high: 60, low: 40, price_unit: 'unknown' }] } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.queryByText('52W Range')).not.toBeInTheDocument();
    expect(within(screen.getByText('52W High').parentElement!).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByText('52W Low').parentElement!).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('40.00')).not.toBeInTheDocument();
  });

  test('omits the range when history is missing entirely', () => {
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.queryByText('52W Range')).not.toBeInTheDocument();
  });

  test('never builds a range from uncertified screener 52w or OHLC columns', () => {
    mockScreener.mockReturnValue({
      data: {
        data: [{
          symbol: 'FPT', price_unit: 'unknown',
          low_52w: 40, high_52w: 60, '52w_low': 40, '52w_high': 60,
          low: 41, high: 61, open: 42, prev_close: 43,
        }],
      },
      refetch: jest.fn(),
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.queryByText('52W Range')).not.toBeInTheDocument();
    expect(screen.queryByText('40.00')).not.toBeInTheDocument();
    expect(screen.queryByText('61.00')).not.toBeInTheDocument();
  });

  test('does not compare a VND quote with an unconfirmed historical range', () => {
    mockHistory.mockReturnValue({ data: { data: [{ high: 60, low: 40, price_unit: 'unknown' }], meta: { unit_status: 'unconfirmed' } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(screen.queryByText('52W Range')).not.toBeInTheDocument();
  });
});

describe('TickerInfoWidget freshness contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnit.mockReturnValue({ config: AUTO_UNIT });
    // Profile resolves a minute after the quote; its receipt time must never become the as-of.
    mockProfile.mockReturnValue({
      data: { data: { company_name: 'FPT' } },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT + 60_000,
    });
    mockScreener.mockReturnValue({ data: { data:[] }, refetch: jest.fn() });
    mockHistory.mockReturnValue({ data: { data:[] } });
  });

  test('publishes the source observation date and the query receipt time separately', () => {
    const onDataChange = jest.fn();
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND', updatedAt: QUOTE_OBSERVED_AT },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" onDataChange={onDataChange} />);

    const { provenance } = onDataChange.mock.calls[0][0].__widgetRuntime;
    expect(provenance.updatedAt).toBe(QUOTE_OBSERVED_AT);
    expect(provenance.fetchedAt).toBe(QUOTE_RECEIPT);
  });

  test('leaves the source date unknown instead of promoting the receipt time', () => {
    const onDataChange = jest.fn();
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND' },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" onDataChange={onDataChange} />);

    const { provenance } = onDataChange.mock.calls[0][0].__widgetRuntime;
    // Whatever empty representation the runtime contract uses, the receipt time must not
    // become the source date.
    expect(provenance.updatedAt).toBeFalsy();
    expect(provenance.fetchedAt).toBe(QUOTE_RECEIPT);
  });
});
