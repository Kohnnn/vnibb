import { render, screen, within } from '@testing-library/react';
import { useFinancialRatios, useProfile, useScreenerData, useStockQuote } from '@/lib/queries';
import { ShareStatisticsWidget } from './ShareStatisticsWidget';

jest.mock('@/lib/queries', () => ({
  useFinancialRatios: jest.fn(), useProfile: jest.fn(), useScreenerData: jest.fn(), useStockQuote: jest.fn(),
}));
jest.mock('@/components/ui/WidgetContainer', () => ({
  WidgetContainer: ({ children, exportData }: { children: React.ReactNode; exportData?: unknown }) => <div>{children}<output data-testid="share-export">{JSON.stringify(exportData)}</output></div>,
}));
jest.mock('@/components/ui/widget-skeleton', () => ({ WidgetSkeleton: () => <div /> }));
jest.mock('@/components/ui/widget-states', () => ({
  WidgetEmpty: ({ message }: { message: string }) => <div>{message}</div>,
  WidgetError: ({ error }: { error: Error }) => <div>{error.message}</div>,
}));
jest.mock('@/components/ui/WidgetMeta', () => ({ WidgetMeta: () => null }));
jest.mock('@/lib/widgetRuntime', () => ({ buildWidgetRuntime: (payload: Record<string, unknown>) => payload }));

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

  test.each([
    ['certified screener takes precedence', 'percent', 0.25, 'percent', '0.25%', 'Screener'],
    ['certified zero remains zero', 'percent', 0, 'percent', '0.00%', 'Screener'],
    ['unknown screener falls back to certified ratios', 'unknown', 0.25, 'percent', '0.75%', 'Ratios'],
    ['missing screener units fall back to certified ratios', undefined, 0.25, 'percent', '0.75%', 'Ratios'],
    ['unknown units are unavailable', 'unknown', 0.25, 'unknown', '-', undefined],
    ['missing units are unavailable', undefined, 0.25, undefined, '-', undefined],
  ] as const)('renders dividend yield when %s', (_name, screenerUnit, screenerYield, ratioUnit, expected, source) => {
    mockScreener.mockReturnValue({
      data: { data: [{ ticker: 'FPT', pe: 12.3, dividend_yield: screenerYield,
        ratio_units: screenerUnit === undefined ? undefined : { dividend_yield: screenerUnit } }] },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });
    mockRatios.mockReturnValue({
      data: { data: [{ symbol: 'FPT', period: '2025', dividend_yield: 0.75,
        ratio_units: ratioUnit === undefined ? undefined : { dividend_yield: ratioUnit } }] },
      isLoading: false, error: null, refetch: jest.fn(),
    });

    render(<ShareStatisticsWidget id="share-1" symbol="FPT" />);

    const yieldRow = within(screen.getByText('Dividend Yield').parentElement!);
    expect(yieldRow.getByText(expected)).toBeInTheDocument();
    if (source) expect(yieldRow.getByText(source)).toBeInTheDocument();
    expect(screen.queryByText('25.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('75.00%')).not.toBeInTheDocument();
  });

  test.each(['index_points', 'unknown', undefined])(
    'does not derive market cap from a %s quote unit',
    (price_unit) => {
      mockStockQuote.mockReturnValue({
        data: { symbol: 'FPT', price: 57.3, price_unit },
        isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
      });
      render(<ShareStatisticsWidget id="share-1" symbol="FPT" />);
      expect(within(screen.getByText('Market Cap').parentElement!).getByText('Unavailable')).toBeInTheDocument();
      expect(screen.queryByText('MCap derived')).not.toBeInTheDocument();
    },
  );

  test('does not derive market cap from VND price and undated unknown-unit profile shares', () => {
    const onDataChange = jest.fn();
    mockProfile.mockReturnValue({ data: { data: { outstanding_shares: 850.1 } }, isLoading: false, refetch: jest.fn() });
    render(<ShareStatisticsWidget id="share-1" symbol="FPT" onDataChange={onDataChange} />);
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/lacks certified VND unit/)).toBeInTheDocument();
    expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({ extra: expect.objectContaining({
      profile: expect.objectContaining({ outstanding_shares: 850.1 }),
      quote: expect.objectContaining({ price: 57.3 }),
      marketCap: expect.objectContaining({ status: 'unavailable', value: null }),
    }) }));
  });

  test.each([
    ['unknown unit', { outstanding_shares: 850.1 }, 'Unavailable', null],
    ['missing source', { outstanding_shares: 100, shares_unit: 'shares', share_basis: 'outstanding' }, 'Unavailable', null],
    ['wrong basis', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'listed' }, 'Unavailable', null],
    ['missing date', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding' }, 'Unavailable', null],
    ['malformed date', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding', shares_as_of: 'not-a-date' }, 'Unavailable', null],
    ['impossible date', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding', shares_as_of: '2026-02-30' }, 'Unavailable', null],
    ['future date', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding', shares_as_of: '2026-10-28' }, 'Unavailable', null],
    ['future source timestamp date', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding', shares_as_of: '2026-10-28T00:00:00+07:00' }, 'Unavailable', null],
    ['source date retained across timezone', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding', shares_as_of: '2026-10-27T18:00:00Z' }, '100.00', 100],
    ['current Vietnam date', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding', shares_as_of: '2026-10-27' }, '100.00', 100],
    ['current Vietnam timestamp', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding', shares_as_of: '2026-10-26T18:00:00Z' }, '100.00', 100],
    ['certified small count', { outstanding_shares: 100, shares_unit: 'shares', shares_source: 'issuer', share_basis: 'outstanding', shares_as_of: '2025-12-31' }, '100.00', 100],
  ])('renders profile shares only with evidence: %s', (_name, profileData, expected, exported) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-26T17:30:00Z'));
    mockProfile.mockReturnValue({ data: { data: profileData }, isLoading: false, refetch: jest.fn() });
    render(<ShareStatisticsWidget id="share-1" symbol="FPT" />);
    expect(within(screen.getByText('Shares Outstanding').parentElement!).getByText(expected)).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('share-export').textContent!).outstandingShares).toBe(exported);
    expect(screen.queryByText('850.10')).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  test('withholds captured VCI uncertified cap values', () => {
    mockProfile.mockReturnValue({ data: { data: { outstanding_shares: 1152231925, market_cap: 22065241363750 } }, isLoading: false, refetch: jest.fn() });
    mockScreener.mockReturnValue({ data: { data: [{ ticker: 'VCI', pe: 12.3, market_cap: 22410910941.25 }] }, isLoading: false, refetch: jest.fn() });
    render(<ShareStatisticsWidget id="share-1" symbol="VCI" />);
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/22065241363750/)).toBeInTheDocument();
    expect(screen.getByText(/22410910941.25/)).toBeInTheDocument();
  });

  test('retains a certified screener market cap even when the quote unit is unknown', () => {
    const provenance = { status: 'available', value: 60_000_000_000, source: 'certified screener', unit: 'VND', currency: 'VND', as_of: '2026-10-26', share_basis: 'outstanding', observations: [{ value: 60_000_000_000, source: 'certified screener' }] };
    mockScreener.mockReturnValue({
      data: { data: [{ ticker: 'FPT', pe: 12.3, market_cap: provenance.value, market_cap_provenance: provenance }] },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(), dataUpdatedAt: 0,
    });
    mockStockQuote.mockReturnValue({
      data: { symbol: 'FPT', price: 57.3, price_unit: 'unknown' },
      isLoading: false, isFetching: false, error: null, refetch: jest.fn(),
    });
    render(<ShareStatisticsWidget id="share-1" symbol="FPT" />);
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('VND60.0bn')).toBeInTheDocument();
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('certified screener')).toBeInTheDocument();
    expect(screen.queryByText('MCap derived')).not.toBeInTheDocument();
  });

  test('shows certified conflicting caps with their provenance', () => {
    const provenance = { status: 'available', value: 100, source: 'profile source', unit: 'VND', currency: 'VND', as_of: '2026-10-26', share_basis: 'outstanding', observations: [{ value: 100, source: 'profile source' }] };
    mockProfile.mockReturnValue({ data: { data: { market_cap: 100, market_cap_provenance: provenance } }, isLoading: false, refetch: jest.fn() });
    mockScreener.mockReturnValue({ data: { data: [{ ticker: 'FPT', pe: 12.3, market_cap: 200, market_cap_provenance: { ...provenance, value: 200, source: 'screener source' } }] }, isLoading: false, refetch: jest.fn() });
    render(<ShareStatisticsWidget id="share-1" symbol="FPT" />);
    expect(within(screen.getByText('Market Cap').parentElement!).getByText('Conflict')).toBeInTheDocument();
    expect(screen.getByText(/Certified market-cap values, dates, or share bases disagree/)).toBeInTheDocument();
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
