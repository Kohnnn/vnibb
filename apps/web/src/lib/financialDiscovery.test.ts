import { buildGrowthBridgeRows, growthComparisonLabel } from './financialDiscovery'
import { convertFinancialValueForUnit, formatAxisValue, formatConvertedValue, formatRawValuePlain, formatUnitValuePlain, percentChangeDetail, resolveUnitScale } from './units'

describe('financial growth classification', () => {
  test('formats fiscal-period USD values without converting chart ticks twice', () => {
    const config = { display: 'USD', decimalPlaces: 2, currency: 'VND', usdVndRatesByYear: { '2024': 25_000, '2025': 25_500 } } as const
    const amount = convertFinancialValueForUnit(53_312_370_717_301, config, '2025')
    expect(amount).toBeCloseTo(2_090_681_204.6)
    expect(formatAxisValue(amount!, config, { converted: true })).toBe('2.09 B')
    expect(formatConvertedValue(amount, config)).toBe('2.09B USD')
    expect(convertFinancialValueForUnit(2_500, config, '2024')).toBe(0.1)
    expect(convertFinancialValueForUnit(2_550, config, '2025')).toBe(0.1)
    expect(convertFinancialValueForUnit(null, config, '2025')).toBeNull()
  })

  test('converts raw statement values once before the shared scale is applied', () => {
    const config = { display: 'USD', decimalPlaces: 2, currency: 'VND', usdVndRatesByYear: { '2025': 25_500 } } as const
    const revenueVnd = 53_312_370_717_301
    const converted = convertFinancialValueForUnit(revenueVnd, config, '2025')!
    const scale = resolveUnitScale([converted], config)
    // The Sankey and cash-flow waterfall models hold raw statement rows, so their
    // formatter must convert before applying the scale, at the fiscal period of the
    // row it is formatting. Dividing the raw VND by a USD-derived scale overstated
    // the quantity by the FX rate, and omitting the period formatted one fiscal year
    // at the current rate instead of the rate the scale was built from (issue #100).
    expect(formatRawValuePlain(revenueVnd, scale, config, '2025')).toBe(formatUnitValuePlain(converted, scale, config))
    expect(formatRawValuePlain(revenueVnd, scale, config, '2025')).toBe('2.09')
  })

  test('uses source transition metadata rather than the percentage sign', () => {
    expect(growthComparisonLabel({ negative_base: true, transition: 'loss_to_profit' })).toBe('loss to profit')
    expect(growthComparisonLabel({ negative_base: true })).toBe('negative base')
    expect(growthComparisonLabel({ transition: 'profit_to_loss' })).toBe('profit to loss')
    expect(growthComparisonLabel()).toBeNull()
    const rows = buildGrowthBridgeRows({
      yoy: { earnings_growth: 100.7 },
      comparisons: { yoy: { earnings_growth: { negative_base: true, transition: 'loss_to_profit' } } },
    })
    expect(rows.find((row) => row.key === 'earnings_growth')).toMatchObject({ annual: 100.7, annualLabel: 'loss to profit' })
  })

  test.each<[number, number, number, string]>([
    [10, -10, 200, 'loss-to-profit'],
    [-5, -10, 50, 'loss-narrowed'],
    [-15, -10, -50, 'loss-widened'],
    [-5, 10, -150, 'profit-to-loss'],
    [0, -10, 100, 'loss-narrowed'],
    [15, 10, 50, 'growth'],
  ])('classifies %s versus %s using an absolute denominator', (current, previous, change, basis) => {
    expect(percentChangeDetail(current, previous)).toMatchObject({ change, basis })
  })

  test('does not fabricate growth for zero or missing bases', () => {
    expect(percentChangeDetail(10, 0).change).toBeNull()
    expect(percentChangeDetail(10, null).change).toBeNull()
    expect(percentChangeDetail(null, -10).change).toBeNull()
  })
})
