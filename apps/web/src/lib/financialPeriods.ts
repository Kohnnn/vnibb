export type FinancialPeriodMode = 'year' | 'quarter' | 'ttm'

interface PeriodLabelOptions {
  mode?: FinancialPeriodMode
  index?: number
  total?: number
}

const YEAR_REGEX = /(20\d{2})/
const QUARTER_REGEX = /Q([1-4])/

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

function inferYearFromIndex(index?: number, total?: number, quarterMode = false): number | null {
  if (!Number.isFinite(index) || !Number.isFinite(total) || (total as number) <= 0) return null

  const safeIndex = Math.max(0, Math.trunc(index as number))
  const safeTotal = Math.max(1, Math.trunc(total as number))
  const yearsBack = quarterMode
    ? Math.floor((safeTotal - safeIndex - 1) / 4)
    : Math.max(0, safeTotal - safeIndex - 1)

  return new Date().getFullYear() - yearsBack
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

    const inferredYear = inferYearFromIndex(options.index, options.total)
    if (inferredYear) return String(inferredYear)

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
    const inferredYear = inferYearFromIndex(options.index, options.total, true)
    return inferredYear ? `Q${quarterMatch[1]} ${inferredYear}` : `Q${quarterMatch[1]}`
  }

  if (yearMatch) {
    const inferredQuarter = Number.isFinite(options.index)
      ? ((Math.max(0, Math.trunc(options.index as number)) % 4) + 1)
      : null
    return inferredQuarter ? `Q${inferredQuarter} ${yearMatch[1]}` : yearMatch[1]
  }

  if (Number.isFinite(numeric)) {
    if (numeric >= 1900 && numeric <= 2100) {
      return String(Math.trunc(numeric))
    }

    const quarter = ((Math.max(1, Math.trunc(numeric)) - 1) % 4) + 1
    const inferredYear = inferYearFromIndex(options.index, options.total, true)
    return inferredYear ? `Q${quarter} ${inferredYear}` : `Q${quarter}`
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
