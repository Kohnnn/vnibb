import {
  canonicalPeriodRows,
  formatFinancialPeriodLabel,
  latestByFinancialPeriod,
  normalizeFinancialPeriod,
  periodSortKey,
} from './financialPeriods'

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

  describe('formatFinancialPeriodLabel', () => {
    it('never invents a fiscal year from a row position', () => {
      // MSR's provider payload leads with period values "123".."110". The previous
      // implementation inferred 2007..2020 from the row index and fabricated a
      // duplicate 2020 column (issue #103).
      expect(formatFinancialPeriodLabel('123')).toBe('123')
      expect(formatFinancialPeriodLabel('110')).toBe('110')
      expect(formatFinancialPeriodLabel(null)).toBe('-')
    })
  })

  describe('canonicalPeriodRows', () => {
    it('excludes rows with no fiscal identity and counts them', () => {
      const { rows, issues, invalidPeriodCount } = canonicalPeriodRows([
        { period: '123', total_assets: 0 },
        { period: '2025', total_assets: 100 },
      ])

      expect(rows).toEqual([{ period: '2025', total_assets: 100 }])
      expect(invalidPeriodCount).toBe(1)
      expect(issues).toEqual([])
    })

    it('collapses byte-identical repeats to one row', () => {
      const { rows, issues } = canonicalPeriodRows([
        { period: '2020', total_assets: 10 },
        { period: '2020', total_assets: 10 },
      ])

      expect(rows).toHaveLength(1)
      expect(issues).toEqual([
        { period: '2020', rawPeriods: ['2020', '2020'], reason: 'duplicate-identical' },
      ])
    })

    it('never picks a winner between conflicting rows for one period', () => {
      // Same fiscal period, different balances, and no field proving which basis is
      // authoritative. Choosing either would silently substitute one real balance for
      // another, so the period is dropped and reported instead (issue #103).
      const { rows, issues } = canonicalPeriodRows([
        { period: '2020', total_assets: 40108847814000 },
        { period: '2020', total_assets: 0 },
      ])

      expect(rows).toEqual([])
      expect(issues).toEqual([
        { period: '2020', rawPeriods: ['2020', '2020'], reason: 'ambiguous-basis' },
      ])
    })

    it('collapses equal observations with equivalent fiscal aliases', () => {
      const { rows, issues } = canonicalPeriodRows([
        { period: '2025-Q3', total_assets: 10 },
        { period: 'Q3/2025', total_assets: 10 },
      ])
      expect(rows).toHaveLength(1)
      expect(issues).toEqual([
        { period: 'Q3-2025', rawPeriods: ['2025-Q3', 'Q3/2025'], reason: 'duplicate-identical' },
      ])
    })

    it('treats differently-spelled labels for one period as a collision', () => {
      const { rows, issues } = canonicalPeriodRows([
        { period: '2025-Q3', total_assets: 1 },
        { period: 'Q3/2025', total_assets: 2 },
      ])

      expect(rows).toEqual([])
      expect(issues.map((issue) => issue.period)).toEqual(['Q3-2025'])
    })
  })
})
