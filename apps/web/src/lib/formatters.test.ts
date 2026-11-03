import {
  formatDividendPayout, formatDividendYield, formatNumber, formatPercent, formatVND, readDividendYield,
} from './formatters'

describe('legacy percent formatting', () => {
  it.each([
    [0.1523, '+15.23%'],
    [-0.05, '-5.00%'],
    [12.5, '+12.50%'],
    [0, '0.00%'],
    [-0, '0.00%'],
    // Rounds to 0.00 at 2dp: the sign follows the digits, not the raw value.
    [-0.00004, '0.00%'],
    [null, 'n/a'],
    [undefined, 'n/a'],
    [Number.NaN, 'n/a'],
  ] as const)('formats %s as %s', (value, expected) => {
    expect(formatPercent(value as number | null | undefined)).toBe(expected)
  })

  // A dash reads as a value; brand §19 requires `n/a` for unavailable.
  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'renders unavailable money and counts as n/a for %s',
    (value) => {
      expect(formatVND(value as number | null | undefined)).toBe('n/a')
      expect(formatNumber(value as number | null | undefined)).toBe('n/a')
    },
  )
})

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

  it.each([null, undefined, NaN, Infinity, -Infinity])('renders unavailable dividend yield as n/a for %s', value => {
    expect(formatDividendYield(value)).toBe('n/a')
  })

  // Brand v1.1 keeps "not meaningful" distinct from "unavailable".
  it('renders a negative dividend yield as n/m', () => {
    expect(formatDividendYield(-1)).toBe('n/m')
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
    [{ cash_dividend: null, stock_dividend: null, dividend_ratio: null, value: null }, 'n/a'],
    [{}, 'n/a'],
  ])('preserves reported payout %j as %s', (row, expected) => {
    expect(formatDividendPayout(row)).toBe(expected)
  })
})
