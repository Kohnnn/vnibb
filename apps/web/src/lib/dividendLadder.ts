/**
 * Dividend Ladder ordering/selection (#259).
 *
 * Ex-date / record-date / payment-date are *action days*, not observation
 * timestamps. They are therefore compared as Asia/Ho_Chi_Minh calendar days:
 * a date-only value means that day in the Vietnamese market calendar, never
 * UTC midnight, so today's action does not drop out of Upcoming once the day
 * starts.
 *
 * The widget used to sort every action ascending and render the first eight,
 * so a long history showed the oldest retained dividends while claiming they
 * were the latest. Selection is now explicit:
 *   - Upcoming: nearest qualifying day first (today included).
 *   - Latest:   newest day first, bounded to the same eight-row window.
 */

import type { DividendRecord } from '@/lib/api'

const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** Visible ladder rows; the same bound applies to both branches. */
export const DIVIDEND_LADDER_LIMIT = 8

export type DividendEventType = 'ex' | 'record' | 'payment'

export interface DividendLadderEvent {
  type: DividendEventType
  label: string
  /** Action day in the VN market calendar (`YYYY-MM-DD`). Display this. */
  day: string
  /** Raw source value, kept for receipts. */
  date: string
  payoutLabel: string
  payoutType: string
  distribution: DividendRecord
  /** Source order; stable tiebreak for identical day+type rows. */
  sequence: number
}

export type DividendLadderMode = 'upcoming' | 'latest'

export interface DividendLadderSelection {
  mode: DividendLadderMode
  /** Label that must match `mode`; rendered next to the ladder. */
  label: 'Upcoming events' | 'Latest events'
  /** Ordered and truncated rows exactly as displayed. */
  events: DividendLadderEvent[]
}

const TYPE_RANK: Record<DividendEventType, number> = { ex: 0, record: 1, payment: 2 }
const TYPE_LABEL: Record<DividendEventType, string> = {
  ex: 'Ex-Date',
  record: 'Record Date',
  payment: 'Payment',
}

const DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** `YYYY-MM-DD` for the VN calendar day containing `at`. */
export function getVnDayKey(at: Date): string {
  const parts = DAY_FORMATTER.formatToParts(at)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

// Canonical ISO shape our dividends endpoint emits: a bare day, or a clock
// value that may carry an explicit offset. Anything else is malformed and is
// dropped rather than coerced into "today" or a parsed-relative guess.
const ACTION_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function isRealCalendarDay(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day
  )
}

/**
 * Resolve a source action value to its VN action day.
 * Returns null for blank, malformed or impossible dates.
 *
 * - Date-only (`2022-07-06`): that day, untouched by host timezone.
 * - Offset/`Z` timestamp: the VN day containing that instant.
 * - Naive timestamp (`2022-07-06T00:00:00`): its literal date part; the source
 *   asserted a wall-clock day and gave us no zone to shift it by.
 */
export function resolveDividendActionDay(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (!text) return null

  const match = ACTION_DATE.exec(text)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isRealCalendarDay(year, month, day)) return null

  // Every supplied clock component is validated before either branch returns:
  // `2026-12-01T99:99:99` is impossible even though its date part is fine, so
  // it must not become an event. Same policy for an impossible offset.
  const hasClock = match[4] !== undefined
  if (hasClock) {
    const hour = Number(match[4])
    const minute = Number(match[5])
    const second = match[6] === undefined ? 0 : Number(match[6])
    if (hour > 23 || minute > 59 || second > 59) return null
  }

  const offset = match[7]
  if (offset !== undefined && offset !== 'Z') {
    const offsetDigits = offset.replace(':', '')
    // Real-world UTC offsets span -12:00..+14:00; anything wilder is corrupt.
    const offsetHours = Number(offsetDigits.slice(1, 3))
    const offsetMinutes = Number(offsetDigits.slice(3, 5))
    if (offsetHours > 14 || offsetMinutes > 59) return null
  }

  if (!hasClock || !offset) {
    return `${match[1]}-${match[2]}-${match[3]}`
  }

  const instant = new Date(text)
  if (Number.isNaN(instant.getTime())) return null
  return getVnDayKey(instant)
}

/** Build the ordered event list from dividend rows, dropping malformed dates. */
export function buildDividendEvents(
  rows: readonly DividendRecord[],
  payout: (row: DividendRecord) => { payoutLabel: string; payoutType: string },
): DividendLadderEvent[] {
  const events: DividendLadderEvent[] = []
  let sequence = 0

  rows.forEach((row) => {
    const { payoutLabel, payoutType } = payout(row)
    const fields: Array<[DividendEventType, string | null | undefined]> = [
      ['ex', row.ex_date],
      ['record', row.record_date],
      ['payment', row.payment_date],
    ]

    fields.forEach(([type, raw]) => {
      const day = resolveDividendActionDay(raw)
      if (!day) return
      events.push({
        type,
        label: TYPE_LABEL[type],
        day,
        date: String(raw),
        payoutLabel,
        payoutType,
        distribution: row,
        sequence: sequence++,
      })
    })
  })

  return events
}

/** Nearest day first; same-day actions keep ladder order ex → record → payment. */
function compareUpcoming(a: DividendLadderEvent, b: DividendLadderEvent): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  return TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.sequence - b.sequence
}

/** Newest day first; same-day actions still read Ex → Record → Payment. */
function compareLatest(a: DividendLadderEvent, b: DividendLadderEvent): number {
  if (a.day !== b.day) return a.day < b.day ? 1 : -1
  return TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.sequence - b.sequence
}

/**
 * Choose the displayed branch for a given VN "today".
 * `todayKey` fixes the calendar boundary so callers (and tests) can pin it.
 */
export function selectDividendLadder(
  events: readonly DividendLadderEvent[],
  todayKey: string,
  limit: number = DIVIDEND_LADDER_LIMIT,
): DividendLadderSelection {
  const upcoming = events
    .filter((event) => event.day >= todayKey)
    .sort(compareUpcoming)

  if (upcoming.length > 0) {
    return {
      mode: 'upcoming',
      label: 'Upcoming events',
      events: upcoming.slice(0, limit),
    }
  }

  return {
    mode: 'latest',
    label: 'Latest events',
    events: [...events].sort(compareLatest).slice(0, limit),
  }
}
