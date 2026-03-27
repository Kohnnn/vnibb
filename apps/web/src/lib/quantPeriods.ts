export const QUANT_PERIOD_OPTIONS = ['1M', '6M', '1Y', '3Y', '5Y', 'ALL'] as const

export type QuantPeriodOption = (typeof QUANT_PERIOD_OPTIONS)[number]

export const QUANT_PERIOD_DAY_MAP: Record<QuantPeriodOption, number> = {
  '1M': 31,
  '6M': 186,
  '1Y': 365,
  '3Y': 365 * 3,
  '5Y': 365 * 5,
  'ALL': 365 * 10,
}

export function getQuantPeriodStartDate(period: QuantPeriodOption): string {
  return new Date(Date.now() - QUANT_PERIOD_DAY_MAP[period] * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]
}
