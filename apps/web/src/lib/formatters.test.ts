import { formatDividendYield, readDividendYield } from './formatters'

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
