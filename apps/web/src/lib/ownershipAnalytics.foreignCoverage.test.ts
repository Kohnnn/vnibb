import { buildOwnershipSummary, FOREIGN_WINDOW_SESSIONS } from './ownershipAnalytics'
import type { ForeignTradingData, ForeignTradingMeta, ShareholderData } from '@/types/equity'
import { parseForeignSessionDate, qualifyForeignFlowWindow } from './foreignFlowWindow'

const holder = { symbol: 'FPT', ownership_pct: 40, ownership_unit: 'percent', ownership_unit_status: 'explicit' } as unknown as ShareholderData

/** Exchange sessions ending 2026-05-29, newest first, excluding 2026 closures. */
function sessions(count: number): string[] {
  const days: string[] = []
  const holidays = ['2026-04-27', '2026-04-30', '2026-05-01']
  for (const day = new Date(Date.UTC(2026, 4, 29)); days.length < count; day.setUTCDate(day.getUTCDate() - 1)) {
    const date = day.toISOString().slice(0, 10)
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !holidays.includes(date)) days.push(date)
  }
  return days
}

type ForeignRowFixture = Pick<ForeignTradingData, 'date' | 'buy_volume' | 'sell_volume'>

function rows(dates: string[], buy = 100, sell = 40): ForeignRowFixture[] {
  return dates.map((date) => ({ date, buy_volume: buy, sell_volume: sell }))
}

function windowMeta(overrides: Partial<ForeignTradingMeta> = {}): ForeignTradingMeta {
  return {
    count: 20, window_contract: 'sessions-v2', calendar_verified: true,
    requested_session_count: 20, requested_start_date: '2026-05-04', requested_end_date: '2026-05-29',
    observed_session_count: 20, observed_start_date: '2026-05-04', observed_end_date: '2026-05-29',
    last_validated_session: '2026-05-29', gap_session_count: 0, null_session_count: 0,
    coverage_status: 'complete', window_net_volume: 1200, ...overrides,
  }
}

it('does not count legacy out-of-range and null rows as a 20-session window', () => {
  const history = rows(sessions(60))
  history[0] = { ...history[0], buy_volume: null }
  const summary = buildOwnershipSummary([holder], history, null, { count: history.length })

  expect(summary.foreignFlowCoverage).toEqual(expect.objectContaining({
    status: 'partial', windowVerified: false, observedSessions: null, gapSessions: null,
    startDate: '2026-03-04', endDate: '2026-05-29',
    warning: 'Retained history is not a verified session window',
  }))
  expect(summary.foreignNetVolume).toBeNull()
})

describe('ownershipAnalytics foreign-flow coverage (#249)', () => {
  it('labels a total 20D only when 20 distinct sessions are observed', () => {
    const dates = sessions(FOREIGN_WINDOW_SESSIONS)
    const summary = buildOwnershipSummary([holder], rows(dates), null, windowMeta())

    expect(summary.foreignFlowCoverage).toEqual(expect.objectContaining({
      requestedSessions: 20,
      observedSessions: 20,
      startDate: dates[19],
      endDate: dates[0],
      lastValidatedSession: dates[0],
      requestedStartDate: '2026-05-04', requestedEndDate: '2026-05-29',
      gapSessions: 0, nullSessions: 0, windowVerified: true, status: 'complete',
    }))
    expect(summary.foreignNetVolume).toBe(20 * 60)
    expect(summary.foreignFlowCoverage.warning).toBeNull()
  })

  it('withholds the 20D total and discloses partial coverage for a sparse window', () => {
    const dates = sessions(5)
    const meta = windowMeta({ count: 5, observed_session_count: 5, observed_start_date: dates[4], gap_session_count: 15, coverage_status: 'partial', window_net_volume: null })
    const summary = buildOwnershipSummary([holder], rows(dates), null, meta)

    expect(summary.foreignNetVolume).toBeNull()
    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignFlowCoverage.observedSessions).toBe(5)
    expect(summary.foreignFlowCoverage.gapSessions).toBe(15)
  })

  it('rejects weekend dates instead of counting or summing them', () => {
    // A malformed response includes weekends despite a claimed complete window.
    const weekdays = sessions(20)
    const meta = windowMeta({ count: 22, non_session_dates: ['2026-05-16', '2026-05-17'] })
    const summary = buildOwnershipSummary([holder], rows([...weekdays, '2026-05-16', '2026-05-17']), null, meta)

    expect(summary.foreignFlowCoverage.observedSessions).toBe(20)
    expect(summary.foreignFlowCoverage.status).toBe('partial')
    // Even a complete claim cannot certify a response containing rejected rows.
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('collapses a duplicated session date so it cannot inflate the count', () => {
    const dates = sessions(19)
    const meta = windowMeta({ count: 20, observed_session_count: 19, observed_start_date: dates[18], gap_session_count: 1, coverage_status: 'partial', window_net_volume: null, duplicate_session_dates: [dates[0]] })
    const summary = buildOwnershipSummary([holder], rows([...dates, dates[0]]), null, meta)

    expect(summary.foreignFlowCoverage.observedSessions).toBe(19)
    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('withholds a claimed complete total when an extra duplicate is present', () => {
    const dates = sessions(20)
    const duplicated = rows(dates).concat({ ...rows([dates[0]], 1_000_000, 0)[0] })
    const meta = windowMeta({ count: 21, duplicate_session_dates: [dates[0]] })
    const summary = buildOwnershipSummary([holder], duplicated, null, meta)
    expect(summary.foreignFlowCoverage.observedSessions).toBe(20)
    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('withholds a claimed complete total when an out-of-window row is returned', () => {
    const dates = sessions(20)
    const history = rows(dates).concat(rows(['2026-06-01'], 1_000_000, 0))
    const summary = buildOwnershipSummary([holder], history, null, windowMeta({ count: 21, out_of_window_row_count: 1 }))
    expect(summary.foreignFlowCoverage).toEqual(expect.objectContaining({
      status: 'partial', observedSessions: 20, startDate: '2026-05-04', endDate: '2026-05-29',
    }))
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('never assumes a missing date means today', () => {
    const dates = sessions(19)
    const meta = windowMeta({ count: 20, observed_session_count: 19, observed_start_date: dates[18], gap_session_count: 1, coverage_status: 'partial', window_net_volume: null, undated_row_count: 1 })
    const summary = buildOwnershipSummary([holder], rows(dates).concat({ buy_volume: 1e6, sell_volume: 0 }), null, meta)

    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignFlowCoverage.observedSessions).toBe(19)
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('rejects malformed or timestamp-suffixed date labels in a claimed complete packet', () => {
    const history = rows(sessions(20))
    history[0] = { ...history[0], date: '2026-05-29garbage' }
    const result = qualifyForeignFlowWindow(history, windowMeta(), 20)
    expect(result.rows).toHaveLength(19)
    expect(result.complete).toBe(false)
    expect(result.total).toBeNull()
    for (const invalid of ['2026-05-29garbage', '2026-05-29T00:00:00Z', '2026-02-30', ' 2026-05-29']) {
      expect(parseForeignSessionDate(invalid)).toBeNull()
    }
    expect(parseForeignSessionDate('2026-05-29')).toBe('2026-05-29')
  })

  it('keeps present null-volume sessions separate from missing sessions', () => {
    const dates = sessions(20)
    const history = rows(dates)
    history[3] = { ...history[3], buy_volume: null }
    const meta = windowMeta({ observed_session_count: 19, null_session_count: 1, gap_session_count: 0, coverage_status: 'partial', window_net_volume: null })
    const summary = buildOwnershipSummary([holder], history, null, meta)

    expect(summary.foreignFlowCoverage).toEqual(expect.objectContaining({
      status: 'partial', observedSessions: 19, gapSessions: 0, nullSessions: 1,
      startDate: '2026-05-04', endDate: '2026-05-29',
    }))
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('does not certify null volumes even when metadata claims complete coverage', () => {
    const history = rows(sessions(20))
    history[3] = { ...history[3], sell_volume: null }
    const summary = buildOwnershipSummary([holder], history, null, windowMeta())
    expect(summary.foreignFlowCoverage).toEqual(expect.objectContaining({
      status: 'partial', observedSessions: 19, gapSessions: 0, nullSessions: 1,
    }))
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('does not treat a verified 60-session response as the requested 20-session window', () => {
    const dates = sessions(60)
    const meta = windowMeta({
      count: 60, requested_session_count: 60, requested_start_date: '2026-03-04',
      observed_session_count: 60, observed_start_date: '2026-03-04', window_net_volume: 3600,
    })
    const summary = buildOwnershipSummary([holder], rows(dates), null, meta)
    expect(summary.foreignFlowCoverage).toEqual(expect.objectContaining({
      status: 'partial', windowVerified: false, observedSessions: null,
      startDate: '2026-03-04', endDate: '2026-05-29',
    }))
    expect(summary.foreignNetVolume).toBeNull()
  })

  it.each([
    { window_contract: 'latest_retained_rows' as const },
    { window_contract: undefined },
    { calendar_verified: false },
    { calendar_verified: undefined },
    { requested_start_date: null },
    { requested_end_date: null },
    { requested_session_count: 60 },
    { requested_start_date: '2026-05-30' },
    { coverage_status: undefined },
    { coverage_status: 'partial' as const },
    { gap_session_count: 1 },
    { gap_session_count: undefined },
    { observed_session_count: 19 },
  ])('withholds a total when required metadata is missing or contradictory: %j', (override) => {
    const summary = buildOwnershipSummary([holder], rows(sessions(20)), null, windowMeta(override))
    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('does not admit partial retained rows despite a response warning', () => {
    const dates = sessions(18)
    const meta = windowMeta({
      count: 18, observed_session_count: 18, observed_start_date: dates[17],
      gap_session_count: 2, coverage_status: 'partial', window_net_volume: null,
      warnings: ['live foreign trading feed unavailable'],
    })
    const summary = buildOwnershipSummary([holder], rows(dates), null, meta)

    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignFlowCoverage.observedSessions).toBe(18)
    expect(summary.foreignFlowCoverage.gapSessions).toBe(2)
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('stays unavailable when the source answered nothing', () => {
    const summary = buildOwnershipSummary([holder], [], null)

    expect(summary.foreignFlowCoverage.status).toBe('unavailable')
    expect(summary.foreignNetVolume).toBeNull()
  })
})
