import type { DividendRecord } from '@/lib/api'
import {
  DIVIDEND_LADDER_LIMIT,
  buildDividendEvents,
  getVnDayKey,
  resolveDividendActionDay,
  selectDividendLadder,
  type DividendLadderSelection,
} from './dividendLadder'

const PAYOUT = () => ({ payoutLabel: '1,000 đ', payoutType: 'Cash' })

const events = (rows: DividendRecord[]) => buildDividendEvents(rows, PAYOUT)

const days = (selection: DividendLadderSelection) =>
  selection.events.map((event) => `${event.day} ${event.type}`)

describe('resolveDividendActionDay', () => {
  it('keeps a date-only value on its own VN calendar day', () => {
    expect(resolveDividendActionDay('2022-07-06')).toBe('2022-07-06')
    expect(resolveDividendActionDay(' 2026-11-13 ')).toBe('2026-11-13')
  })

  it('maps an offset timestamp to the VN day containing that instant', () => {
    // 17:30Z is already 00:30 on the next day in ICT.
    expect(resolveDividendActionDay('2026-11-13T17:30:00Z')).toBe('2026-11-14')
    expect(resolveDividendActionDay('2026-11-13T10:00:00+07:00')).toBe('2026-11-13')
  })

  it('keeps the literal date part of a naive timestamp', () => {
    expect(resolveDividendActionDay('2026-11-13T00:00:00')).toBe('2026-11-13')
  })

  it.each(['', '   ', 'not-a-date', '2022-13-01', '2022-02-30', '2022/07/06', '06-07-2022'])(
    'returns null for malformed %p',
    (raw) => {
      expect(resolveDividendActionDay(raw)).toBeNull()
    },
  )

  it('returns null for absent values', () => {
    expect(resolveDividendActionDay(null)).toBeNull()
    expect(resolveDividendActionDay(undefined)).toBeNull()
  })
})

describe('selectDividendLadder — history', () => {
  // #259: 12 monthly payments, none upcoming. The old widget rendered the
  // first eight ascending rows and called the oldest of them "Latest events".
  const twelvePayments: DividendRecord[] = Array.from({ length: 12 }, (_, index) => ({
    payment_date: `2025-${String(index + 1).padStart(2, '0')}-01`,
  }))

  it('takes the newest events, not the oldest retained ones', () => {
    const selection = selectDividendLadder(events(twelvePayments), '2026-11-13')

    expect(selection.mode).toBe('latest')
    expect(selection.label).toBe('Latest events')
    expect(selection.events).toHaveLength(DIVIDEND_LADDER_LIMIT)
    expect(selection.events[0].day).toBe('2025-12-01')
    expect(selection.events[7].day).toBe('2025-05-01')
  })

  it('labels history as latest and upcoming as upcoming', () => {
    const past = selectDividendLadder(events([{ payment_date: '2025-01-01' }]), '2026-11-13')
    const future = selectDividendLadder(events([{ payment_date: '2026-12-01' }]), '2026-11-13')

    expect(past.label).toBe('Latest events')
    expect(future.label).toBe('Upcoming events')
  })
})

describe('selectDividendLadder — upcoming', () => {
  it("includes today's action date, which the old UTC-midnight filter dropped", () => {
    const selection = selectDividendLadder(
      events([{ payment_date: '2026-11-13' }, { payment_date: '2026-11-14' }]),
      '2026-11-13',
    )

    expect(selection.mode).toBe('upcoming')
    expect(days(selection)).toEqual(['2026-11-13 payment', '2026-11-14 payment'])
  })

  it('shows the nearest qualifying dates first when more than eight are upcoming', () => {
    const rows: DividendRecord[] = Array.from({ length: 10 }, (_, index) => ({
      // Deliberately out of order: selection must sort, not trust row order.
      ex_date: `2026-12-${String(10 - index).padStart(2, '0')}`,
    }))

    const selection = selectDividendLadder(events(rows), '2026-11-13')

    expect(selection.events).toHaveLength(DIVIDEND_LADDER_LIMIT)
    expect(selection.events[0].day).toBe('2026-12-01')
    expect(selection.events[7].day).toBe('2026-12-08')
  })

  it('orders mixed past and future actions by nearest day, dropping the past branch', () => {
    const rows: DividendRecord[] = [
      { ex_date: '2026-10-01', payment_date: '2026-12-20' },
      { ex_date: '2026-11-20', payment_date: '2026-12-01' },
      { ex_date: '2025-05-01' },
    ]

    const selection = selectDividendLadder(events(rows), '2026-11-13')

    expect(days(selection)).toEqual([
      '2026-11-20 ex',
      '2026-12-01 payment',
      '2026-12-20 payment',
    ])
  })

  it('keeps same-day ex, record and payment events distinguishable and deterministic', () => {
    const rows: DividendRecord[] = [
      { payment_date: '2026-12-01', record_date: '2026-12-01', ex_date: '2026-12-01' },
      { ex_date: '2026-12-01' },
    ]

    // Same day: ladder order ex → record → payment, and two Ex-Dates from
    // different rows stay tied in source order rather than swapping.
    const expected = [
      '2026-12-01 ex',
      '2026-12-01 ex',
      '2026-12-01 record',
      '2026-12-01 payment',
    ]

    expect(days(selectDividendLadder(events(rows), '2026-11-13'))).toEqual(expected)
    expect(days(selectDividendLadder(events(rows), '2026-11-13'))).toEqual(expected)
  })

  it('drops malformed dates instead of inventing an event', () => {
    const selection = selectDividendLadder(
      events([
        { ex_date: 'not-a-date', record_date: '2026-12-01', payment_date: '2026-02-30' },
      ]),
      '2026-11-13',
    )

    expect(days(selection)).toEqual(['2026-12-01 record'])
  })

  it('treats date-only and timestamp inputs for the same VN day as the same day', () => {
    const selection = selectDividendLadder(
      events([
        { ex_date: '2026-11-13' },
        { payment_date: '2026-11-13T10:00:00+07:00' },
      ]),
      '2026-11-13',
    )

    expect(days(selection)).toEqual(['2026-11-13 ex', '2026-11-13 payment'])
  })

  it('reports an empty selection with the latest label and no rows', () => {
    const selection = selectDividendLadder([], '2026-11-13')

    expect(selection.events).toEqual([])
    expect(selection.label).toBe('Latest events')
  })
})

describe('getVnDayKey', () => {
  it('uses the ICT calendar day, not the host timezone', () => {
    // 2026-11-13T17:30Z is 2026-11-14 00:30 in ICT.
    expect(getVnDayKey(new Date('2026-11-13T17:30:00Z'))).toBe('2026-11-14')
    expect(getVnDayKey(new Date('2026-11-13T16:59:00Z'))).toBe('2026-11-13')
  })
})
