import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useHistoricalPrices } from '@/lib/queries';
import { formatAbsoluteTimestamp } from '@/lib/formatDate';
import { getWidgetExportData } from '@/lib/widgetRuntime';
import type { EquityHistoricalResponse } from '@/types/equity';
import { ATRRegimeWidget } from './ATRRegimeWidget';

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn() }));

const historicalQuery = jest.mocked(useHistoricalPrices);
const receivedAt = Date.parse('2026-10-05T10:00:00Z');
const sessions = Array.from({ length: 60 }, (_, index) => new Date(Date.UTC(2026, 5, 8 + index)))
  .filter((day) => day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
  .map((day) => day.toISOString().slice(0, 10)).slice(0, 40);
const certified = {
  count: 40, unit_status: 'confirmed_vnd', calendar_verified: true, expected_session_dates: sessions,
  session_basis: 'adjusted', excluded_row_count: 0, unresolved_session_count: 0,
  unresolved_excluded_dates: [], replaced_excluded_dates: [],
} satisfies NonNullable<EquityHistoricalResponse['meta']>;
const unavailableText = /ATR regime unavailable/;

type Options = {
  datesMissing?: boolean;
  error?: Error | null;
  count?: number;
  flat?: boolean;
  /** Drop per-row price_unit so certified metadata has no row-level proof. */
  rowsMissingUnitProof?: boolean;
  skipSession?: string;
  index?: boolean;
};

function bars(count: number, options: Options) {
  return Array.from({ length: count }, (_, index) => {
    const row = {
      symbol: 'FPT',
      time: options.datesMissing ? '' : sessions[index],
      open: 100000,
      high: options.flat ? 100000 : 110000,
      low: options.flat ? 100000 : 90000,
      close: 100000,
      volume: 1000,
      price_unit: options.index ? 'index_points' as const : 'VND' as const,
      adjustment_mode: 'adjusted' as const,
      adjustment_applied: true,
    };
    return options.rowsMissingUnitProof ? { ...row, price_unit: undefined } : row;
  }).filter((row) => row.time !== options.skipSession);
}

function showATR(meta: NonNullable<EquityHistoricalResponse['meta']>, options: Options = {}) {
  historicalQuery.mockReturnValue({
    data: { data: bars(options.count ?? 40, options), meta },
    isLoading:false, isFetching:false,
    error: options.error ?? null, refetch: jest.fn(), dataUpdatedAt: receivedAt,
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
  const publish = jest.fn();
  render(<ATRRegimeWidget symbol="FPT" onDataChange={publish} />);
  return publish;
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
    showATR({ ...certified, freshness_as_of: '2026-07-31', last_data_date: '2026-10-05' });

    expect(screen.getByText('As of 2026-07-31')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText(`Fetched ${formatAbsoluteTimestamp(new Date(receivedAt))}`)).toBeInTheDocument();
  });

  it('uses last_data_date when freshness_as_of is absent', () => {
    showATR({ ...certified, last_data_date: '2026-07-30' });
    expect(screen.getByText('As of 2026-07-30')).toBeInTheDocument();
  });

  it('uses the final returned bar when metadata dates are absent or invalid', () => {
    showATR({ ...certified, freshness_as_of: 'invalid', last_data_date: null });

    expect(screen.getByText('As of 2026-07-31')).toBeInTheDocument();
  });

  it('does not present the receipt time as a source observation date', () => {
    showATR(certified, { datesMissing:true });

    expect(screen.getByText('As-of unknown')).toBeInTheDocument();
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
    showATR({ ...certified, unresolved_excluded_dates: [sessions[4]], unresolved_session_count: 1 }, { skipSession: sessions[4] });

    expect(screen.getAllByText(unavailableText).length).toBeGreaterThan(0);
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
  });

  it('does not certify a returned bar also reported as unresolved', () => {
    const publish = showATR({ ...certified, unresolved_excluded_dates: [sessions[4]], unresolved_session_count: 1 });
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({ status: 'unavailable', atr: null });
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
  });

  it('withholds older envelopes missing calendar proof, not just uncertified units', () => {
    const publish = showATR({ count: 40, unit_status: 'confirmed_vnd' });
    expect(screen.getByText('ATR regime unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({ status: 'unavailable', atr: null, rank: null });
  });

  it('accepts trailing range incompleteness but names the stale retained sample', () => {
    const publish = showATR({ ...certified, completeness_status: 'partial', missing_trailing_sessions: 2, missing_session_count: 2 }, { count: 38 });
    expect(screen.getByText(/38 consecutive sessions/)).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({ status: 'available', admittedSessions: 38, historyCount: 25 });
  });

  it('does not invent a share sizing recommendation for index-point history', () => {
    const publish = showATR({ ...certified, unit_status: 'not_applicable', session_basis: 'not_applicable' }, { index: true });
    expect(screen.getByText('ATR %')).toBeInTheDocument();
    expect(screen.queryByText('Suggested Shares')).not.toBeInTheDocument();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({ status: 'available', suggestedShares: null });
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
    const publish = showATR(certified, { flat: true });

    expect(screen.getByText('Sizing Model')).toBeInTheDocument();
    expect(screen.queryByText('Not enough ATR history')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggested Shares')).not.toBeInTheDocument();
    expect(getWidgetExportData(publish.mock.lastCall?.[0])).toMatchObject({ atr: 0, atrPct: 0, suggestedShares: null });
  });

  it('reports missing history instead of a zero ATR', () => {
    showATR(certified, { count: 5 });

    expect(screen.getByText('Not enough ATR history')).toBeInTheDocument();
    expect(screen.queryByText('Sizing Model')).not.toBeInTheDocument();
  });
});
