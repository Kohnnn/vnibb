import { describeForeignFlow } from './foreignFlowProvenance';
import { deriveWidgetHealth } from './widgetHealth';
import { provenanceLines } from './widgetProvenance';

const saturday = '2026-11-14T03:00:00Z';
const fridayClosure = {
  date: '2026-11-13',
  checked_at: saturday,
  valid_until: '2026-11-16T02:00:00Z',
};

function describeWindow(now: string, session: string, closure?: typeof fridayClosure) {
  const fetchedAt = Date.parse(now);
  jest.spyOn(Date, 'now').mockReturnValue(fetchedAt);
  const meta = {
    count: 1,
    requested_start_date: session, requested_end_date: session,
    requested_session_count: 1, observed_session_count: 1, gap_session_count: 0,
    last_validated_session: session, last_data_date: session,
    calendar_verified: true, window_contract: 'sessions-v2', coverage_status: 'complete',
    latest_closed_session: closure,
  } as const;
  return describeForeignFlow({
    response: {
      symbol: 'HPG', count: 1, meta,
      data: [{ symbol: 'HPG', date: session, buy_volume: 1200, sell_volume: 1200 }],
    },
    fetchedAt, requestedSessions: 1,
    requestFailed: false, isLoading: false, isFetching: false,
  });
}

describe('foreign flow session provenance', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps a complete historical window without certifying it as the latest closed session', () => {
    const result = describeWindow(saturday, '2026-11-06', fridayClosure);

    expect(result).toMatchObject({
      coverage: 'complete',
      coverageDetail: { requestedEnd: '2026-11-06', gapSessions: 0 },
      updatedAt: '2026-11-06', fetchedAt: Date.parse(saturday),
      marketClosed: true, expectedClosedSession: false,
      stale: true, cached: false, refreshStatus: 'succeeded',
    });
    expect(deriveWidgetHealth(result).status).toBe('stale');
  });

  it('does not claim either open or closed when a legacy envelope only verifies the window', () => {
    const result = describeWindow(saturday, '2026-11-06');

    expect(result.coverage).toBe('complete');
    expect(result.coverageDetail?.requestedEnd).toBe('2026-11-06');
    expect(result.marketClosed).toBeUndefined();
    expect(result.expectedClosedSession).toBe(false);
    expect(provenanceLines(result).some(([name]) => name === 'market_closed')).toBe(false);
  });

  it('rejects an old complete response and its as-of and closure claims', () => {
    const response = {
      symbol: 'HPG', count: 1,
      data: [{ symbol: 'HPG', date: fridayClosure.date, buy_volume: 0, sell_volume: 0 }],
      meta: { count: 1, window_contract: 'sessions' as const, calendar_verified: true,
        requested_session_count: 1, requested_start_date: fridayClosure.date, requested_end_date: fridayClosure.date,
        observed_session_count: 1, gap_session_count: 0, coverage_status: 'complete' as const,
        last_validated_session: fridayClosure.date, last_data_date: fridayClosure.date, latest_closed_session: fridayClosure },
    };
    const result = describeForeignFlow({ response, requestFailed: false, isLoading: false, isFetching: false, fetchedAt: Date.parse(saturday), requestedSessions: 1 }, Date.parse(saturday));
    expect(result).toMatchObject({ updatedAt: null, coverage: 'partial', expectedClosedSession: false,
      coverageDetail: { requestedSessions: 1, observedSessions: null, calendarVerified: null, lastValidatedSession: null } });
    expect(result.marketClosed).toBeUndefined();
  });

  it('honors a verified holiday closure during ordinary weekday trading hours', () => {
    const holidayAfternoon = '2026-09-02T06:00:00Z'; // 13:00 ICT
    const result = describeWindow(holidayAfternoon, '2026-08-28', {
      date: '2026-08-28', checked_at: holidayAfternoon, valid_until: '2026-09-03T02:00:00Z',
    });

    expect(result).toMatchObject({ marketClosed: true, expectedClosedSession: true, stale: false });
    expect(provenanceLines(result)).toContainEqual(['market_closed', 'true']);
    expect(deriveWidgetHealth(result).status).toBe('awaiting_update');
  });

  it('does not reuse a closure at the exact reopening boundary', () => {
    const result = describeWindow(fridayClosure.valid_until, fridayClosure.date, fridayClosure);

    expect(result.marketClosed).toBeUndefined();
    expect(result.expectedClosedSession).toBe(false);
    expect(result.coverage).toBe('complete');
  });
});
