export type FinancialPeriodMode = 'year' | 'quarter' | 'ttm'

interface PeriodLabelOptions {
  mode?: FinancialPeriodMode
  index?: number
  total?: number
}

const YEAR_REGEX = /(20\d{2})/
const QUARTER_REGEX = /Q([1-4])/

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

  const upper = safe.toUpperCase()
  if (upper.includes('TTM')) return 'TTM'

  const mode = options.mode ?? 'year'
  const yearMatch = upper.match(YEAR_REGEX)
  const quarterMatch = upper.match(QUARTER_REGEX)
  const numeric = Number(upper)

  if (mode === 'ttm') {
    return yearMatch ? `TTM ${yearMatch[1]}` : 'TTM'
  }

  if (mode === 'year') {
    if (yearMatch) return yearMatch[1]

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
  const label = String(period ?? '').trim().toUpperCase()
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
