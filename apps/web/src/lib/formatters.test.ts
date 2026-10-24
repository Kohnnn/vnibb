import { formatDividendPayout, formatDividendYield, readDividendYield } from './formatters'

describe('dividend yield formatting', () => {
  it.each([
    [0.25, '0.25%'],
    [0.0388, '0.04%'],
    [3.88, '3.88%'],
    [0, '0.00%'],
    [50, '50.00%'],
    [50.01, '50.01%'],
    [388, '388.00%'],
    [8800, '8800.00%'],
  ] as const)('formats canonical percent %s without another conversion', (value, expected) => {
    expect(formatDividendYield(value)).toBe(expected)
  })

  it.each([null, undefined, -1, NaN, Infinity, -Infinity])('rejects invalid canonical percent %s', value => {
    expect(formatDividendYield(value)).toBe('-')
  })

  it.each([0.25, 0, 388, '0.25', ' 0.25 '])('admits certified percent %s without scaling', value => {
    expect(readDividendYield(value, 'percent')).toBe(Number(value))
  })

  it.each([null, undefined, '', ' ', 'bad', -1, NaN, Infinity, -Infinity, false, {}])('rejects invalid declared percent %s', value => {
    expect(readDividendYield(value, 'percent')).toBeNull()
  })

  it.each([undefined, null, 'unknown', 'ratio', 'percent_fraction'])('rejects dividend yield with unit %s', unit => {
    expect(readDividendYield(0.25, unit)).toBeNull()
  })
})

describe('dividend payout formatting', () => {
  it.each<[Parameters<typeof formatDividendPayout>[0], string]>([
    [{ cash_dividend: 0 }, 'VND0'],
    [{ stock_dividend: 0 }, '0.00% stock'],
    [{ cash_dividend: 0, stock_dividend: 0 }, 'VND0'],
    [{ cash_dividend: 1000 }, 'VND1,000'],
    [{ stock_dividend: 10 }, '10.00% stock'],
    [{ cash_dividend: 1000, stock_dividend: 10 }, 'VND1,000 + 10.00% stock'],
    [{ cash_dividend: -1000, stock_dividend: 10 }, '-VND1,000 + 10.00% stock'],
    [{ cash_dividend: 0, dividend_ratio: 10, value: 1000 }, 'VND0'],
    [{ stock_dividend: 0, dividend_ratio: 10, value: 1000 }, '0.00% stock'],
    [{ dividend_ratio: 0, value: 1000 }, '0'],
    [{ dividend_ratio: '10:1', value: 1000 }, '10:1'],
    [{ dividend_ratio: null, value: 0 }, 'VND0'],
    [{ cash_dividend: null, stock_dividend: null, dividend_ratio: null, value: null }, '-'],
    [{}, '-'],
  ])('preserves reported payout %j as %s', (row, expected) => {
    expect(formatDividendPayout(row)).toBe(expected)
  })
})
