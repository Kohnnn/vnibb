export type FinancialPeriodMode = 'year' | 'quarter' | 'ttm'

/**
 * Label options. There is deliberately no `index`/`total`: a fiscal year is only
 * ever read from the period value itself. Inferring a year from row position
 * fabricated years for undated rows (issue #103).
 */
interface PeriodLabelOptions {
  mode?: FinancialPeriodMode
}

/**
 * Shared-period sync group used by the "Financial Period View" banner and every
 * widget it advertises. The banner and the widgets must agree on one constant or
 * a widget can silently stay on its own period while the banner claims it synced.
 */
export const FUNDAMENTAL_PERIOD_SYNC_GROUP = 'fundamental-core'

export const FUNDAMENTAL_PERIOD_OPTIONS = ['FY', 'Q', 'TTM'] as const

const YEAR_REGEX = /(20\d{2})/
const QUARTER_REGEX = /Q([1-4])/
const CANONICAL_QUARTER_REGEX = /^Q[1-4]-(20\d{2})$/

export function normalizeFinancialPeriod(raw: string | null | undefined): string | null {
  const cleaned = String(raw ?? '').trim()
  if (!cleaned) return null

  const upper = cleaned.toUpperCase()
  if (!upper || upper === 'UNKNOWN' || upper === 'NAN' || upper === 'NULL') return null

  if (upper === 'TTM' || upper.includes('TTM')) {
    const yearMatch = upper.match(YEAR_REGEX)
    return yearMatch ? `TTM-${yearMatch[1]}` : 'TTM'
  }

  if (upper.includes('YTD')) {
    const yearMatch = upper.match(YEAR_REGEX)
    return yearMatch ? `${yearMatch[1]} YTD` : 'YTD'
  }

  if (/^20\d{2}$/.test(upper)) {
    return upper
  }

  // A provider row can label a full year with an explicit FY marker ("2025FY",
  // "FY 2025"). The year is stated in the label, so reading it invents nothing,
  // while dropping the row left every annual chart and table empty (issue #103).
  const annualMarker = upper.match(/^(?:FY\s*)?(20\d{2})(?:\s*FY)?$/)
  if (annualMarker) {
    return annualMarker[1]
  }

  const quarterFirst = upper.match(/^Q([1-4])[-_/ ]?(20\d{2})$/)
  if (quarterFirst) {
    return `Q${quarterFirst[1]}-${quarterFirst[2]}`
  }

  const yearFirst = upper.match(/^(20\d{2})[-_/ ]?Q([1-4])$/)
  if (yearFirst) {
    return `Q${yearFirst[2]}-${yearFirst[1]}`
  }

  const compactQuarter = upper.match(/^(20\d{2})Q([1-4])$/)
  if (compactQuarter) {
    return `Q${compactQuarter[2]}-${compactQuarter[1]}`
  }

  const altQuarter = upper.match(/^([1-4])[/_-](20\d{2})$/)
  if (altQuarter) {
    return `Q${altQuarter[1]}-${altQuarter[2]}`
  }

  const yearMatch = upper.match(YEAR_REGEX)
  const quarterMatch = upper.match(QUARTER_REGEX)
  if (yearMatch && quarterMatch) {
    return `Q${quarterMatch[1]}-${yearMatch[1]}`
  }

  return null
}

export function matchesFinancialQuarterSelection(
  period: string | null | undefined,
  selection: 'Q1' | 'Q2' | 'Q3' | 'Q4'
): boolean {
  const normalized = normalizeFinancialPeriod(period)
  return normalized ? normalized.startsWith(`${selection}-`) : false
}

export function isCanonicalQuarterPeriod(period: string | null | undefined): boolean {
  const normalized = normalizeFinancialPeriod(period)
  return normalized ? CANONICAL_QUARTER_REGEX.test(normalized) : false
}


/**
 * Reduce provider rows to at most one row per canonical fiscal period.
 *
 * The provider can return the same fiscal period more than once (a revision, or a
 * consolidated/separate pair). There is no field in the payload that proves which
 * of two different rows is authoritative, so this never picks one: rows that are
 * byte-identical after period normalization collapse to one (a harmless repeat),
 * while rows that disagree are treated as an ambiguous period and excluded
 * entirely. Excluding is deliberate - silently choosing either would replace a
 * real balance with a different basis. Both cases are reported so the caller can
 * disclose them instead of hiding the collision (issue #103).
 *
 * Rows whose period cannot be normalized have no fiscal identity at all; they are
 * counted (not dropped silently) and excluded so they never fabricate a year.
 */
export interface CanonicalPeriodIssue {
  period: string
  rawPeriods: string[]
  reason: 'duplicate-identical' | 'ambiguous-basis'
}

export interface CanonicalPeriodRows<T extends { period?: string | null }> {
  rows: T[]
  issues: CanonicalPeriodIssue[]
  invalidPeriodCount: number
}

function rowsAreIdentical<T extends { period?: string | null }>(left: T, right: T): boolean {
  const serialize = (value: T): string | null => {
    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }
  const leftText = serialize(left)
  return leftText !== null && leftText === serialize(right)
}

export function canonicalPeriodRows<T extends { period?: string | null }>(
  rows: T[] | null | undefined
): CanonicalPeriodRows<T> {
  const groups = new Map<string, { rows: T[]; rawPeriods: string[] }>()
  const issues: CanonicalPeriodIssue[] = []
  let invalidPeriodCount = 0

  for (const row of rows ?? []) {
    const raw = String(row?.period ?? '').trim()
    const key = normalizeFinancialPeriod(row?.period)
    if (!key) {
      invalidPeriodCount += 1
      continue
    }

    const group = groups.get(key)
    if (group) {
      group.rows.push(row)
      if (raw) group.rawPeriods.push(raw)
    } else {
      groups.set(key, { rows: [row], rawPeriods: raw ? [raw] :[] })
    }
  }

  const canonical: T[] = []
  for (const [period, group] of groups) {
    if (group.rows.length === 1) {
      canonical.push(group.rows[0])
      continue
    }

    const identical = group.rows.every((row) => rowsAreIdentical(
      { ...row, period }, { ...group.rows[0], period }
    ))
    if (identical) {
      canonical.push(group.rows[0])
      issues.push({ period, rawPeriods: group.rawPeriods, reason: 'duplicate-identical' })
      continue
    }

    issues.push({ period, rawPeriods: group.rawPeriods, reason: 'ambiguous-basis' })
  }

  return { rows: canonical, issues, invalidPeriodCount }
}

function normalizeUnknown(value: string): string {
  const upper = value.toUpperCase()
  if (!upper || upper === 'UNKNOWN' || upper === 'NAN' || upper === 'NULL') return '-'
  return value
}

export function formatFinancialPeriodLabel(
  raw: string | null | undefined,
  options: PeriodLabelOptions = {}
): string {
  const cleaned = String(raw ?? '').trim()
  if (!cleaned) return '-'

  const safe = normalizeUnknown(cleaned)
  if (safe === '-') return '-'

  const normalized = normalizeFinancialPeriod(safe)
  if (normalized) {
    if (normalized === 'TTM') return 'TTM'
    if (normalized.startsWith('TTM-')) return `TTM ${normalized.slice(4)}`
    if (normalized.endsWith(' YTD')) return normalized.replace(' YTD', ' (YTD)')

    const normalizedQuarter = normalized.match(/^Q([1-4])-(20\d{2})$/)
    if (normalizedQuarter) {
      return `Q${normalizedQuarter[1]} ${normalizedQuarter[2]}`
    }

    if (/^20\d{2}$/.test(normalized)) {
      return normalized
    }
  }

  const upper = safe.toUpperCase()
  if (upper.includes('TTM')) return 'TTM'

  const mode = options.mode ?? 'year'
  const yearMatch = upper.match(YEAR_REGEX)
  const quarterMatch = upper.match(QUARTER_REGEX)
  const numeric = Number(upper)
  const hasYtd = upper.includes('YTD')

  if (mode === 'ttm') {
    return yearMatch ? `TTM ${yearMatch[1]}` : 'TTM'
  }

  if (mode === 'year') {
    if (yearMatch) return hasYtd ? `${yearMatch[1]} (YTD)` : yearMatch[1]

    if (Number.isFinite(numeric) && numeric >= 1900 && numeric <= 2100) {
      return String(Math.trunc(numeric))
    }

    return safe
  }

  if (quarterMatch && yearMatch) {
    return `Q${quarterMatch[1]} ${yearMatch[1]}`
  }

  const slashQuarter = upper.match(/^([1-4])[\/-](20\d{2})$/)
  if (slashQuarter) {
    return `Q${slashQuarter[1]} ${slashQuarter[2]}`
  }

  if (quarterMatch) {
    return `Q${quarterMatch[1]}`
  }

  if (yearMatch) {
    return yearMatch[1]
  }

  if (Number.isFinite(numeric)) {
    if (numeric >= 1900 && numeric <= 2100) {
      return String(Math.trunc(numeric))
    }

    const quarter = ((Math.max(1, Math.trunc(numeric)) - 1) % 4) + 1
    return `Q${quarter}`
  }

  return safe
}

export function periodSortKey(period: string | null | undefined): number {
  const normalized = normalizeFinancialPeriod(period)
  const label = String(normalized ?? period ?? '').trim().toUpperCase()
  if (!label) return 0

  const yearMatch = label.match(YEAR_REGEX)
  const year = yearMatch ? Number(yearMatch[1]) : 0
  const quarterMatch = label.match(QUARTER_REGEX)
  const quarter = quarterMatch ? Number(quarterMatch[1]) : 0

  if (label.includes('TTM')) return year * 10 + 9
  if (year && quarter) return year * 10 + quarter
  if (year) return year * 10 + 8

  const numeric = Number(label)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0
}

export function latestByFinancialPeriod<T extends { period?: string | null }>(rows: T[] | null | undefined): T | undefined {
  return [...(rows ?? [])]
    .filter((row) => Boolean(normalizeFinancialPeriod(row.period)))
    .sort((left, right) => periodSortKey(right.period) - periodSortKey(left.period))[0]
}

/**
 * A statement row the API could not certify carries `unavailable_reason` and has
 * every numeric field nulled. Such a row is not a row of zeroes: it must render
 * its reason, never a column of dashes that reads as "reported as zero"
 * (issue #103). A row that merely has some null fields is untouched - missing is
 * not the same as uncertified.
 */
export function isUnavailableStatementRow(row: { unavailable_reason?: unknown } | null | undefined): boolean {
  const reason = row?.unavailable_reason
  return typeof reason === 'string' && reason.trim().length > 0
}

/** The visible note for reason-bearing rows, grouped by reason, or null when there are none. */
export function describeUnavailableStatementRows(
  rows: Array<{ period?: string | null; unavailable_reason?: unknown }> | null | undefined
): string | null {
  const groups = new Map<string, string[]>()

  for (const row of rows ?? []) {
    const reason = row?.unavailable_reason
    if (typeof reason !== 'string' || !reason.trim()) continue
    const normalized = normalizeFinancialPeriod(row.period)
    const label = normalized || String(row.period ?? '').trim() || 'unknown period'
    groups.set(reason.trim(), [...(groups.get(reason.trim()) ??[]), label])
  }

  if (groups.size === 0) return null

  return Array.from(groups)
    .map(([reason, periods]) => `Unavailable: ${periods.join(', ')} returned no certified value (${reason}), so no value is shown.`)
    .join(' ')
}
