import { convertFinancialValueForUnit, DEFAULT_UNIT_CONFIG, forecastLabel, formatPercent, readCanonicalStatementValue } from './units'

const certifiedRow = {
  period: '2025', currency: 'VND', value_unit: 'VND', consolidation_basis: 'consolidated', flow_basis: 'annual',
  revenue: 25_500_000_000, eps: 0,
  unit_metadata: {
    revenue: { value_unit: 'VND', source_unit: 'triệu đồng' },
    eps: { value_unit: 'VND/share', source_unit: 'VND' },
  },
}

describe('canonical statement value admission', () => {
  test.each([
    ['2025FY', 'annual'], ['Q1-2025', 'single_quarter'], ['2025 (YTD)', 'cumulative_ytd'],
  ])('preserves %s with its declared flow basis', (period, flow_basis) => {
    expect(readCanonicalStatementValue({ ...certifiedRow, period, flow_basis }, 'revenue')).toBe(certifiedRow.revenue)
  })

  test.each(['Consolidated', 'SEPARATE'])('admits explicit consolidation label %s without changing it', (consolidation_basis) => {
    const row = { ...certifiedRow, consolidation_basis }
    expect(readCanonicalStatementValue(row, 'revenue')).toBe(certifiedRow.revenue)
    expect(row.consolidation_basis).toBe(consolidation_basis)
  })

  test.each([
    { currency: undefined }, { value_unit: undefined }, { consolidation_basis: undefined },
    { period: undefined }, { flow_basis: undefined }, { flow_basis: 'single_quarter' },
    { unit_metadata: {} }, { unit_metadata: { revenue: { value_unit: 'USD', source_unit: 'USD' } } },
    { unit_metadata: { revenue: { value_unit: 'VND' } } },
  ])('withholds missing or conflicting evidence %j', (override) => {
    expect(readCanonicalStatementValue({ ...certifiedRow, ...override }, 'revenue')).toBeNull()
  })

  test('preserves admitted zero and converts admitted VND exactly once at fiscal-year FX', () => {
    expect(readCanonicalStatementValue(certifiedRow, 'eps')).toBe(0)
    const value = readCanonicalStatementValue(certifiedRow, 'revenue')
    expect(convertFinancialValueForUnit(value, { ...DEFAULT_UNIT_CONFIG, display: 'USD' }, '2025')).toBe(1_000_000)
  })

  test('requires every TTM component to retain its original unit evidence', () => {
    const ttm = { ...certifiedRow, period: 'TTM', flow_basis: 'trailing_twelve_months',
      aggregation_basis: 'four_quarter_flow_sum', source_periods: ['Q4-2025', 'Q3-2025', 'Q2-2025', 'Q1-2025'],
      unit_metadata: { revenue: {
        components: Array.from({ length: 4 }, () => certifiedRow.unit_metadata.revenue),
      } } }
    expect(readCanonicalStatementValue(ttm, 'revenue')).toBe(certifiedRow.revenue)
    expect(readCanonicalStatementValue({ ...ttm, unit_metadata: { revenue: { components: [certifiedRow.unit_metadata.revenue, {}] } } }, 'revenue')).toBeNull()
    expect(readCanonicalStatementValue({ ...ttm, aggregation_basis: 'latest_quarter_snapshot' }, 'revenue')).toBeNull()
    expect(readCanonicalStatementValue({ ...ttm, source_periods: [] }, 'revenue')).toBeNull()
    expect(readCanonicalStatementValue({ ...ttm, source_periods: ['Q4-2025', 'Q3-2025', 'Q1-2025', 'Q4-2024'] }, 'revenue')).toBeNull()
    expect(readCanonicalStatementValue({ ...ttm, source_periods: ['Q4-2025', 'Q3-2025', 'Q3-2025', 'Q2-2025'] }, 'revenue')).toBeNull()
    expect(readCanonicalStatementValue({ ...ttm, unit_metadata: { revenue: { components: [certifiedRow.unit_metadata.revenue] } } }, 'revenue')).toBeNull()
    expect(readCanonicalStatementValue({ ...ttm, consolidation_basis: undefined }, 'revenue')).toBeNull()
    expect(readCanonicalStatementValue({ ...ttm, flow_basis: 'annual' }, 'revenue')).toBeNull()

    const balance = { ...certifiedRow, period: 'TTM', flow_basis: undefined,
      aggregation_basis: 'latest_quarter_snapshot', source_periods: ['Q4-2025'] }
    expect(readCanonicalStatementValue(balance, 'revenue', false)).toBe(certifiedRow.revenue)
    expect(readCanonicalStatementValue({ ...balance, source_periods: [] }, 'revenue', false)).toBeNull()
  })

  test('admits balance snapshots without inventing a flow basis', () => {
    expect(readCanonicalStatementValue({ ...certifiedRow, flow_basis: undefined }, 'revenue', false)).toBe(certifiedRow.revenue)
  })
})

describe('signed-change formatting golden cases', () => {
  test.each([
    ['positive change', 1.25, { input: 'percent', decimals: 1, signed: true }, '+1.3%'],
    ['negative change', -1.25, { input: 'percent', decimals: 1, signed: true }, '-1.3%'],
    ['true zero keeps no sign', 0, { input: 'percent', decimals: 1, signed: true }, '0.0%'],
    ['negative zero keeps no sign', -0, { input: 'percent', decimals: 1, signed: true }, '0.0%'],
    ['missing value', null, { input: 'percent', decimals: 1, signed: true }, 'n/a'],
    ['undefined value', undefined, { input: 'percent', decimals: 1, signed: true }, 'n/a'],
    ['non-finite value', Number.NaN, { input: 'percent', decimals: 1, signed: true }, 'n/a'],
    ['non-meaningful ratio', 2500, { input: 'percent', decimals: 1, signed: true, clamp: 'margin' }, 'n/m'],
    ['non-meaningful ratio via auto scaling', 250, { decimals: 1, signed: true, clamp: 'margin' }, 'n/m'],
    ['margin delta in pp', 0.3, { input: 'percent', decimals: 1, signed: true, unit: 'pp' }, '+0.3 pp'],
    ['margin delta without sign', 0.3, { input: 'percent', decimals: 1, unit: 'pp' }, '0.3 pp'],
    ['margin delta below rounding', 0.04, { input: 'percent', decimals: 1, signed: true, unit: 'pp' }, '0.0 pp'],
    ['unsigned positive keeps no plus', 1.25, { input: 'percent', decimals: 1 }, '1.3%'],
  ] as const)('%s formats as %s', (_label, value, options, expected) => {
    expect(formatPercent(value as number | null | undefined, options)).toBe(expected)
  })

  test('forecast labels are emitted only for a real forecast, never for a measured value', () => {
    expect(forecastLabel({ kind: 'forecast', period: '2026E' })).toBe('2026E · forecast')
    expect(forecastLabel({ kind: 'estimate', period: '2026E' })).toBe('2026E · forecast')
    expect(forecastLabel({ kind: 'actual', period: '2025' })).toBe('2025')
    expect(forecastLabel({ kind: 'actual', period: null })).toBe('n/a')
  })
})
