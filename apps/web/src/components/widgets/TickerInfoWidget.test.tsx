import { act, render, screen, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { useHistoricalPrices, useProfile, useScreenerData, useStockQuote } from '@/lib/queries';
import { useUnit } from '@/contexts/UnitContext';
import { TickerInfoWidget } from './TickerInfoWidget';
import { deriveWidgetHealth } from '@/lib/widgetHealth';
import { formatAbsoluteTimestamp } from '@/lib/formatDate';

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

  test('keeps the full company name in a keyboard-focusable information region', () => {
    mockProfile.mockReturnValue({ data: { data: { company_name: 'A long company name for a narrow widget' } }, isLoading: false });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    const region = screen.getByRole('region', { name: 'FPT ticker information' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByText('A long company name for a narrow widget')).not.toHaveClass('line-clamp-1');
  });

  test('does not derive market cap from a dated quote and undated shares', () => {
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(within(screen.getByText('Mkt Cap').parentElement!).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/lacks certified VND unit/)).toBeInTheDocument();
  });

  test('captured VCI payload remains unavailable and retains raw inputs', () => {
    const onDataChange = jest.fn();
    mockStockQuote.mockReturnValue({ data: { symbol: 'VCI', price: 19150, price_unit: 'VND', updatedAt: '2026-10-26' }, isLoading: false, refetch: jest.fn() });
    mockProfile.mockReturnValue({ data: { data: { outstanding_shares: 1152231925, market_cap: 22065241363750 } } });
    mockScreener.mockReturnValue({ data: { data: [{ market_cap: 22410910941.25 }] }, refetch: jest.fn() });
    render(<TickerInfoWidget id="ticker-1" symbol="VCI" onDataChange={onDataChange} />);
    expect(within(screen.getByText('Mkt Cap').parentElement!).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('22.41B')).not.toBeInTheDocument();
    expect(screen.getByText(/22410910941.25/)).toBeInTheDocument();
    expect(JSON.stringify(onDataChange.mock.calls)).toContain('22065241363750');
  });

  test('displays a certified low VND cap without scaling it by a guessed multiplier', () => {
    const provenance = { status: 'available', value: 57.3, source: 'certified source', unit: 'VND', currency: 'VND', as_of: '2026-10-26', share_basis: 'outstanding', observations: [{ value: 57.3, source: 'certified source' }] };
    mockProfile.mockReturnValue({ data: { data: { market_cap: 57.3, market_cap_provenance: provenance } } });
    mockScreener.mockReturnValue({ data: { data: [{ market_cap: 57.3, market_cap_provenance: provenance }] }, refetch: jest.fn() });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(within(screen.getByText('Mkt Cap').parentElement!).getByText('57.30')).toBeInTheDocument();
    expect(screen.getByText(/share basis outstanding/)).toBeInTheDocument();
  });
  test('converts a certified VND cap to USD once', () => {
    mockUnit.mockReturnValue({ config: USD_UNIT });
    const provenance = { status: 'available', value: 2500000, source: 'certified source', unit: 'VND', currency: 'VND', as_of: '2026-10-26', share_basis: 'outstanding', observations: [{ value: 2500000, source: 'certified source' }] };
    mockProfile.mockReturnValue({ data: { data: { market_cap: 2500000, market_cap_provenance: provenance } } });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(within(screen.getByText('Mkt Cap').parentElement!).getByText('100.00')).toBeInTheDocument();
  });


  test('shows a conflict when certified sources disagree', () => {
    const provenance = { status: 'available', value: 100, source: 'profile', unit: 'VND', currency: 'VND', as_of: '2026-10-26', share_basis: 'outstanding', observations: [{ value: 100, source: 'profile' }] };
    mockProfile.mockReturnValue({ data: { data: { market_cap: 100, market_cap_provenance: provenance } } });
    mockScreener.mockReturnValue({ data: { data: [{ market_cap: 200, market_cap_provenance: { ...provenance, value: 200, source: 'screener' } }] }, refetch: jest.fn() });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);
    expect(within(screen.getByText('Mkt Cap').parentElement!).getByText('Conflict')).toBeInTheDocument();
    expect(screen.getByText(/Certified market-cap values, dates, or share bases disagree/)).toBeInTheDocument();
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
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
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
    const rangeBar = within(screen.getByRole('region', { name: '52W Range' }));
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
    expect(within(screen.getByText('52W High').parentElement!).getByText('n/a')).toBeInTheDocument();
    expect(within(screen.getByText('52W Low').parentElement!).getByText('n/a')).toBeInTheDocument();
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

  test('groups the quote, source date, and stale status ahead of profile notices', () => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND', updatedAt: QUOTE_OBSERVED_AT, stale: true },
      isLoading: false, isFetching: true, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    mockProfile.mockReturnValue({ data: { data: { company_name: 'FPT' } }, isLoading: false });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);

    const region = screen.getByRole('region', { name: 'FPT ticker information' });
    const quote = within(region).getByRole('group', { name: 'FPT quote and freshness' });
    expect(within(quote).getByText('57,300.00')).toBeInTheDocument();
    expect(within(quote).getByText('VND')).toBeInTheDocument();
    expect(within(quote).getByText(`As of ${formatAbsoluteTimestamp(QUOTE_OBSERVED_AT)}`)).toBeInTheDocument();
    expect(within(quote).getByText(`Fetched ${formatAbsoluteTimestamp(QUOTE_RECEIPT)}`)).toBeInTheDocument();
    expect(within(quote).getByText('Refreshing')).toBeInTheDocument();
    expect(within(quote).getByText('Stale data')).toBeInTheDocument();
    expect(within(region).getAllByText('57,300.00')).toHaveLength(1);
    expect(region).toHaveAttribute('tabindex', '0');
  });

  test('keeps the freshness group on one scrollable line instead of wrapping it', () => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND', updatedAt: QUOTE_OBSERVED_AT, stale: true },
      isLoading: false, isFetching: true, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);

    const quote = screen.getByRole('group', { name: 'FPT quote and freshness' });
    // The row scrolls horizontally rather than growing: a 70px region cannot
    // absorb a second line.
    expect(quote).toHaveClass('flex-nowrap', 'overflow-x-auto', 'scrollbar-hide');
    expect(quote).not.toHaveClass('flex-wrap');
    // WidgetMeta must neither wrap between chips nor shrink so far that each
    // chip wraps inside itself.
    const freshness = quote.querySelector(':scope > div')!;
    expect(freshness).toHaveClass('flex-nowrap', 'shrink-0');
    expect(freshness).not.toHaveClass('flex-wrap');
  });

  test('leaves the source date unknown instead of promoting the receipt time', () => {
    const onDataChange = jest.fn();
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND' },
      isLoading:false, isFetching:false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" onDataChange={onDataChange} />);

    const { provenance } = onDataChange.mock.calls[0][0].__widgetRuntime;
    expect(screen.getByText('As-of unknown')).toBeInTheDocument();
    // Whatever empty representation the runtime contract uses, the receipt time must not
    // become the source date.
    expect(provenance.updatedAt).toBeFalsy();
    expect(provenance.fetchedAt).toBe(QUOTE_RECEIPT);
  });

  test.each([
    ['quote query', new Error('Quote refetch unavailable'), null],
    ['quote response', undefined, 'Live quote unavailable; showing stored price.'],
  ])('marks retained data stale after a %s error', (_kind, error, responseError) => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND', updatedAt: QUOTE_OBSERVED_AT, stale: false, error: responseError },
      isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT, error,
    });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);

    expect(screen.getByText(`As of ${formatAbsoluteTimestamp(QUOTE_OBSERVED_AT)}`)).toBeInTheDocument();
    expect(screen.getByText('Stale data')).toBeInTheDocument();
    expect(screen.getByText('57,300.00')).toBeInTheDocument();
  });

  test('does not mark a fresh quote stale when only the profile fails', () => {
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57300, price_unit: 'VND', updatedAt: QUOTE_OBSERVED_AT, stale: false },
      isLoading: false, isFetching: false, refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT,
    });
    mockProfile.mockReturnValue({ error: new Error('Profile unavailable'), isLoading: false });
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" />);

    expect(screen.getByText(`As of ${formatAbsoluteTimestamp(QUOTE_OBSERVED_AT)}`)).toBeInTheDocument();
    expect(screen.queryByText('Stale data')).not.toBeInTheDocument();
    expect(screen.getByText('57,300.00')).toBeInTheDocument();
  });

  test('keeps cached and stale health when refetch advances receipt time or fails with retained data', () => {
    const onDataChange = jest.fn();
    const quote = {
      symbol: 'FPT', price: 57300, price_unit: 'VND',
      updatedAt: QUOTE_OBSERVED_AT, cached: true, stale: true,
    };
    let snapshot = {
      data: quote, isLoading: false, isFetching: false,
      refetch: jest.fn(), dataUpdatedAt: QUOTE_RECEIPT, error: undefined as Error | undefined,
    };
    let notify: () => void = () => {};
    mockStockQuote.mockImplementation(() => useSyncExternalStore(
      (listener) => { notify = listener; return () => {}; },
      () => snapshot,
    ));
    render(<TickerInfoWidget id="ticker-1" symbol="FPT" onDataChange={onDataChange} />);
    const initial = onDataChange.mock.calls.at(-1)[0].__widgetRuntime.provenance;
    expect(deriveWidgetHealth(initial)).toMatchObject({ status: 'stale', label: 'Stale' });
    expect(deriveWidgetHealth(initial).detail).toContain('cached snapshot');
    expect(screen.getByText('Stale data')).toBeInTheDocument();

    act(() => {
      snapshot = { ...snapshot, dataUpdatedAt: QUOTE_RECEIPT + 60_000 };
      notify();
    });
    const refreshed = onDataChange.mock.calls.at(-1)[0].__widgetRuntime.provenance;
    expect(refreshed.updatedAt).toBe(QUOTE_OBSERVED_AT);
    expect(refreshed.fetchedAt).toBe(QUOTE_RECEIPT + 60_000);
    expect(deriveWidgetHealth(refreshed).status).toBe('stale');

    act(() => {
      snapshot = { ...snapshot, data: { ...quote, cached: false, stale: false }, error: new Error('Quote refetch unavailable') };
      notify();
    });
    const fallback = onDataChange.mock.calls.at(-1)[0].__widgetRuntime.provenance;
    expect(fallback).toMatchObject({ cached: true, stale: true, updatedAt: QUOTE_OBSERVED_AT });
    expect(deriveWidgetHealth(fallback).detail).toContain('cached snapshot');
    expect(screen.getByText('Stale data')).toBeInTheDocument();
    expect(screen.getByText('57,300.00')).toBeInTheDocument();
  });
});
