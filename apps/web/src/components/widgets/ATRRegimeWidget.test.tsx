import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useHistoricalPrices } from '@/lib/queries';
import { formatAbsoluteTimestamp } from '@/lib/format';
import type { EquityHistoricalResponse } from '@/types/equity';
import { ATRRegimeWidget } from './ATRRegimeWidget';

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn() }));

const historicalQuery = jest.mocked(useHistoricalPrices);
const receivedAt = Date.parse('2026-10-05T10:00:00Z');

function showATR(meta?: EquityHistoricalResponse['meta'], datesMissing = false, error: Error | null = null) {
  const candles = Array.from({ length: 40 }, (_, index) => ({
    symbol: 'FPT',
    time: datesMissing ? '' : new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
    open: 100000, high: 110000, low: 90000, close: 105000, volume: 1000,
  }));
  historicalQuery.mockReturnValue({
    data: { data: candles, meta }, isLoading: false, isFetching: false,
    error, refetch: jest.fn(), dataUpdatedAt: receivedAt,
  } as unknown as UseQueryResult<EquityHistoricalResponse, Error>);
  const onDataChange = jest.fn();
  render(<ATRRegimeWidget symbol="FPT" onDataChange={onDataChange} />);
  return onDataChange;
}

function expectProvenance(onDataChange: jest.Mock, provenance: Record<string, unknown>) {
  expect(onDataChange).toHaveBeenLastCalledWith(expect.objectContaining({
    __widgetRuntime: expect.objectContaining({ provenance: expect.objectContaining(provenance) }),
  }));
}

describe('ATR historical observation metadata', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(receivedAt);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks old observations fetched now stale and prefers backend freshness over receipt time', () => {
    const observationDate = '2024-02-09';
    const onDataChange = showATR({ count: 40, freshness_as_of: observationDate, last_data_date: '2026-10-05' });

    expectProvenance(onDataChange, { updatedAt: observationDate, stale: true });
    expect(screen.getByText(`Updated ${formatAbsoluteTimestamp(new Date(observationDate))}`)).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.queryByText(`Updated ${formatAbsoluteTimestamp(new Date(receivedAt))}`)).not.toBeInTheDocument();
  });

  it('uses last_data_date when freshness_as_of is absent', () => {
    const onDataChange = showATR({ count: 40, last_data_date: '2024-02-08' });

    expectProvenance(onDataChange, { updatedAt: '2024-02-08', stale: true });
  });

  it('uses the final returned bar when metadata dates are absent or invalid', () => {
    const onDataChange = showATR({ count: 40, freshness_as_of: 'invalid', last_data_date: null });

    expectProvenance(onDataChange, { updatedAt: '2024-02-09', stale: true });
  });

  it('does not substitute query receipt time when no observation dates exist', () => {
    const onDataChange = showATR({ count: 40, freshness_as_of: null, last_data_date: null }, true);

    expectProvenance(onDataChange, {
      updatedAt: undefined,
      stale: false,
      warnings: ['Historical observation date unavailable'],
    });
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.getByText(/Historical observation date unavailable/)).toBeInTheDocument();
  });

  it.each([
    ['mixed', 'Mixed historical price units'],
    ['unconfirmed', 'Historical price units unconfirmed'],
  ] as const)('carries partial coverage, %s units, and fallback warnings visibly and in provenance', (unitStatus, unitWarning) => {
    const onDataChange = showATR({
      count: 40, freshness_as_of: '2026-10-05T09:00:00Z',
      completeness_status: 'partial', unit_status: unitStatus, fallback_used: true,
      warnings: ['Internal trading-day gap'], adjustment_warning: 'Adjustment coverage incomplete',
    });
    const warnings = [
      'Internal trading-day gap', 'Partial historical coverage', unitWarning,
      'Historical source fallback used', 'Adjustment coverage incomplete',
    ];

    expectProvenance(onDataChange, { warnings, stale: false, cached: false });
    for (const warning of warnings) expect(screen.getByText(new RegExp(warning))).toBeInTheDocument();
  });

  it('keeps refresh-failure fallback distinct from backend source fallback', () => {
    const onDataChange = showATR({ count: 40, freshness_as_of: '2026-10-05T09:00:00Z' }, false, new Error('Refresh failed'));

    expectProvenance(onDataChange, {
      updatedAt: '2026-10-05T09:00:00Z', cached: true, stale: true,
      warnings: ['Latest historical refresh failed; showing previous observations'],
    });
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText(/Latest historical refresh failed/)).toBeInTheDocument();
  });
});
