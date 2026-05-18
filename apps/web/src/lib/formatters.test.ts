import { formatDividendYield, normalizeDividendYield } from './formatters'

describe('dividend yield formatting', () => {
  it('normalizes ratio, percent, and provider-scaled percent inputs', () => {
    expect(formatDividendYield(0.0388)).toBe('3.88%')
    expect(formatDividendYield(3.88)).toBe('3.88%')
    expect(formatDividendYield(388)).toBe('3.88%')
  })

  it('rejects impossible dividend yields', () => {
    expect(normalizeDividendYield(-1)).toBeNull()
    expect(normalizeDividendYield(8800)).toBeNull()
    expect(formatDividendYield(8800)).toBe('-')
  })
})
