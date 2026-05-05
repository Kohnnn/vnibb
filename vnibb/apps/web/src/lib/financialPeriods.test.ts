import {
  formatFinancialPeriodLabel,
  isCanonicalQuarterPeriod,
  matchesFinancialQuarterSelection,
  normalizeFinancialPeriod,
  periodSortKey,
} from '@/lib/financialPeriods'

describe('financial period formatting', () => {
  test('formats yearly labels from year strings', () => {
    expect(formatFinancialPeriodLabel('2024', { mode: 'year' })).toBe('2024')
  })

  test('formats quarter labels with inferred year when needed', () => {
    expect(formatFinancialPeriodLabel('Q3', { mode: 'quarter', index: 1, total: 4 })).toMatch(
      /^Q3 20\d{2}$/
    )
  })

  test('does not fabricate a quarter label from a bare year in quarter mode', () => {
    expect(formatFinancialPeriodLabel('2024', { mode: 'quarter', index: 1, total: 4 })).toBe('2024')
  })

  test('infers year from index for numeric placeholder periods', () => {
    expect(formatFinancialPeriodLabel('31', { mode: 'year', index: 0, total: 4 })).toMatch(/20\d{2}/)
  })

  test('sort key ranks annual values above same-year quarter values', () => {
    expect(periodSortKey('2024')).toBeGreaterThan(periodSortKey('Q4 2024'))
  })

  test('normalizes mixed quarter formats to one canonical key', () => {
    expect(normalizeFinancialPeriod('2025-Q2')).toBe('Q2-2025')
    expect(normalizeFinancialPeriod('Q2/2025')).toBe('Q2-2025')
  })

  test('matches canonical quarter selection', () => {
    expect(matchesFinancialQuarterSelection('2025-Q2', 'Q2')).toBe(true)
    expect(matchesFinancialQuarterSelection('Q3-2025', 'Q2')).toBe(false)
  })

  test('identifies canonical quarter periods only', () => {
    expect(isCanonicalQuarterPeriod('Q2-2025')).toBe(true)
    expect(isCanonicalQuarterPeriod('2024')).toBe(false)
  })
})
