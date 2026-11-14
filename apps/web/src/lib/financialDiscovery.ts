import { EMPTY_VALUE, convertFinancialValueForUnit, formatUnitValuePlain, resolveUnitScale, type UnitConfig } from '@/lib/units'

export interface TTMSnapshotMetricCard {
  label: string
  value: string
}

function readNumber(source: Record<string, any> | null | undefined, ...keys: string[]) {
  if (!source) return null
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export function buildTTMSnapshotCards(
  payload: {
    income?: Record<string, any> | null
    balance?: Record<string, any> | null
    cash_flow?: Record<string, any> | null
  },
  unitConfig: UnitConfig,
) {
  const incomePeriod = payload.income?.period || 'TTM'
  const balancePeriod = payload.balance?.period || 'TTM'
  const cashPeriod = payload.cash_flow?.period || 'TTM'
  const convertedValues = [
    convertFinancialValueForUnit(readNumber(payload.income, 'revenue'), unitConfig, incomePeriod),
    convertFinancialValueForUnit(readNumber(payload.income, 'gross_profit'), unitConfig, incomePeriod),
    convertFinancialValueForUnit(readNumber(payload.income, 'operating_income'), unitConfig, incomePeriod),
    convertFinancialValueForUnit(readNumber(payload.income, 'net_income'), unitConfig, incomePeriod),
    convertFinancialValueForUnit(readNumber(payload.cash_flow, 'operating_cash_flow'), unitConfig, cashPeriod),
    convertFinancialValueForUnit(readNumber(payload.cash_flow, 'free_cash_flow'), unitConfig, cashPeriod),
    convertFinancialValueForUnit(readNumber(payload.balance, 'total_assets'), unitConfig, balancePeriod),
    convertFinancialValueForUnit(readNumber(payload.balance, 'total_equity', 'equity'), unitConfig, balancePeriod),
  ]
  const scale = resolveUnitScale(convertedValues, unitConfig)
  const formatValue = (value: number | null | undefined) => {
    const formatted = formatUnitValuePlain(value, scale, unitConfig)
    return formatted === EMPTY_VALUE || !scale.suffix ? formatted : `${formatted}${scale.suffix}`
  }

  const cards: TTMSnapshotMetricCard[] = [
    {
      label: 'Revenue',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.income, 'revenue'), unitConfig, incomePeriod)),
    },
    {
      label: 'Gross Profit',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.income, 'gross_profit'), unitConfig, incomePeriod)),
    },
    {
      label: 'Operating Income',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.income, 'operating_income'), unitConfig, incomePeriod)),
    },
    {
      label: 'Net Income',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.income, 'net_income'), unitConfig, incomePeriod)),
    },
    {
      label: 'Operating CF',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.cash_flow, 'operating_cash_flow'), unitConfig, cashPeriod)),
    },
    {
      label: 'Free Cash Flow',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.cash_flow, 'free_cash_flow'), unitConfig, cashPeriod)),
    },
    {
      label: 'Total Assets',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.balance, 'total_assets'), unitConfig, balancePeriod)),
    },
    {
      label: 'Equity',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.balance, 'total_equity', 'equity'), unitConfig, balancePeriod)),
    },
  ]

  return cards.filter((card) => card.value !== EMPTY_VALUE)
}

interface GrowthComparisonLabel {
  negative_base?: boolean
  transition?: 'loss_to_profit' | 'profit_to_loss' | null
  unavailable_reason?: string | null
}

export function growthComparisonLabel(detail?: GrowthComparisonLabel): string | null {
  if (detail?.transition === 'loss_to_profit') return 'loss to profit'
  if (detail?.transition === 'profit_to_loss') return 'profit to loss'
  return detail?.negative_base ? 'negative base' : null
}

/**
 * Why a growth figure is withheld, in the reader's words. The API names a
 * machine reason; an unavailable rate must never read as "no change"
 * (issue #246).
 */
export function growthUnavailableReason(detail?: GrowthComparisonLabel): string | null {
  if (!detail?.unavailable_reason) return null
  const reason = detail.unavailable_reason
  if (reason === 'missing_base_or_value') return 'prior or current period not reported'
  if (reason === 'missing_comparison_period') return 'comparison period not reported'
  if (reason === 'zero_base') return 'prior period was zero, so no rate is defined'
  if (reason === 'non_comparable_periods') return 'periods are not one fiscal year apart'
  if (reason === 'incompatible_reporting_basis') return 'reporting basis differs between periods'
  if (reason === 'unverified_comparison_basis') return 'reporting basis is not confirmed'
  if (reason === 'rejected_field') return 'a statement field was withheld by unit admission'
  return reason.replace(/_/g, ' ')
}

export interface GrowthBridgeRow {
  key: string
  label: string
  annual: number | null
  quarter: number | null
  annualLabel: string | null
  quarterLabel: string | null
  annualReason: string | null
  quarterReason: string | null
}

export function buildGrowthBridgeRows(payload: {
  yoy?: Record<string, number | null>
  qoq?: Record<string, number | null>
  comparisons?: {
    yoy?: Record<string, GrowthComparisonLabel>
    qoq?: Record<string, GrowthComparisonLabel>
  }
}) {
  return [
    { key: 'revenue_growth', label: 'Revenue', annual: payload.yoy?.revenue_growth ?? null, quarter: payload.qoq?.revenue_growth ?? null },
    { key: 'earnings_growth', label: 'Net Income', annual: payload.yoy?.earnings_growth ?? null, quarter: payload.qoq?.earnings_growth ?? null },
    { key: 'eps_growth', label: 'EPS', annual: payload.yoy?.eps_growth ?? null, quarter: payload.qoq?.eps_growth ?? null },
    { key: 'ebitda_growth', label: 'EBITDA', annual: payload.yoy?.ebitda_growth ?? null, quarter: payload.qoq?.ebitda_growth ?? null },
    { key: 'asset_growth', label: 'Assets', annual: payload.yoy?.asset_growth ?? null, quarter: null },
  ].map((row) => ({
    ...row,
    annualLabel: growthComparisonLabel(payload.comparisons?.yoy?.[row.key]),
    quarterLabel: growthComparisonLabel(payload.comparisons?.qoq?.[row.key]),
    annualReason: growthUnavailableReason(payload.comparisons?.yoy?.[row.key]),
    quarterReason: growthUnavailableReason(payload.comparisons?.qoq?.[row.key]),
  })) satisfies Array<GrowthBridgeRow>
}
