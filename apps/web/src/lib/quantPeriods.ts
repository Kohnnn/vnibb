export const QUANT_PERIOD_OPTIONS = ['1M', '3M', '6M', '1Y', '3Y', '5Y'] as const

export type QuantPeriodOption = (typeof QUANT_PERIOD_OPTIONS)[number]
