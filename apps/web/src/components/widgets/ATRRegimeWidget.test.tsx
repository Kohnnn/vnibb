import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useHistoricalPrices } from '@/lib/queries';
import { formatAbsoluteTimestamp } from '@/lib/format';
import type { EquityHistoricalResponse } from '@/types/equity';
import { ATRRegimeWidget } from './ATRRegimeWidget';

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn() }));

const historicalQuery = jest.mocked(useHistoricalPrices);
const receivedAt = Date.parse('2026-10-05T10:00:00Z');
const certified = { count: 40, unit_status: 'confirmed_vnd' } as const satisfies NonNullable<EquityHistoricalResponse['meta']>;
const unavailableText = /ATR regime unavailable/;

type Options = {
  datesMissing?: boolean;
  error?: Error | null;
  count?: number;
  flat?: boolean;
  /** Drop per-row price_unit so certified metadata has no row-level proof. */
  rowsMissingUnitProof?: boolean;
};

function bars(count: number, options: Options) {
  return Array.from({ length: count }, (_, index) => {
    const row = {
      symbol: 'FPT',
      time: options.datesMissing ? '' : new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
      open: 100000,
      high: options.flat ? 100000 : 110000,
      low: options.flat ? 100000 : 90000,
      close: 100000,
      volume: 1000,
      price_unit: 'VND' as const,
    };
    return options.rowsMissingUnitProof ? { ...row, price_unit: undefined } : row;
  });
}

function showATR(meta: NonNullable<EquityHistoricalResponse['meta']>, options: Options = {}) {
  historicalQuery.mockReturnValue({
    data: { data: bars(options.count ?? 40, options), meta },
    isLoading:false, isFetching:false,
    error: options.error ?? null, refetch: jest.fn(), dataUpdatedAt: receivedAt,
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
  render(<ATRRegimeWidget symbol="FPT" />);
}

function showATRFailure(error: Error) {
  historicalQuery.mockReturnValue({
    data: undefined, isLoading:false, isFetching:false,
    error, refetch: jest.fn(), dataUpdatedAt: receivedAt,
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
  render(<ATRRegimeWidget symbol="FPT" />);
}

describe('ATR regime availability', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(receivedAt);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks old observations stale and prefers backend freshness over receipt time', () => {
    showATR({ ...certified, freshness_as_of: '2024-02-09', last_data_date: '2026-10-05' });

    expect(screen.getByText(`As of ${formatAbsoluteTimestamp(new Date('2024-02-09'))}`)).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText(`Fetched ${formatAbsoluteTimestamp(new Date(receivedAt))}`)).toBeInTheDocument();
  });

  it('uses last_data_date when freshness_as_of is absent', () => {
    showATR({ ...certified, last_data_date: '2024-02-08' });

    expect(screen.getByText(`As of ${formatAbsoluteTimestamp(new Date('2024-02-08'))}`)).toBeInTheDocument();
  });

  it('uses the final returned bar when metadata dates are absent or invalid', () => {
    showATR({ ...certified, freshness_as_of: 'invalid', last_data_date: null });

    expect(screen.getByText(`As of ${formatAbsoluteTimestamp(new Date('2024-02-09'))}`)).toBeInTheDocument();
  });

  it('does not present the receipt time as a source observation date', () => {
    showATR(certified, { datesMissing:true });

    expect(screen.queryByText(/^As of /)).not.toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.getByText(/Historical observation date unavailable/)).toBeInTheDocument();
  });

  it.each([
    ['mixed', 'Mixed historical price units'],
    ['unconfirmed', 'Historical price units unconfirmed'],
  ] as const)('surfaces partial coverage and %s unit warnings', (unitStatus, unitWarning) => {
    showATR({
      ...certified,
      freshness_as_of: '2026-10-05T09:00:00Z',
      completeness_status: 'partial', unit_status: unitStatus, fallback_used:true,
      warnings: ['Internal trading-day gap'], adjustment_warning: 'Adjustment coverage incomplete',
    });
    const warnings = [
      'Internal trading-day gap', 'Partial historical coverage', unitWarning,
      'Historical source fallback used', 'Adjustment coverage incomplete',
    ];

    for (const warning of warnings) expect(screen.getByText(new RegExp(warning))).toBeInTheDocument();
  });

  it('keeps refresh-failure fallback distinct from backend source fallback', () => {
    showATR({ ...certified, freshness_as_of: '2026-10-05T09:00:00Z' }, { error: new Error('Refresh failed') });

    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText(/Latest historical refresh failed/)).toBeInTheDocument();
  });

  it('withholds regime and sizing when historical price units are not certified', () => {
    showATR({ ...certified, unit_status: 'mixed' });

    expect(screen.getAllByText(unavailableText).length).toBeGreaterThan(0);
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
    expect(screen.queryByText('ATR %')).not.toBeInTheDocument();
  });

  it('withholds regime when certified metadata has rows without price-unit proof', () => {
    showATR(certified, { rowsMissingUnitProof:true });

    expect(screen.getAllByText(unavailableText).length).toBeGreaterThan(0);
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
  });

  it('withholds regime when certified history still has unresolved source quality', () => {
    showATR({ ...certified, unresolved_excluded_dates: ['2024-01-05'] } as NonNullable<EquityHistoricalResponse['meta']>);

    expect(screen.getAllByText(unavailableText).length).toBeGreaterThan(0);
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
  });

  it('shows the failure and no metrics when history cannot be loaded at all', () => {
    showATRFailure(new Error('Historical provider unavailable'));

    expect(screen.getByText('Historical provider unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
    expect(screen.queryByText('ATR %')).not.toBeInTheDocument();
  });

  it('renders regime and position sizing for certified, complete history', () => {
    showATR(certified);

    expect(screen.getByText('ATR %')).toBeInTheDocument();
    expect(screen.getByText('Sizing Model')).toBeInTheDocument();
    expect(screen.getByText('Suggested Shares')).toBeInTheDocument();
  });

  it('reports a genuine zero ATR instead of missing history', () => {
    showATR(certified, { flat:true });

    expect(screen.getByText('Sizing Model')).toBeInTheDocument();
    expect(screen.queryByText('Not enough ATR history')).not.toBeInTheDocument();
  });

  it('reports missing history instead of a zero ATR', () => {
    showATR(certified, { count: 5 });

    expect(screen.getByText('Not enough ATR history')).toBeInTheDocument();
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
  });
});
