import {
  convertFinancialValueForUnit,
  convertCurrentValueForUnit,
  calculatePercentChange,
  clampPercentage,
  DEFAULT_UNIT_CONFIG,
  DEFAULT_USD_VND_RATE,
  EMPTY_VALUE,
  formatCompactValueForUnit,
  formatNumber,
  formatPercent,
  formatPriceValueForUnit,
  formatUnitValue,
  formatUnitValuePlain,
  getUnitLabel,
  normalizePercentValue,
  normalizeUnitConfig,
  resolveUsdVndRate,
  resolveUnitScale,
} from '@/lib/units'

describe('units helpers', () => {
  test('normalizeUnitConfig falls back to defaults for invalid payload', () => {
    const config = normalizeUnitConfig({ display: 'invalid' as never, decimalPlaces: 10 })
    expect(config.display).toBe('auto')
    expect(config.decimalPlaces).toBe(3)
  })

  test('formatUnitValue returns empty token for nullish values', () => {
    expect(formatUnitValue(null)).toBe(EMPTY_VALUE)
    expect(formatUnitValue(undefined)).toBe(EMPTY_VALUE)
  })

  test('formatUnitValue applies auto scale to billions', () => {
    expect(formatUnitValue(2_500_000_000, { ...DEFAULT_UNIT_CONFIG, decimalPlaces: 1 })).toBe('2.5B')
  })

  test('formatUnitValue honors fixed K scale', () => {
    expect(formatUnitValue(25_400, { ...DEFAULT_UNIT_CONFIG, display: 'K', decimalPlaces: 1 })).toBe('25.4K')
  })

  test('formatUnitValue honors raw display with separators', () => {
    expect(formatUnitValue(85200, { ...DEFAULT_UNIT_CONFIG, display: 'raw', decimalPlaces: 0 })).toBe('85,200')
  })

  test('resolveUnitScale selects M for mid-sized values', () => {
    const scale = resolveUnitScale([300_000, 1_500_000, 0], DEFAULT_UNIT_CONFIG)
    expect(scale).toEqual({ divisor: 1e6, suffix: 'M' })
  })

  test('formatUnitValuePlain formats scaled values', () => {
    const scale = { divisor: 1e6, suffix: 'M' as const }
    expect(formatUnitValuePlain(5_250_000, scale, { ...DEFAULT_UNIT_CONFIG, decimalPlaces: 2 })).toBe('5.25')
  })

  test('formatUnitValuePlain returns empty token for invalid values', () => {
    expect(formatUnitValuePlain(undefined, { divisor: 1, suffix: '' })).toBe(EMPTY_VALUE)
  })

  test('formatNumber keeps grouping and decimals', () => {
    expect(formatNumber(85200.2)).toBe('85,200.20')
  })

  test('formatPercent auto mode converts ratio to percentage', () => {
    expect(formatPercent(0.1534, { decimals: 2 })).toBe('15.34%')
  })

  test('formatPercent percent mode keeps input scale', () => {
    expect(formatPercent(12.5, { input: 'percent', decimals: 1 })).toBe('12.5%')
  })

  test('normalizePercentValue rescales overflow margin percentages', () => {
    expect(normalizePercentValue(5199, { input: 'percent', clamp: 'margin' })).toBe(51.99)
  })

  test('formatPercent clamps impossible growth values and rescales likely mis-scaled yields', () => {
    expect(formatPercent(34887, { input: 'percent', clamp: 'yoy_change' })).toBe(EMPTY_VALUE)
    expect(formatPercent(135, { input: 'percent', clamp: 'yield' })).toBe('1.35%')
  })

  test('calculatePercentChange ignores near-zero bases and clamps outliers', () => {
    expect(calculatePercentChange(7.56, 0.0001, { clamp: 'yoy_change' })).toBeNull()
    expect(calculatePercentChange(20, 2, { clamp: 'yoy_change' })).toBe(900)
    expect(clampPercentage(1500, 'yoy_change')).toBeNull()
  })

  test('getUnitLabel maps display token', () => {
    expect(getUnitLabel({ ...DEFAULT_UNIT_CONFIG, display: 'B' })).toBe('B')
  })

  test('normalizeUnitConfig accepts USD display with yearly rates', () => {
    const config = normalizeUnitConfig({
      display: 'USD',
      usdVndDefaultRate: 25050,
      usdVndRatesByYear: { '2024': 24500, bad: 0 },
    })

    expect(config.display).toBe('USD')
    expect(config.currency).toBe('USD')
    expect(config.usdVndDefaultRate).toBe(25050)
    expect(config.usdVndRatesByYear).toEqual({ '2024': 24500 })
  })

  test('convertFinancialValueForUnit uses yearly override before default rate', () => {
    const config = normalizeUnitConfig({
      display: 'USD',
      usdVndDefaultRate: DEFAULT_USD_VND_RATE,
      usdVndRatesByYear: { '2024': 24000 },
    })

    expect(convertFinancialValueForUnit(24_000_000, config, 'Q2-2024')).toBe(1000)
    expect(convertFinancialValueForUnit(25_000_000, config, 'Q1-2025')).toBe(1000)
  })

  test('resolveUsdVndRate falls back to the default rate when a year has no override', () => {
    const config = normalizeUnitConfig({
      display: 'USD',
      usdVndDefaultRate: 25200,
      usdVndRatesByYear: { '2024': 24000 },
    })

    expect(resolveUsdVndRate(config, 2024)).toBe(24000)
    expect(resolveUsdVndRate(config, 2025)).toBe(25200)
    expect(resolveUsdVndRate(config, null)).toBe(25200)
  })

  test('convertCurrentValueForUnit uses the default USD/VND rate for current quote values', () => {
    const config = normalizeUnitConfig({
      display: 'USD',
      usdVndDefaultRate: 25000,
    })

    expect(convertCurrentValueForUnit(25000, config)).toBe(1)
  })

  test('formatPriceValueForUnit formats converted quote values', () => {
    const config = normalizeUnitConfig({
      display: 'USD',
      usdVndDefaultRate: 25000,
    })

    expect(formatPriceValueForUnit(25000, config, { decimals: 2 })).toBe('1.00')
  })

  test('formatCompactValueForUnit formats converted market values', () => {
    const config = normalizeUnitConfig({
      display: 'USD',
      usdVndDefaultRate: 25000,
    })

    expect(formatCompactValueForUnit(25_000_000_000, config, { decimals: 1 })).toBe('1.0M')
  })
})
