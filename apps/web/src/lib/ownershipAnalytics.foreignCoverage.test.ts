import { buildOwnershipSummary, FOREIGN_WINDOW_SESSIONS } from './ownershipAnalytics'
import type { ForeignTradingMeta, ShareholderData } from '@/types/equity'

const holder = { symbol: 'FPT', ownership_pct: 40, ownership_unit: 'percent', ownership_unit_status: 'explicit' } as unknown as ShareholderData

/** Weekday sessions ending 2026-05-29, newest first. */
function sessions(count: number): string[] {
  const days: string[] = []
  for (const day = new Date(Date.UTC(2026, 4, 29)); days.length < count; day.setUTCDate(day.getUTCDate() - 1)) {
    const weekday = day.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days.push(day.toISOString().slice(0, 10))
  }
  return days
}

function rows(dates: string[], buy = 100, sell = 40) {
  return dates.map((date) => ({ date, buy_volume: buy, sell_volume: sell }))
}

describe('ownershipAnalytics foreign-flow coverage (#249)', () => {
  it('labels a total 20D only when 20 distinct sessions are observed', () => {
    const dates = sessions(FOREIGN_WINDOW_SESSIONS)
    const summary = buildOwnershipSummary([holder], rows(dates), null)

    expect(summary.foreignFlowCoverage).toEqual(expect.objectContaining({
      requestedSessions: 20,
      observedSessions: 20,
      startDate: dates[19],
      endDate: dates[0],
      lastValidatedSession: dates[0],
      status: 'complete',
    }))
    expect(summary.foreignNetVolume).toBe(20 * 60)
    expect(summary.foreignFlowCoverage.warning).toBeNull()
  })

  it('withholds the 20D total and discloses partial coverage for a sparse window', () => {
    const dates = sessions(5)
    const summary = buildOwnershipSummary([holder], rows(dates), null)

    expect(summary.foreignNetVolume).toBeNull()
    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignFlowCoverage.observedSessions).toBe(5)
    expect(summary.foreignFlowCoverage.gapSessions).toBe(15)
    expect(summary.foreignFlowCoverage.warning).toContain('5/20 sessions observed')
  })

  it('rejects weekend dates instead of counting or summing them', () => {
    // 2026-05-30/31 are the weekend; only the 20 weekdays may qualify.
    const weekdays = sessions(20)
    const summary = buildOwnershipSummary([holder], rows([...weekdays, '2026-05-30', '2026-05-31']), null)

    expect(summary.foreignFlowCoverage.observedSessions).toBe(20)
    expect(summary.foreignFlowCoverage.warning).toContain('2 non-session date(s) excluded')
    // A rejected weekend row may not be summed into the window.
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('collapses a duplicated session date so it cannot inflate the count', () => {
    const dates = sessions(19)
    const summary = buildOwnershipSummary([holder], rows([...dates, dates[0]]), null)

    expect(summary.foreignFlowCoverage.observedSessions).toBe(19)
    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('never assumes a missing date means today', () => {
    const dates = sessions(19)
    const summary = buildOwnershipSummary([holder], rows(dates).concat({ buy_volume: 1e6, sell_volume: 0 }), null)

    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignFlowCoverage.warning).toContain('without a parsable date excluded')
    expect(summary.foreignNetVolume).toBeNull()
  })

  it('honours the requested session count reported by the server', () => {
    const dates = sessions(20)
    const meta: ForeignTradingMeta = {
      count: dates.length,
      requested_session_count: 20,
      observed_session_count: 20,
      gap_session_count: 0,
      last_validated_session: dates[0],
    }
    expect(buildOwnershipSummary([holder], rows(dates), null, meta).foreignNetVolume).toBe(1200)
  })

  it('keeps a response-level fallback warning even when rows were retained', () => {
    const dates = sessions(20)
    const meta: ForeignTradingMeta = {
      count: dates.length,
      observed_session_count: 18,
      gap_session_count: 2,
      warnings: ['live foreign trading feed unavailable'],
    }
    const summary = buildOwnershipSummary([holder], rows(dates.slice(0, 18)), null, meta)

    expect(summary.foreignFlowCoverage.status).toBe('partial')
    expect(summary.foreignNetVolume).toBeNull()
    expect(summary.foreignFlowCoverage.warning).toContain('18/20 sessions observed')
  })

  it('stays unavailable when the source answered nothing', () => {
    const summary = buildOwnershipSummary([holder], [], null)

    expect(summary.foreignFlowCoverage.status).toBe('unavailable')
    expect(summary.foreignNetVolume).toBeNull()
  })
})
