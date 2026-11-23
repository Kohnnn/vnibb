import type { UseQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { exportToCSV, exportToJSON } from '@/lib/exportWidget';
import { useHistoricalPrices } from '@/lib/queries';
import { getWidgetExportData, type WidgetDataPayload } from '@/lib/widgetRuntime';
import type { EquityHistoricalData, EquityHistoricalResponse } from '@/types/equity';
import { GapFillStatsWidget } from './GapFillStatsWidget';
import { WidgetWrapper } from './WidgetWrapper';

jest.mock('@/lib/queries', () => ({ useHistoricalPrices: jest.fn(), useProfile: () => ({}) }));
jest.mock('@/lib/exportWidget', () => ({ exportToCSV: jest.fn(), exportToJSON: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ ANALYTICS_EVENTS: {}, captureAnalyticsEvent: jest.fn() }));
jest.mock('@/lib/dashboardIntelligence', () => ({ getWidgetLayoutInsight: () => null }));
jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ state: { dashboards: [{ id: 'dashboard', isEditable: false, tabs: [] }] } }),
}));
jest.mock('@/contexts/GlobalMarketsSymbolContext', () => ({
  useGlobalMarketsSymbol: () => ({ setGlobalMarketsSymbol: jest.fn() }),
}));
jest.mock('@/contexts/WidgetGroupContext', () => ({
  useWidgetGroups: () => ({ getSymbolForGroup: () => 'MSR', tickerOverrideFor: () => null }),
}));
jest.mock('./TickerCombobox', () => ({ TickerCombobox: () => null }));

const historicalQuery = jest.mocked(useHistoricalPrices);
const NOW = Date.parse('2026-11-09T12:00:00Z');
const HORIZON_DATES = [
  '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
  '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13',
  '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
  '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
  '2026-11-30', '2026-12-01', '2026-12-02',
];

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
afterEach(() => jest.restoreAllMocks());

function bar(time: string, price: number, changes: Partial<EquityHistoricalData> = {}): EquityHistoricalData {
  return {
    symbol: 'MSR', time, open: price, high: price + 5, low: price - 5, close: price, volume: 1000,
    price_unit: 'VND', adjustment_mode: 'adjusted', adjustment_applied: true, ...changes,
  };
}

function history(
  data: EquityHistoricalData[],
  expectedDates = data.map(row => row.time),
  meta: Partial<NonNullable<EquityHistoricalResponse['meta']>> = {},
): EquityHistoricalResponse {
  return {
    data,
    meta: {
      count: data.length,
      unit_status: 'confirmed_vnd', session_basis: 'adjusted', adjustment_mode: 'adjusted',
      calendar_verified: true, expected_session_dates: expectedDates,
      completeness_status: data.length === expectedDates.length ? 'complete' : 'partial',
      requested_start_date: expectedDates[0], requested_end_date: expectedDates.at(-1),
      excluded_row_count: 0, unresolved_session_count: 0, unresolved_excluded_dates: [], replaced_excluded_dates: [],
      ...meta,
    },
  };
}

function setHistoricalResponse(response: EquityHistoricalResponse, error: Error | null = null) {
  const result: Pick<UseQueryResult<EquityHistoricalResponse, Error>,
    'data' | 'isLoading' | 'isFetching' | 'dataUpdatedAt' | 'error' | 'refetch'> = {
    data: response, isLoading: false, isFetching: false, dataUpdatedAt: NOW, error, refetch: jest.fn(),
  };
  historicalQuery.mockReturnValue(result as UseQueryResult<EquityHistoricalResponse, Error>);
}

function showGapFill(response: EquityHistoricalResponse, queryError: Error | null = null) {
  setHistoricalResponse(response, queryError);
  const publish = jest.fn<void, [WidgetDataPayload]>();
  render(<GapFillStatsWidget symbol="msr" onDataChange={publish} />);
  const payload = publish.mock.lastCall?.[0];
  if (!payload) throw new Error('Expected Gap Fill Stats to publish its runtime');
  return { runtime: payload.__widgetRuntime, exported: getWidgetExportData(payload) };
}

function historyWithInteriorExclusion() {
  // Nov 6 touches the pre-gap close, but the missing Nov 5 prevents confirming that fill.
  return history([
    bar('2026-11-02', 1000), bar('2026-11-03', 1100), bar('2026-11-04', 1100),
    bar('2026-11-06', 1100, { low: 990 }), bar('2026-11-09', 1000, { high: 1100 }),
  ], HORIZON_DATES.slice(0, 6), {
    excluded_row_count: 2, unresolved_session_count: 1, unresolved_excluded_dates: ['2026-11-05'],
    missing_session_count: 1, missing_leading_sessions: 0, missing_interior_sessions: 1, missing_trailing_sessions: 0,
  });
}

it('requests adjusted daily history and measures one elapsed session across an exchange holiday and weekend', () => {
  const { runtime, exported } = showGapFill(history([
    bar('2026-04-28', 20000), bar('2026-04-29', 30000), bar('2026-05-04', 30000, { low: 20000 }),
  ], undefined, { fallback_used: true, warnings: ['Admitted observations include a verified fallback'] }));

  expect(historicalQuery).toHaveBeenCalledWith('MSR', expect.objectContaining({ adjustmentMode: 'adjusted', interval: '1D' }));
  expect(screen.getByText('+50.00%')).toBeInTheDocument();
  expect(screen.getByText('Filled: 1 trading session')).toBeInTheDocument();
  expect(screen.getByText(/Complete historical window.*2026-04-28 to 2026-05-04/)).toBeInTheDocument();
  expect(runtime?.provenance).toMatchObject({
    coverage: 'complete', adjustmentMode: 'adjusted', updatedAt: '2026-05-04',
    coverageDetail: {
      requestedStart: '2026-04-28', requestedEnd: '2026-05-04', observedSessions: 3,
      requestedSessions: 3, gapSessions: 0, calendarVerified: true,
    },
    warnings: expect.arrayContaining(['Historical source fallback used', 'Admitted observations include a verified fallback']),
  });
  expect(exported).toMatchObject({
    eligibleComparisons: 2, excludedComparisons: 0, comparisonStart: '2026-04-29', comparisonEnd: '2026-05-04',
    gaps: 1, resolvedGaps: 1, fillRatePct: 100, avgFillTradingSessions: 1, followUpTradingSessions: 20,
  });
});

it('withholds when sparse rows cannot form any overnight comparison', () => {
  const { runtime, exported } = showGapFill(history([
    bar('2026-11-02', 1000), bar('2026-11-06', 1100), bar('2026-11-16', 1100, { low: 990 }),
  ], HORIZON_DATES.slice(0, 11)));

  expect(screen.getByText(/0 eligible comparisons · 10 excluded/)).toBeInTheDocument();
  expect(screen.getByText('Gap statistics withheld')).toBeInTheDocument();
  expect(screen.queryByText('Fill rate (resolved)')).not.toBeInTheDocument();
  expect(runtime).toMatchObject({
    layoutHint: { empty: true },
    provenance: { coverage: 'partial', observationStatus: 'unavailable', coverageDetail: { gapSessions: 8 } },
  });
  expect(exported).toBeNull();
});

it('stops follow-up at an unresolved session, keeping a later eligible same-session fill', () => {
  const { runtime, exported } = showGapFill(historyWithInteriorExclusion());

  expect(screen.getByText('Censored after 2026-11-04')).toBeInTheDocument();
  expect(screen.getByText('Filled: same session (0)')).toBeInTheDocument();
  expect(screen.getByText('0.0')).toBeInTheDocument();
  expect(screen.getByText(/1 filled · 0 unfilled · 1 censored/)).toBeInTheDocument();
  expect(runtime?.provenance).toMatchObject({
    coverage: 'partial',
    coverageDetail: { requestedSessions: 6, observedSessions: 5, gapSessions: 1, observedEnd: '2026-11-09' },
    warnings: expect.arrayContaining([
      expect.stringContaining('0 leading, 1 interior, 0 trailing'),
      expect.stringContaining('excluded rows: 2; replaced dates: 0; unresolved dates: 1'),
      expect.stringContaining('excluded from fill rates'),
    ]),
  });
  expect(exported).toMatchObject({
    eligibleComparisons: 3, excludedComparisons: 2, gaps: 2,
    filledGaps: 1, unfilledGaps: 0, censoredGaps: 1, resolvedGaps: 1, fillRatePct: 100, avgFillTradingSessions: 0,
    upResolvedGaps: 0, upFillRatePct: null, downResolvedGaps: 1, downFillRatePct: 100,
  });
});

it('censors at the requested endpoint despite complete historical coverage', () => {
  const { runtime, exported } = showGapFill(history([
    bar('2026-11-02', 1000), bar('2026-11-03', 1100), bar('2026-11-04', 1100),
  ]));

  expect(screen.getByText('Censored after 2026-11-04')).toBeInTheDocument();
  expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  expect(runtime?.provenance?.coverage).toBe('complete');
  expect(exported).toMatchObject({
    filledGaps: 0, unfilledGaps: 0, censoredGaps: 1, resolvedGaps: 0, fillRatePct: null, avgFillTradingSessions: null,
  });
});

it.each([
  ['2026-12-01', 'Filled: 20 trading sessions', 1, 0, 100, 20],
  ['2026-12-02', 'Unfilled through 2026-12-01', 0, 1, 0, null],
] as const)('resolves a fully observed horizon when the first price touch is on %s', (fillDate, label, filled, unfilled, rate, average) => {
  const { exported } = showGapFill(history(HORIZON_DATES.map((time, i) =>
    bar(time, i === 0 ? 1000 : 1100, time === fillDate ? { low: 1000 } : {}),
  )));

  expect(screen.getByText(label)).toBeInTheDocument();
  expect(exported).toMatchObject({
    gaps: 1, resolvedGaps: 1, filledGaps: filled, unfilledGaps: unfilled, censoredGaps: 0,
    fillRatePct: rate, avgFillTradingSessions: average,
  });
});

it('computes rates over fills and observed failures, and includes zero-session fills in the mean', () => {
  const { exported } = showGapFill(history(HORIZON_DATES.map((time, i) => {
    if (i === 0) return bar(time, 1000);
    if (i === 2) return bar(time, 1100, { open: 1080, low: 1075 });
    if (i === 3) return bar(time, 1070);
    if (i === 4) return bar(time, 1070, { high: 1100 });
    return bar(time, i === 22 ? 1200 : i > 4 ? 1070 : 1100);
  })));

  expect(screen.getByText('2 filled · 1 unfilled · 1 censored')).toBeInTheDocument();
  expect(screen.getByText('66.7%')).toBeInTheDocument();
  expect(screen.getByText('0.5')).toBeInTheDocument();
  expect(exported).toMatchObject({
    gaps: 4, resolvedGaps: 3, avgFillTradingSessions: 0.5,
    upResolvedGaps: 1, upFillRatePct: 0, downResolvedGaps: 2, downFillRatePct: 100,
  });
});

it('keeps a proven fill despite boundary holes and discloses a failed refresh separately', () => {
  const { runtime, exported } = showGapFill(history([
    bar('2026-11-03', 1000), bar('2026-11-04', 1100, { low: 1000 }), bar('2026-11-05', 1100),
  ], HORIZON_DATES.slice(0, 5)), new Error('Refresh failed'));

  expect(screen.getByText(/1 leading, 0 interior, 1 trailing.*Latest historical refresh failed/)).toBeInTheDocument();
  expect(runtime?.provenance).toMatchObject({
    coverage: 'partial', refreshStatus: 'failed', cached: true, updatedAt: '2026-11-05',
    coverageDetail: { observedStart: '2026-11-03', observedEnd: '2026-11-05', gapSessions: 2 },
  });
  expect(exported).toMatchObject({ gaps: 1, filledGaps: 1, censoredGaps: 0, avgFillTradingSessions: 0 });
});

it('lets an admitted same-date replacement restore continuity without ignoring source exclusions', () => {
  const { runtime, exported } = showGapFill(history([
    bar('2026-11-02', 1000), bar('2026-11-03', 1000), bar('2026-11-04', 1100, { low: 1000 }),
  ], undefined, { excluded_row_count: 2, replaced_excluded_dates: ['2026-11-03'] }));

  expect(screen.getByText(/excluded rows: 2; replaced dates: 1; unresolved dates: 0/)).toBeInTheDocument();
  expect(runtime?.provenance?.coverage).toBe('complete');
  expect(exported).toMatchObject({ eligibleComparisons: 2, excludedComparisons: 0, filledGaps: 1 });
});

it('treats malformed OHLC as a hole even when the producer reports complete rows', () => {
  const { runtime, exported } = showGapFill(history([
    bar('2026-11-02', 1000), bar('2026-11-03', 1100, { low: 1110 }),
    bar('2026-11-04', 1100), bar('2026-11-05', 1100),
  ]));

  expect(screen.getByText(/Unusable OHLC rows: 1/)).toBeInTheDocument();
  expect(runtime?.provenance?.coverage).toBe('partial');
  expect(exported).toMatchObject({ eligibleComparisons: 1, excludedComparisons: 2, gaps: 0 });
});

it('reports an observed zero gap count, not a zero rate or duration, on eligible index-point history', () => {
  const { runtime, exported } = showGapFill(history([
    bar('2026-11-02', 1000, { price_unit: 'index_points', adjustment_applied: false, raw_close: 1000 }),
    bar('2026-11-03', 1000, { price_unit: 'index_points', adjustment_applied: false, raw_close: 1000 }),
  ], undefined, { unit_status: 'not_applicable', session_basis: 'not_applicable' }));

  expect(screen.getByText('No qualifying gaps among eligible comparisons')).toBeInTheDocument();
  expect(runtime?.provenance?.basis).toMatch(/^Index points \(adjustment not applicable\)/);
  expect(exported).toMatchObject({ eligibleComparisons: 1, gaps: 0, fillRatePct: null, avgFillTradingSessions: null });
});

it.each([
  { name: 'unknown calendar in the selected 1Y window', meta: { calendar_verified: false, expected_session_dates: null },
    reason: /Exchange sessions are not certified for the selected 1Y window/ },
  { name: 'a raw/unverified basis', meta: { session_basis: 'unverified', adjustment_mode: 'raw' }, reason: /price basis is unverified/ },
  { name: 'mixed series units', meta: { unit_status: 'mixed' }, reason: /price units were not certified/ },
  { name: 'unconfirmed series units', meta: { unit_status: 'unconfirmed' }, reason: /price units were not certified/ },
  { name: 'a missing per-row unit marker', row: { price_unit: undefined }, reason: /price units were not certified/ },
  { name: 'a raw/adjusted discontinuity despite an adjusted envelope', row: { adjustment_mode: 'raw', adjustment_applied: false },
    reason: /price basis is unverified or mixed/ },
] satisfies {
  name: string; meta?: Partial<NonNullable<EquityHistoricalResponse['meta']>>; row?: Partial<EquityHistoricalData>; reason: RegExp;
}[])('withholds metrics for $name even when the surviving rows look plausible', ({ meta, row, reason }) => {
  const { runtime, exported } = showGapFill(history([
    bar('2026-11-02', 20000), bar('2026-11-03', 30000, { low: 20000, ...row }),
  ], undefined, meta));

  expect(screen.getByText(reason)).toBeInTheDocument();
  expect(screen.getByText('Gap statistics withheld')).toBeInTheDocument();
  expect(screen.queryByText('Fill rate (resolved)')).not.toBeInTheDocument();
  expect(runtime?.provenance?.observationStatus).toBe('unavailable');
  expect(exported).toBeNull();
});

it('honors an envelope error even with otherwise qualified rows without publishing transport detail', () => {
  const { runtime, exported } = showGapFill({
    ...history([bar('2026-11-02', 1000), bar('2026-11-03', 1100)]),
    error: 'Provider transport diagnostic',
  });

  expect(screen.getByText('Historical price request failed.')).toBeInTheDocument();
  expect(screen.queryByText('Provider transport diagnostic')).not.toBeInTheDocument();
  expect(runtime?.provenance).toMatchObject({ observationStatus: 'unavailable', refreshStatus: 'failed', admissionReason: 'Historical price request failed.' });
  expect(screen.getByText('Gap statistics unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  expect(exported).toBeNull();
});

it('gives the toolbar, CSV/JSON and VniAgent the same summary and replaces it when withheld', async () => {
  setHistoricalResponse(historyWithInteriorExclusion());
  const askAgent = jest.fn();
  const user = userEvent.setup();
  render(
    <WidgetWrapper id="gap" widgetType="gap_fill_stats" title="Gap Fill Stats" dashboardId="dashboard" tabId="tab"
      showGroupLabels={false} onCopilotClick={askAgent} data={{ rawFallback: 999 }}>
      <GapFillStatsWidget symbol="MSR" />
    </WidgetWrapper>
  );
  const exportSummary = async (format: 'CSV' | 'JSON') => {
    await user.click(screen.getByRole('button', { name: 'Widget actions for Gap Fill Stats' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export' }));
    await user.click(screen.getByRole('menuitem', { name: `Export as ${format}` }));
  };
  const provenance = expect.objectContaining({
    coverage: 'partial', observationStatus: 'available', basis: expect.stringContaining('20 trading sessions'),
    coverageDetail: expect.objectContaining({ gapSessions: 1, calendarVerified: true }),
  });
  const metrics = expect.objectContaining({ gaps: 2, filledGaps: 1, censoredGaps: 1, resolvedGaps: 1, avgFillTradingSessions: 0 });

  await screen.findByRole('button', { name: 'Data status: Partial coverage' });
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  expect(askAgent).toHaveBeenLastCalledWith(expect.objectContaining({ dataSample: metrics, dataProvenance: provenance }));
  await exportSummary('CSV');
  expect(exportToCSV).toHaveBeenLastCalledWith([metrics], expect.any(String), provenance);
  await exportSummary('JSON');
  expect(exportToJSON).toHaveBeenLastCalledWith(metrics, expect.any(String), provenance);

  setHistoricalResponse(history([bar('2026-11-02', 1000)], undefined, { calendar_verified: false, expected_session_dates: null }));
  await user.click(screen.getByRole('button', { name: '6M' }));
  await screen.findByRole('button', { name: 'Data status: Unavailable' });
  await user.click(screen.getByRole('button', { name: 'Open VniAgent' }));
  const unavailable = expect.objectContaining({ observationStatus: 'unavailable', admissionReason: expect.stringContaining('selected 6M window') });
  expect(askAgent).toHaveBeenLastCalledWith(expect.objectContaining({ dataSample: null, dataProvenance: unavailable }));
  await exportSummary('JSON');
  expect(exportToJSON).toHaveBeenLastCalledWith(null, expect.any(String), unavailable);
  jest.mocked(exportToCSV).mockClear();
  await exportSummary('CSV');
  expect(exportToCSV).not.toHaveBeenCalled();
});
