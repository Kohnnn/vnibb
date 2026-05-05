import { convertFinancialValueForUnit, formatUnitValuePlain, resolveUnitScale, type UnitConfig } from '@/lib/units'

export interface TTMSnapshotMetricCard {
  label: string
  value: string
  tone: string
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
    return formatted === '—' || !scale.suffix ? formatted : `${formatted}${scale.suffix}`
  }

  const cards: TTMSnapshotMetricCard[] = [
    {
      label: 'Revenue',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.income, 'revenue'), unitConfig, incomePeriod)),
      tone: 'text-blue-300',
    },
    {
      label: 'Gross Profit',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.income, 'gross_profit'), unitConfig, incomePeriod)),
      tone: 'text-emerald-300',
    },
    {
      label: 'Operating Income',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.income, 'operating_income'), unitConfig, incomePeriod)),
      tone: 'text-cyan-300',
    },
    {
      label: 'Net Income',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.income, 'net_income'), unitConfig, incomePeriod)),
      tone: 'text-violet-300',
    },
    {
      label: 'Operating CF',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.cash_flow, 'operating_cash_flow'), unitConfig, cashPeriod)),
      tone: 'text-amber-300',
    },
    {
      label: 'Free Cash Flow',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.cash_flow, 'free_cash_flow'), unitConfig, cashPeriod)),
      tone: 'text-orange-300',
    },
    {
      label: 'Total Assets',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.balance, 'total_assets'), unitConfig, balancePeriod)),
      tone: 'text-slate-200',
    },
    {
      label: 'Equity',
      value: formatValue(convertFinancialValueForUnit(readNumber(payload.balance, 'total_equity', 'equity'), unitConfig, balancePeriod)),
      tone: 'text-pink-300',
    },
  ]

  return cards.filter((card) => card.value !== '—')
}

export interface GrowthBridgeRow {
  key: string
  label: string
  annual: number | null
  quarter: number | null
}

export function buildGrowthBridgeRows(payload: {
  yoy?: Record<string, number | null>
  qoq?: Record<string, number | null>
}) {
  return [
    { key: 'revenue_growth', label: 'Revenue', annual: payload.yoy?.revenue_growth ?? null, quarter: payload.qoq?.revenue_growth ?? null },
    { key: 'earnings_growth', label: 'Net Income', annual: payload.yoy?.earnings_growth ?? null, quarter: payload.qoq?.earnings_growth ?? null },
    { key: 'eps_growth', label: 'EPS', annual: payload.yoy?.eps_growth ?? null, quarter: payload.qoq?.eps_growth ?? null },
    { key: 'ebitda_growth', label: 'EBITDA', annual: payload.yoy?.ebitda_growth ?? null, quarter: payload.qoq?.ebitda_growth ?? null },
    { key: 'asset_growth', label: 'Assets', annual: payload.yoy?.asset_growth ?? null, quarter: null },
  ] satisfies GrowthBridgeRow[]
}
