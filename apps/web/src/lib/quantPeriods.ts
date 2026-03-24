export const QUANT_PERIOD_OPTIONS = ['1M', '6M', '3Y', '5Y', 'ALL'] as const

export type QuantPeriodOption = (typeof QUANT_PERIOD_OPTIONS)[number]
