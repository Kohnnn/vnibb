import { latestByFinancialPeriod, normalizeFinancialPeriod, periodSortKey } from './financialPeriods'

describe('financialPeriods', () => {
  it('normalizes common yearly, quarterly, and TTM labels', () => {
    expect(normalizeFinancialPeriod('2025')).toBe('2025')
    expect(normalizeFinancialPeriod('2025-Q3')).toBe('Q3-2025')
    expect(normalizeFinancialPeriod('Q4/2024')).toBe('Q4-2024')
    expect(normalizeFinancialPeriod('TTM 2025')).toBe('TTM-2025')
  })

  it('selects the latest financial period regardless of API row order', () => {
    const rows = [
      { period: '2020', pe: 54.48 },
      { period: '2025', pe: 18.96 },
      { period: '2022', pe: 30.2 },
    ]

    expect(latestByFinancialPeriod(rows)).toEqual({ period: '2025', pe: 18.96 })
  })

  it('sorts quarterly periods after earlier quarters in the same year', () => {
    expect(periodSortKey('Q4-2025')).toBeGreaterThan(periodSortKey('Q1-2025'))
  })
})
